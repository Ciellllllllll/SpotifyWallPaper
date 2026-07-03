use async_trait::async_trait;
use axum::http::StatusCode;
use reqwest::{header::RETRY_AFTER, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const SPOTIFY_SCOPES: &str =
    "user-read-currently-playing user-read-playback-state user-modify-playback-state";

const TOKEN_ENDPOINT: &str = "https://accounts.spotify.com/api/token";
const PLAYER_ENDPOINT: &str = "https://api.spotify.com/v1/me/player";
const FALLBACK_ALBUM_IMAGE: &str = "mock/album-placeholder.svg";

#[async_trait]
pub trait SpotifyClient: Send + Sync {
    async fn exchange_code(
        &self,
        client_id: &str,
        redirect_uri: &str,
        code_verifier: &str,
        code: &str,
    ) -> Result<TokenExchange, SpotifyApiError>;

    async fn refresh_access_token(
        &self,
        client_id: &str,
        refresh_token: &str,
    ) -> Result<TokenExchange, SpotifyApiError>;
    async fn current_playback(
        &self,
        access_token: &str,
    ) -> Result<NormalizedPlayback, SpotifyApiError>;
    async fn control(
        &self,
        access_token: &str,
        command: PlaybackCommand,
    ) -> Result<(), SpotifyApiError>;
}

#[derive(Default)]
pub struct RealSpotifyClient {
    http: reqwest::Client,
}

#[async_trait]
impl SpotifyClient for RealSpotifyClient {
    async fn exchange_code(
        &self,
        client_id: &str,
        redirect_uri: &str,
        code_verifier: &str,
        code: &str,
    ) -> Result<TokenExchange, SpotifyApiError> {
        let params = [
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect_uri),
            ("client_id", client_id),
            ("code_verifier", code_verifier),
        ];
        let response = self
            .http
            .post(TOKEN_ENDPOINT)
            .form(&params)
            .send()
            .await
            .map_err(|_| SpotifyApiError::network())?;
        token_response(response).await
    }

    async fn refresh_access_token(
        &self,
        client_id: &str,
        refresh_token: &str,
    ) -> Result<TokenExchange, SpotifyApiError> {
        let params = [
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id),
        ];
        let response = self
            .http
            .post(TOKEN_ENDPOINT)
            .form(&params)
            .send()
            .await
            .map_err(|_| SpotifyApiError::network())?;
        token_response(response).await
    }

    async fn current_playback(
        &self,
        access_token: &str,
    ) -> Result<NormalizedPlayback, SpotifyApiError> {
        let response = self
            .http
            .get(PLAYER_ENDPOINT)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|_| SpotifyApiError::network())?;
        if response.status() == StatusCode::NO_CONTENT {
            return Err(SpotifyApiError::unavailable());
        }
        if !response.status().is_success() {
            return Err(classify_status(
                response.status(),
                response.headers().get(RETRY_AFTER),
            ));
        }
        let payload = response
            .json::<Value>()
            .await
            .map_err(|_| SpotifyApiError::unknown(None))?;
        normalize_playback(&payload, chrono::Utc::now().to_rfc3339())
    }

    async fn control(
        &self,
        access_token: &str,
        command: PlaybackCommand,
    ) -> Result<(), SpotifyApiError> {
        let (method, url) = control_request(command)?;
        let response = self
            .http
            .request(method, url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|_| SpotifyApiError::network())?;
        if response.status().is_success() || response.status() == StatusCode::NO_CONTENT {
            Ok(())
        } else {
            Err(classify_status(
                response.status(),
                response.headers().get(RETRY_AFTER),
            ))
        }
    }
}

#[derive(Clone)]
pub struct TokenExchange {
    pub access_token: String,
    pub expires_in_ms: u64,
    pub refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct SpotifyTokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct SpotifyTokenError {
    error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SpotifyApiError {
    pub kind: SpotifyErrorKind,
    pub message: &'static str,
    pub status: StatusCode,
    pub retry_after_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpotifyErrorKind {
    Unauthorized,
    Forbidden,
    RateLimited,
    NetworkError,
    Unavailable,
    UnknownResponseShape,
    ItemNull,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedPlayback {
    pub source: &'static str,
    #[serde(rename = "itemType")]
    pub item_type: &'static str,
    pub id: Option<String>,
    pub uri: Option<String>,
    pub title: String,
    pub artists: Vec<String>,
    #[serde(rename = "albumName")]
    pub album_name: String,
    #[serde(rename = "imageUrls")]
    pub image_urls: Vec<String>,
    #[serde(rename = "albumImageUrl")]
    pub album_image_url: String,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    #[serde(rename = "progressMs")]
    pub progress_ms: u64,
    #[serde(rename = "isPlaying")]
    pub is_playing: bool,
    pub device: Option<PlaybackDeviceState>,
    #[serde(rename = "deviceName")]
    pub device_name: Option<String>,
    #[serde(rename = "shuffleState")]
    pub shuffle_state: Option<bool>,
    #[serde(rename = "repeatState")]
    pub repeat_state: Option<String>,
    #[serde(rename = "volumePercent")]
    pub volume_percent: Option<u64>,
    #[serde(rename = "externalUrl")]
    pub external_url: Option<String>,
    #[serde(rename = "fetchedAt")]
    pub fetched_at: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackDeviceState {
    pub id: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub device_type: Option<String>,
    #[serde(rename = "isActive")]
    pub is_active: bool,
    #[serde(rename = "isRestricted")]
    pub is_restricted: bool,
    #[serde(rename = "volumePercent")]
    pub volume_percent: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PlaybackCommand {
    Play,
    Pause,
    Next,
    Previous,
    Seek {
        #[serde(rename = "positionMs")]
        position_ms: u64,
    },
    Volume {
        #[serde(rename = "volumePercent")]
        volume_percent: u64,
    },
    Shuffle {
        state: bool,
    },
    Repeat {
        state: String,
    },
}

async fn token_response(response: reqwest::Response) -> Result<TokenExchange, SpotifyApiError> {
    let status = response.status();
    let retry_after = response
        .headers()
        .get(RETRY_AFTER)
        .and_then(parse_retry_after_ms);
    if !status.is_success() {
        let token_error = response.json::<SpotifyTokenError>().await.ok();
        if token_error.and_then(|error| error.error).as_deref() == Some("invalid_grant") {
            return Err(SpotifyApiError::unauthorized(
                "Spotify authorization expired. Reauthorize Spotify from the backend setup page.",
            ));
        }
        return Err(classify_status_value(status, retry_after));
    }

    let token = response
        .json::<SpotifyTokenResponse>()
        .await
        .map_err(|_| SpotifyApiError::unknown(Some(status)))?;
    Ok(TokenExchange {
        access_token: token.access_token,
        expires_in_ms: token.expires_in * 1000,
        refresh_token: token.refresh_token,
    })
}

fn control_request(command: PlaybackCommand) -> Result<(Method, String), SpotifyApiError> {
    match command {
        PlaybackCommand::Play => Ok((Method::PUT, format!("{PLAYER_ENDPOINT}/play"))),
        PlaybackCommand::Pause => Ok((Method::PUT, format!("{PLAYER_ENDPOINT}/pause"))),
        PlaybackCommand::Next => Ok((Method::POST, format!("{PLAYER_ENDPOINT}/next"))),
        PlaybackCommand::Previous => Ok((Method::POST, format!("{PLAYER_ENDPOINT}/previous"))),
        PlaybackCommand::Seek { position_ms } => Ok((
            Method::PUT,
            format!("{PLAYER_ENDPOINT}/seek?position_ms={position_ms}"),
        )),
        PlaybackCommand::Volume { volume_percent } => Ok((
            Method::PUT,
            format!(
                "{PLAYER_ENDPOINT}/volume?volume_percent={}",
                volume_percent.min(100)
            ),
        )),
        PlaybackCommand::Shuffle { state } => Ok((
            Method::PUT,
            format!("{PLAYER_ENDPOINT}/shuffle?state={state}"),
        )),
        PlaybackCommand::Repeat { state }
            if state == "off" || state == "track" || state == "context" =>
        {
            Ok((
                Method::PUT,
                format!("{PLAYER_ENDPOINT}/repeat?state={state}"),
            ))
        }
        PlaybackCommand::Repeat { .. } => {
            Err(SpotifyApiError::bad_request("Unsupported repeat state."))
        }
    }
}

pub fn normalize_playback(
    raw: &Value,
    fetched_at: String,
) -> Result<NormalizedPlayback, SpotifyApiError> {
    let object = raw
        .as_object()
        .ok_or_else(|| SpotifyApiError::unknown(None))?;
    let device = object.get("device").and_then(normalize_device);
    if object.get("item").is_none() || object.get("item") == Some(&Value::Null) {
        return Ok(empty_playback(raw, device, fetched_at));
    }

    let item = object
        .get("item")
        .and_then(Value::as_object)
        .ok_or_else(|| SpotifyApiError::unknown(None))?;
    let item_type = match item
        .get("type")
        .and_then(Value::as_str)
        .or_else(|| object.get("currently_playing_type").and_then(Value::as_str))
    {
        Some("track") => "track",
        Some("episode") => "episode",
        _ => return Ok(empty_playback(raw, device, fetched_at)),
    };

    let image_urls = if item_type == "episode" {
        episode_image_urls(item)
    } else {
        track_image_urls(item)
    };
    let album_image_url = image_urls
        .first()
        .cloned()
        .unwrap_or_else(|| FALLBACK_ALBUM_IMAGE.to_string());
    let artists = if item_type == "episode" {
        item.get("publisher")
            .and_then(Value::as_str)
            .map(|publisher| vec![publisher.to_string()])
            .unwrap_or_default()
    } else {
        item.get("artists")
            .and_then(Value::as_array)
            .map(|artists| {
                artists
                    .iter()
                    .filter_map(|artist| {
                        artist
                            .get("name")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let album_name = if item_type == "episode" {
        item.get("show")
            .and_then(|show| show.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("")
    } else {
        item.get("album")
            .and_then(|album| album.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("")
    };

    Ok(NormalizedPlayback {
        source: "spotify",
        item_type,
        id: item.get("id").and_then(Value::as_str).map(str::to_string),
        uri: item.get("uri").and_then(Value::as_str).map(str::to_string),
        title: item
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Untitled track")
            .to_string(),
        artists,
        album_name: album_name.to_string(),
        image_urls,
        album_image_url,
        duration_ms: item.get("duration_ms").and_then(Value::as_u64).unwrap_or(0),
        progress_ms: object
            .get("progress_ms")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        is_playing: object
            .get("is_playing")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        device_name: device.as_ref().and_then(|device| device.name.clone()),
        volume_percent: device.as_ref().and_then(|device| device.volume_percent),
        device,
        shuffle_state: object.get("shuffle_state").and_then(Value::as_bool),
        repeat_state: object
            .get("repeat_state")
            .and_then(Value::as_str)
            .map(str::to_string),
        external_url: item
            .get("external_urls")
            .and_then(|urls| urls.get("spotify"))
            .and_then(Value::as_str)
            .map(str::to_string),
        fetched_at,
    })
}

fn empty_playback(
    raw: &Value,
    device: Option<PlaybackDeviceState>,
    fetched_at: String,
) -> NormalizedPlayback {
    NormalizedPlayback {
        source: "spotify",
        item_type: "none",
        id: None,
        uri: None,
        title: "Nothing Playing".to_string(),
        artists: Vec::new(),
        album_name: String::new(),
        image_urls: vec![FALLBACK_ALBUM_IMAGE.to_string()],
        album_image_url: FALLBACK_ALBUM_IMAGE.to_string(),
        duration_ms: 0,
        progress_ms: raw.get("progress_ms").and_then(Value::as_u64).unwrap_or(0),
        is_playing: raw
            .get("is_playing")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        device_name: device.as_ref().and_then(|device| device.name.clone()),
        volume_percent: device.as_ref().and_then(|device| device.volume_percent),
        device,
        shuffle_state: raw.get("shuffle_state").and_then(Value::as_bool),
        repeat_state: raw
            .get("repeat_state")
            .and_then(Value::as_str)
            .map(str::to_string),
        external_url: None,
        fetched_at,
    }
}

fn normalize_device(value: &Value) -> Option<PlaybackDeviceState> {
    Some(PlaybackDeviceState {
        id: value.get("id").and_then(Value::as_str).map(str::to_string),
        name: value
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string),
        device_type: value
            .get("type")
            .and_then(Value::as_str)
            .map(str::to_string),
        is_active: value
            .get("is_active")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        is_restricted: value
            .get("is_restricted")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        volume_percent: value.get("volume_percent").and_then(Value::as_u64),
    })
}

fn track_image_urls(item: &serde_json::Map<String, Value>) -> Vec<String> {
    item.get("album")
        .and_then(|album| album.get("images"))
        .and_then(image_urls)
        .unwrap_or_else(|| vec![FALLBACK_ALBUM_IMAGE.to_string()])
}

fn episode_image_urls(item: &serde_json::Map<String, Value>) -> Vec<String> {
    item.get("images")
        .and_then(image_urls)
        .or_else(|| {
            item.get("show")
                .and_then(|show| show.get("images"))
                .and_then(image_urls)
        })
        .unwrap_or_else(|| vec![FALLBACK_ALBUM_IMAGE.to_string()])
}

fn image_urls(value: &Value) -> Option<Vec<String>> {
    let urls: Vec<String> = value
        .as_array()?
        .iter()
        .filter_map(|image| image.get("url").and_then(Value::as_str).map(str::to_string))
        .collect();
    if urls.is_empty() {
        None
    } else {
        Some(urls)
    }
}

fn classify_status(
    status: StatusCode,
    retry_after: Option<&reqwest::header::HeaderValue>,
) -> SpotifyApiError {
    classify_status_value(status, retry_after.and_then(parse_retry_after_ms))
}

fn classify_status_value(status: StatusCode, retry_after_ms: Option<u64>) -> SpotifyApiError {
    match status.as_u16() {
        401 => SpotifyApiError::unauthorized("Spotify authorization is missing or expired."),
        403 => SpotifyApiError {
            kind: SpotifyErrorKind::Forbidden,
            message: "Spotify denied this operation for the current account or device.",
            status,
            retry_after_ms: None,
        },
        429 => SpotifyApiError {
            kind: SpotifyErrorKind::RateLimited,
            message: "Spotify rate limit reached.",
            status,
            retry_after_ms,
        },
        _ => SpotifyApiError::unknown(Some(status)),
    }
}

fn parse_retry_after_ms(value: &reqwest::header::HeaderValue) -> Option<u64> {
    value
        .to_str()
        .ok()?
        .parse::<u64>()
        .ok()
        .map(|seconds| seconds * 1000)
}

impl SpotifyApiError {
    pub fn unauthorized(message: &'static str) -> Self {
        Self {
            kind: SpotifyErrorKind::Unauthorized,
            message,
            status: StatusCode::UNAUTHORIZED,
            retry_after_ms: None,
        }
    }

    pub fn bad_request(message: &'static str) -> Self {
        Self {
            kind: SpotifyErrorKind::UnknownResponseShape,
            message,
            status: StatusCode::BAD_REQUEST,
            retry_after_ms: None,
        }
    }

    pub fn server(message: &'static str) -> Self {
        Self {
            kind: SpotifyErrorKind::Unavailable,
            message,
            status: StatusCode::INTERNAL_SERVER_ERROR,
            retry_after_ms: None,
        }
    }

    fn network() -> Self {
        Self {
            kind: SpotifyErrorKind::NetworkError,
            message: "Spotify request failed before a response was received.",
            status: StatusCode::BAD_GATEWAY,
            retry_after_ms: None,
        }
    }

    fn unavailable() -> Self {
        Self {
            kind: SpotifyErrorKind::Unavailable,
            message: "Spotify has no active playback device.",
            status: StatusCode::SERVICE_UNAVAILABLE,
            retry_after_ms: None,
        }
    }

    fn unknown(status: Option<StatusCode>) -> Self {
        Self {
            kind: SpotifyErrorKind::UnknownResponseShape,
            message: "Spotify returned an unexpected response.",
            status: status.unwrap_or(StatusCode::BAD_GATEWAY),
            retry_after_ms: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_track_playback() {
        let raw = serde_json::json!({
            "is_playing": true,
            "progress_ms": 65000,
            "shuffle_state": false,
            "repeat_state": "off",
            "device": {
                "id": "device-1",
                "name": "Desktop",
                "type": "Computer",
                "is_active": true,
                "is_restricted": false,
                "volume_percent": 55
            },
            "item": {
                "type": "track",
                "id": "track-1",
                "uri": "spotify:track:track-1",
                "name": "Current Song",
                "duration_ms": 180000,
                "artists": [{"name": "First Artist"}],
                "album": {
                    "name": "Current Album",
                    "images": [{"url": "https://i.scdn.co/image/large"}]
                },
                "external_urls": {"spotify": "https://open.spotify.com/track/track-1"}
            }
        });

        let playback =
            normalize_playback(&raw, "2026-06-13T00:00:00.000Z".to_string()).expect("playback");
        assert_eq!(playback.source, "spotify");
        assert_eq!(playback.item_type, "track");
        assert_eq!(playback.title, "Current Song");
        assert_eq!(playback.album_image_url, "https://i.scdn.co/image/large");
        assert_eq!(playback.volume_percent, Some(55));
    }
}
