use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue, Method},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::{
    crypto::{code_challenge, generate_code_verifier, random_state},
    db::{LoadedTokens, StoredTokens},
    spotify::{PlaybackCommand, SpotifyApiError, SpotifyErrorKind},
    AppState, CachedAccessToken, PendingAuthSession,
};

const AUTH_SESSION_TTL_MS: i64 = 10 * 60 * 1000;
const ACCESS_TOKEN_SAFETY_MS: i64 = 60_000;

pub fn app(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin: &HeaderValue, _| {
            let Ok(origin) = origin.to_str() else {
                return false;
            };
            origin == "null"
                || origin.starts_with("http://127.0.0.1:")
                || origin.starts_with("http://[::1]:")
        }))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    Router::new()
        .route("/health", get(health))
        .route("/auth/start", get(auth_start))
        .route("/auth/callback", get(auth_callback))
        .route("/api/playback", get(playback))
        .route("/api/control", post(control))
        .layer(cors)
        .with_state(state)
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        mode: "local",
    })
}

async fn auth_start(
    State(state): State<AppState>,
    Query(query): Query<AuthStartQuery>,
) -> Response {
    let client_id = query.client_id.trim();
    if client_id.is_empty() {
        return api_error(SpotifyApiError::bad_request(
            "Spotify Client ID is required.",
        ));
    }

    let pairing_token = random_state();
    let code_verifier = generate_code_verifier();
    let state_value = random_state();
    let redirect_uri = format!("{}/auth/callback", state.config.public_base_url);
    let challenge = code_challenge(&code_verifier);
    let auth_url = format!(
        "https://accounts.spotify.com/authorize?response_type=code&client_id={}&scope={}&redirect_uri={}&code_challenge_method=S256&code_challenge={}&state={}",
        encode_component(client_id),
        encode_component(crate::spotify::SPOTIFY_SCOPES),
        encode_component(&redirect_uri),
        encode_component(&challenge),
        encode_component(&state_value)
    );

    state
        .pending_auth
        .lock()
        .expect("pending auth lock")
        .insert(
            state_value.clone(),
            PendingAuthSession {
                client_id: client_id.to_string(),
                redirect_uri,
                code_verifier,
                pairing_token,
                expires_at_ms: now_ms() + AUTH_SESSION_TTL_MS,
            },
        );

    Json(ApiOk::new(AuthStartResponse {
        auth_url,
        state: state_value,
    }))
    .into_response()
}

async fn auth_callback(
    State(state): State<AppState>,
    Query(query): Query<AuthCallbackQuery>,
) -> Response {
    if query.error.is_some() {
        return Html("Spotify authorization failed. Return to Spotify Wallpaper setup.")
            .into_response();
    }
    let Some(code) = query.code else {
        return Html("Spotify authorization callback did not include a code.").into_response();
    };
    let Some(state_value) = query.state else {
        return Html("Spotify authorization callback did not include state.").into_response();
    };
    let pending = state
        .pending_auth
        .lock()
        .expect("pending auth lock")
        .remove(&state_value);
    let Some(pending) = pending else {
        return Html("Spotify authorization state was invalid or expired.").into_response();
    };
    if pending.expires_at_ms < now_ms() {
        return Html("Spotify authorization state expired. Start authorization again.")
            .into_response();
    }

    match state
        .spotify
        .exchange_code(
            &pending.client_id,
            &pending.redirect_uri,
            &pending.code_verifier,
            &code,
        )
        .await
    {
        Ok(token) => {
            let refresh_token = token.refresh_token.unwrap_or_default();
            if refresh_token.is_empty() {
                return Html("Spotify token response did not include a Refresh Token.")
                    .into_response();
            }
            *state.access_token.lock().expect("access token lock") = Some(CachedAccessToken {
                client_id: pending.client_id.clone(),
                access_token: token.access_token,
                expires_at_ms: now_ms() + token.expires_in_ms as i64,
            });
            let store_result = state.database.store_pairing_and_tokens(
                &pending.pairing_token,
                &pending.client_id,
                &refresh_token,
                None,
                None,
            );
            if store_result.is_err() {
                return Html("Spotify token could not be saved.").into_response();
            }
            Html(format!(
                "<!doctype html><meta charset=\"utf-8\"><title>Spotify Wallpaper</title><h1>Authorization complete</h1><p>Paste this Pairing Token into Wallpaper Engine:</p><code>{}</code>",
                pending.pairing_token
            ))
            .into_response()
        }
        Err(_) => {
            Html("Spotify token exchange was rejected. Start authorization again.").into_response()
        }
    }
}

async fn playback(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let (tokens, key) = match authorized_tokens(&state, &headers).await {
        Ok(tokens) => tokens,
        Err(error) => return api_error(error),
    };
    let access_token = match access_token(&state, &tokens, &key).await {
        Ok(token) => token,
        Err(error) => return api_error(error),
    };
    match state.spotify.current_playback(&access_token).await {
        Ok(playback) => Json(ApiOk::new(playback)).into_response(),
        Err(error) => api_error(error),
    }
}

async fn control(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(command): Json<PlaybackCommand>,
) -> Response {
    let (tokens, key) = match authorized_tokens(&state, &headers).await {
        Ok(tokens) => tokens,
        Err(error) => return api_error(error),
    };
    let access_token = match access_token(&state, &tokens, &key).await {
        Ok(token) => token,
        Err(error) => return api_error(error),
    };
    match state.spotify.control(&access_token, command).await {
        Ok(()) => Json(ApiOk::new(())).into_response(),
        Err(error) => api_error(error),
    }
}

async fn authorized_tokens(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(LoadedTokens, crate::crypto::EncryptionKey), SpotifyApiError> {
    let pairing_token = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(|| SpotifyApiError::unauthorized("Backend pairing token is required."))?;
    let key = state
        .database
        .verify_pairing_token(pairing_token)
        .map_err(|_| SpotifyApiError::server("Backend credential storage is unavailable."))?
        .ok_or_else(|| SpotifyApiError::unauthorized("Backend pairing token was rejected."))?;
    let tokens = state
        .database
        .load_tokens(&key)
        .map_err(|_| {
            SpotifyApiError::unauthorized(
                "Spotify authorization is unavailable. Reauthorize Spotify.",
            )
        })?
        .ok_or_else(|| {
            SpotifyApiError::unauthorized("Spotify authorization is required. Reauthorize Spotify.")
        })?;
    Ok((tokens, key))
}

async fn access_token(
    state: &AppState,
    tokens: &LoadedTokens,
    key: &crate::crypto::EncryptionKey,
) -> Result<String, SpotifyApiError> {
    if let Some(access_token) = state
        .access_token
        .lock()
        .expect("access token lock")
        .clone()
    {
        if access_token.client_id == tokens.client_id
            && access_token.expires_at_ms > now_ms() + ACCESS_TOKEN_SAFETY_MS
        {
            return Ok(access_token.access_token);
        }
    }

    if let (Some(access_token), Some(expires_at)) =
        (&tokens.access_token, tokens.access_token_expires_at_ms)
    {
        if expires_at > now_ms() + ACCESS_TOKEN_SAFETY_MS {
            return Ok(access_token.clone());
        }
    }

    let refreshed = state
        .spotify
        .refresh_access_token(&tokens.client_id, &tokens.refresh_token)
        .await?;
    let refresh_token = refreshed
        .refresh_token
        .unwrap_or_else(|| tokens.refresh_token.clone());
    *state.access_token.lock().expect("access token lock") = Some(CachedAccessToken {
        client_id: tokens.client_id.clone(),
        access_token: refreshed.access_token.clone(),
        expires_at_ms: now_ms() + refreshed.expires_in_ms as i64,
    });
    if let Err(error) = state.database.store_tokens(&StoredTokens {
        client_id: tokens.client_id.clone(),
        refresh_token,
        access_token: None,
        access_token_expires_at_ms: None,
        encryption_key: key.clone(),
    }) {
        let _ = error;
        return Err(SpotifyApiError::server(
            "Backend credential storage is unavailable.",
        ));
    }
    Ok(refreshed.access_token)
}

fn api_error(error: SpotifyApiError) -> Response {
    let retry_after_ms = error.retry_after_ms;
    let mut response = (
        error.status,
        Json(ApiErr::new(SpotifyPlaybackError {
            kind: error.kind,
            message: error.message,
            retry_after_ms,
            status: Some(error.status.as_u16()),
        })),
    )
        .into_response();
    if let Some(retry_after_ms) = retry_after_ms {
        let retry_after_seconds = retry_after_ms.div_ceil(1000).max(1).to_string();
        if let Ok(value) = HeaderValue::from_str(&retry_after_seconds) {
            response.headers_mut().insert(header::RETRY_AFTER, value);
        }
    }
    response
}

#[derive(Deserialize)]
struct AuthStartQuery {
    #[serde(rename = "clientId")]
    client_id: String,
}

#[derive(Deserialize)]
struct AuthCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthStartResponse {
    auth_url: String,
    state: String,
}

#[derive(Serialize)]
struct HealthResponse {
    ok: bool,
    mode: &'static str,
}

#[derive(Serialize)]
struct ApiOk<T: Serialize> {
    ok: bool,
    value: T,
}

impl<T: Serialize> ApiOk<T> {
    fn new(value: T) -> Self {
        Self { ok: true, value }
    }
}

#[derive(Serialize)]
struct ApiErr {
    ok: bool,
    error: SpotifyPlaybackError,
}

impl ApiErr {
    fn new(error: SpotifyPlaybackError) -> Self {
        Self { ok: false, error }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpotifyPlaybackError {
    kind: SpotifyErrorKind,
    message: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
}

fn encode_component(input: &str) -> String {
    input
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spotify::{NormalizedPlayback, SpotifyErrorKind};

    #[test]
    fn serializes_provider_v1_success_and_error_fixtures_exactly() {
        let success_fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/contracts/provider-v1/success-playing.json"
        ))
        .expect("success provider-v1 fixture");
        let success = NormalizedPlayback {
            source: "spotify",
            item_type: "track",
            id: Some("track-1".to_string()),
            uri: Some("spotify:track:track-1".to_string()),
            title: "Example Track".to_string(),
            artists: vec!["Example Artist".to_string()],
            album_name: "Example Album".to_string(),
            image_urls: vec!["https://i.scdn.co/image/example".to_string()],
            album_image_url: "https://i.scdn.co/image/example".to_string(),
            duration_ms: 180_000,
            progress_ms: 12_000,
            is_playing: true,
            device: Some(crate::spotify::PlaybackDeviceState {
                id: None,
                name: None,
                device_type: None,
                is_active: false,
                is_restricted: false,
                volume_percent: Some(75),
            }),
            device_name: None,
            shuffle_state: Some(false),
            repeat_state: Some("off".to_string()),
            volume_percent: Some(75),
            external_url: Some("https://open.spotify.com/track/track-1".to_string()),
            fetched_at: "2026-08-04T00:00:00.000Z".to_string(),
        };
        assert_eq!(
            serde_json::to_value(ApiOk::new(success)).expect("success response"),
            success_fixture
        );

        let unauthorized_fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/contracts/provider-v1/error-unauthorized.json"
        ))
        .expect("unauthorized provider-v1 fixture");
        let unauthorized = ApiErr::new(SpotifyPlaybackError {
            kind: SpotifyErrorKind::Unauthorized,
            message: "Spotify authorization is required.",
            retry_after_ms: None,
            status: Some(401),
        });
        assert_eq!(
            serde_json::to_value(unauthorized).expect("unauthorized response"),
            unauthorized_fixture
        );

        let rate_limited_fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/contracts/provider-v1/error-rate-limited.json"
        ))
        .expect("rate-limited provider-v1 fixture");
        let rate_limited = ApiErr::new(SpotifyPlaybackError {
            kind: SpotifyErrorKind::RateLimited,
            message: "Spotify rate limit reached.",
            retry_after_ms: Some(5_000),
            status: Some(429),
        });
        assert_eq!(
            serde_json::to_value(rate_limited).expect("rate-limited response"),
            rate_limited_fixture
        );
    }

    #[test]
    fn serializes_provider_v1_control_success_as_null() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/contracts/provider-v1/control-seek.json"
        ))
        .expect("control provider-v1 fixture");
        let command: PlaybackCommand =
            serde_json::from_value(fixture["request"].clone()).expect("control request");
        assert!(matches!(
            command,
            PlaybackCommand::Seek {
                position_ms: 42_000
            }
        ));
        assert_eq!(
            serde_json::to_value(ApiOk::new(())).expect("control response"),
            fixture["result"]
        );

        for invalid in [
            serde_json::json!({ "type": "seek", "positionMs": 42_000, "credential": "unexpected" }),
            serde_json::json!({ "type": "seek" }),
            serde_json::json!({ "type": "volume", "volumePercent": 101 }),
            serde_json::json!({ "type": "repeat", "state": "all" }),
        ] {
            assert!(serde_json::from_value::<PlaybackCommand>(invalid).is_err());
        }
    }
}
