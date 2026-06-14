#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::{mpsc, Mutex},
    thread,
    time::Duration,
};

const SENSITIVE_KEYS: [&str; 11] = [
    "accessToken",
    "access_token",
    "refreshToken",
    "refresh_token",
    "authorizationCode",
    "authorization_code",
    "clientSecret",
    "client_secret",
    "spotifyAccessToken",
    "spotifyRefreshToken",
    "oauthCallbackUrl",
];

const SPOTIFY_SCOPES: &str =
    "user-read-currently-playing user-read-playback-state user-modify-playback-state";

struct OAuthState {
    verifier: String,
    state: String,
    redirect_uri: String,
}

struct RainmeterScheduler {
    sender: mpsc::Sender<RainmeterSchedulerMessage>,
}

enum RainmeterSchedulerMessage {
    Update(RainmeterSchedulerPayload),
    Stop,
}

#[derive(Clone)]
struct RainmeterSchedulerPayload {
    output_path: PathBuf,
    payload_json: String,
    is_playing: bool,
    stopped_update_interval_ms: u64,
}

#[derive(Default)]
struct AppState {
    oauth: Mutex<Option<OAuthState>>,
    rainmeter: Mutex<Option<RainmeterScheduler>>,
}

#[derive(Serialize)]
struct SpotifyAuthStart {
    auth_url: String,
    state: String,
}

#[derive(Serialize)]
struct SpotifyTokenExchange {
    refresh_token: String,
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct SpotifyTokenResponse {
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

#[tauri::command]
fn validate_settings_json(settings_json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&settings_json)
        .map(|_| ())
        .map_err(|_| "Settings JSON is malformed.".to_string())
}

#[tauri::command]
fn write_rainmeter_json(output_path: String, payload_json: String) -> Result<(), String> {
    write_rainmeter_json_file(Path::new(&output_path), &payload_json)
}

#[tauri::command]
fn start_spotify_pkce_auth(
    client_id: String,
    redirect_uri: String,
    state: tauri::State<AppState>,
) -> Result<SpotifyAuthStart, String> {
    let client_id = client_id.trim();
    let redirect_uri = redirect_uri.trim();
    if client_id.is_empty() || redirect_uri.is_empty() {
        return Err("Client ID and redirect URI are required.".to_string());
    }

    let verifier = random_urlsafe(96);
    let state_value = random_urlsafe(32);
    let challenge = pkce_challenge(&verifier);
    let auth_url = format!(
        "https://accounts.spotify.com/authorize?response_type=code&client_id={}&scope={}&redirect_uri={}&code_challenge_method=S256&code_challenge={}&state={}",
        encode_component(client_id),
        encode_component(SPOTIFY_SCOPES),
        encode_component(redirect_uri),
        encode_component(&challenge),
        encode_component(&state_value)
    );

    *state.oauth.lock().map_err(|_| "OAuth state is unavailable.".to_string())? = Some(OAuthState {
        verifier,
        state: state_value.clone(),
        redirect_uri: redirect_uri.to_string(),
    });

    Ok(SpotifyAuthStart {
        auth_url,
        state: state_value,
    })
}

#[tauri::command]
async fn exchange_spotify_callback(
    client_id: String,
    callback_url: String,
    state: tauri::State<'_, AppState>,
) -> Result<SpotifyTokenExchange, String> {
    let client_id = client_id.trim().to_string();
    if client_id.is_empty() {
        return Err("Client ID is required.".to_string());
    }

    let callback = parse_callback_query(&callback_url)?;
    let saved = state
        .oauth
        .lock()
        .map_err(|_| "OAuth state is unavailable.".to_string())?
        .take()
        .ok_or_else(|| "Spotify authorization has not been started.".to_string())?;

    if callback.state.as_deref() != Some(saved.state.as_str()) {
        return Err("Spotify authorization state did not match.".to_string());
    }

    if let Some(error) = callback.error {
        return Err(format!("Spotify authorization failed: {error}"));
    }

    let code = callback
        .code
        .ok_or_else(|| "Spotify callback did not include an authorization code.".to_string())?;
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("redirect_uri", saved.redirect_uri.as_str()),
        ("client_id", client_id.as_str()),
        ("code_verifier", saved.verifier.as_str()),
    ];

    let response = reqwest::Client::new()
        .post("https://accounts.spotify.com/api/token")
        .form(&params)
        .send()
        .await
        .map_err(|_| "Spotify token request failed.".to_string())?;

    if !response.status().is_success() {
        return Err("Spotify token exchange was rejected.".to_string());
    }

    let token = response
        .json::<SpotifyTokenResponse>()
        .await
        .map_err(|_| "Spotify token response was malformed.".to_string())?;
    let refresh_token = token
        .refresh_token
        .ok_or_else(|| "Spotify token response did not include a Refresh Token.".to_string())?;

    Ok(SpotifyTokenExchange {
        refresh_token,
        expires_in: token.expires_in,
    })
}

#[tauri::command]
fn start_rainmeter_scheduler(
    output_path: String,
    payload_json: String,
    is_playing: bool,
    stopped_update_interval_ms: u64,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let payload = rainmeter_payload(output_path, payload_json, is_playing, stopped_update_interval_ms)?;
    let (sender, receiver) = mpsc::channel::<RainmeterSchedulerMessage>();
    sender
        .send(RainmeterSchedulerMessage::Update(payload))
        .map_err(|_| "Rainmeter scheduler could not be started.".to_string())?;

    stop_rainmeter_scheduler_inner(&state)?;
    thread::spawn(move || run_rainmeter_scheduler(receiver));
    *state
        .rainmeter
        .lock()
        .map_err(|_| "Rainmeter scheduler state is unavailable.".to_string())? =
        Some(RainmeterScheduler { sender });
    Ok(())
}

#[tauri::command]
fn update_rainmeter_scheduler(
    output_path: String,
    payload_json: String,
    is_playing: bool,
    stopped_update_interval_ms: u64,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let payload = rainmeter_payload(output_path, payload_json, is_playing, stopped_update_interval_ms)?;
    let guard = state
        .rainmeter
        .lock()
        .map_err(|_| "Rainmeter scheduler state is unavailable.".to_string())?;
    let scheduler = guard
        .as_ref()
        .ok_or_else(|| "Rainmeter scheduler is not running.".to_string())?;
    scheduler
        .sender
        .send(RainmeterSchedulerMessage::Update(payload))
        .map_err(|_| "Rainmeter scheduler could not be updated.".to_string())
}

#[tauri::command]
fn stop_rainmeter_scheduler(state: tauri::State<AppState>) -> Result<(), String> {
    stop_rainmeter_scheduler_inner(&state)
}

fn write_rainmeter_json_file(output_path: &Path, payload_json: &str) -> Result<(), String> {
    if output_path.as_os_str().is_empty() {
        return Err("Rainmeter output path is required.".to_string());
    }

    let payload = serde_json::from_str::<serde_json::Value>(payload_json)
        .map_err(|_| "Rainmeter JSON is malformed.".to_string())?;

    if contains_sensitive_key(&payload) {
        return Err("Rainmeter JSON contains a sensitive credential field.".to_string());
    }

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|_| "Rainmeter output directory could not be created.".to_string())?;
    }

    let temp_path = output_path.with_extension("json.tmp");
    std::fs::write(&temp_path, serde_json::to_vec_pretty(&payload).map_err(|_| {
        "Rainmeter JSON could not be serialized.".to_string()
    })?)
    .map_err(|_| "Rainmeter output file could not be written.".to_string())?;

    std::fs::rename(&temp_path, output_path)
        .or_else(|_| {
            std::fs::copy(&temp_path, output_path)?;
            std::fs::remove_file(&temp_path)
        })
        .map_err(|_| "Rainmeter output file could not be finalized.".to_string())?;

    Ok(())
}

fn run_rainmeter_scheduler(receiver: mpsc::Receiver<RainmeterSchedulerMessage>) {
    let mut payload: Option<RainmeterSchedulerPayload> = None;
    loop {
        let wait = payload
            .as_ref()
            .map(|payload| {
                if payload.is_playing {
                    Duration::from_millis(1000)
                } else {
                    Duration::from_millis(payload.stopped_update_interval_ms.max(1000))
                }
            })
            .unwrap_or_else(|| Duration::from_millis(1000));

        match receiver.recv_timeout(wait) {
            Ok(RainmeterSchedulerMessage::Update(next)) => {
                payload = Some(next);
            }
            Ok(RainmeterSchedulerMessage::Stop) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(payload) = &payload {
                    let _ = write_rainmeter_json_file(&payload.output_path, &payload.payload_json);
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn rainmeter_payload(
    output_path: String,
    payload_json: String,
    is_playing: bool,
    stopped_update_interval_ms: u64,
) -> Result<RainmeterSchedulerPayload, String> {
    let output_path = PathBuf::from(output_path.trim());
    if output_path.as_os_str().is_empty() {
        return Err("Rainmeter output path is required.".to_string());
    }
    let payload = serde_json::from_str::<serde_json::Value>(&payload_json)
        .map_err(|_| "Rainmeter JSON is malformed.".to_string())?;
    if contains_sensitive_key(&payload) {
        return Err("Rainmeter JSON contains a sensitive credential field.".to_string());
    }
    Ok(RainmeterSchedulerPayload {
        output_path,
        payload_json,
        is_playing,
        stopped_update_interval_ms: stopped_update_interval_ms.clamp(1000, 60_000),
    })
}

fn stop_rainmeter_scheduler_inner(state: &tauri::State<AppState>) -> Result<(), String> {
    if let Some(scheduler) = state
        .rainmeter
        .lock()
        .map_err(|_| "Rainmeter scheduler state is unavailable.".to_string())?
        .take()
    {
        let _ = scheduler.sender.send(RainmeterSchedulerMessage::Stop);
    }
    Ok(())
}

#[derive(Default)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

fn parse_callback_query(callback_url: &str) -> Result<CallbackQuery, String> {
    let query = callback_url
        .split_once('?')
        .map(|(_, query)| query)
        .unwrap_or(callback_url);
    let query = query.split_once('#').map(|(query, _)| query).unwrap_or(query);
    let mut output = CallbackQuery::default();

    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        let decoded = decode_component(value);
        match key {
            "code" => output.code = Some(decoded),
            "state" => output.state = Some(decoded),
            "error" => output.error = Some(decoded),
            _ => {}
        }
    }

    if output.code.is_none() && output.error.is_none() {
        return Err("Spotify callback did not include an authorization result.".to_string());
    }

    Ok(output)
}

fn random_urlsafe(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
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

fn decode_component(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(&input[index + 1..index + 3], 16) {
                output.push(value);
                index += 3;
                continue;
            }
        }
        output.push(if bytes[index] == b'+' { b' ' } else { bytes[index] });
        index += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}

fn contains_sensitive_key(value: &serde_json::Value) -> bool {
    contains_sensitive_key_in_context(value, false)
}

fn contains_sensitive_key_in_context(value: &serde_json::Value, oauth_context: bool) -> bool {
    match value {
        serde_json::Value::Object(map) => map.iter().any(|(key, nested)| {
            let normalized_key = normalize_key(key);
            let nested_oauth_context = oauth_context
                || normalized_key.contains("oauth")
                || normalized_key.contains("spotify")
                || normalized_key.contains("auth");
            SENSITIVE_KEYS
                .iter()
                .any(|sensitive| normalized_key == normalize_key(sensitive))
                || (oauth_context && normalized_key == "code")
                || (normalized_key.contains("callback") && normalized_key.contains("url"))
                || contains_sensitive_key_in_context(nested, nested_oauth_context)
        }),
        serde_json::Value::Array(values) => values
            .iter()
            .any(|nested| contains_sensitive_key_in_context(nested, oauth_context)),
        _ => false,
    }
}

fn normalize_key(key: &str) -> String {
    key.chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(|character| character.to_lowercase())
        .collect()
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            validate_settings_json,
            write_rainmeter_json,
            start_spotify_pkce_auth,
            exchange_spotify_callback,
            start_rainmeter_scheduler,
            update_rainmeter_scheduler,
            stop_rainmeter_scheduler
        ])
        .run(tauri::generate_context!())
        .expect("error while running spotify wallpaper configurator");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn writes_rainmeter_json_file() {
        let output_path = unique_temp_path("rainmeter-output.json");
        let payload = r##"{
            "title": "Afterglow Atlas",
            "artists": ["Nami Kuroda"],
            "primaryColor": "#112233"
        }"##;

        write_rainmeter_json_file(&output_path, payload).expect("rainmeter JSON should write");

        let written = std::fs::read_to_string(&output_path).expect("rainmeter JSON should exist");
        assert!(written.contains("Afterglow Atlas"));
        let _ = std::fs::remove_file(output_path);
    }

    #[test]
    fn rejects_sensitive_keys_without_echoing_values() {
        let output_path = unique_temp_path("rainmeter-secret.json");
        let payload = r#"{"title":"Track","refreshToken":"secret-refresh-token"}"#;

        let error = write_rainmeter_json_file(&output_path, payload).expect_err("token fields are rejected");

        assert!(error.contains("sensitive credential"));
        assert!(!error.contains("secret-refresh-token"));
        assert!(!output_path.exists());
    }

    #[test]
    fn rejects_snake_case_oauth_keys() {
        let output_path = unique_temp_path("rainmeter-snake-secret.json");
        let payload = r#"{"title":"Track","oauth":{"access_token":"secret-access-token"}}"#;

        let error = write_rainmeter_json_file(&output_path, payload).expect_err("snake case token fields are rejected");

        assert!(error.contains("sensitive credential"));
        assert!(!error.contains("secret-access-token"));
        assert!(!output_path.exists());
    }

    #[test]
    fn rejects_oauth_authorization_code_keys_without_blocking_unrelated_code_fields() {
        let output_path = unique_temp_path("rainmeter-oauth-code.json");
        let payload = r#"{"title":"Track","oauth":{"code":"secret-auth-code"}}"#;

        let error = write_rainmeter_json_file(&output_path, payload).expect_err("oauth code fields are rejected");

        assert!(error.contains("sensitive credential"));
        assert!(!error.contains("secret-auth-code"));
        assert!(!output_path.exists());

        let safe_output_path = unique_temp_path("rainmeter-safe-code.json");
        let safe_payload = r#"{"title":"Track","status":{"code":"playing"}}"#;

        write_rainmeter_json_file(&safe_output_path, safe_payload)
            .expect("unrelated code fields should remain writable");
        let _ = std::fs::remove_file(safe_output_path);
    }

    fn unique_temp_path(file_name: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("spotify-wallpaper-rainmeter-{stamp}"))
            .join(file_name)
    }
}
