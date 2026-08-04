#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, Instant},
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
const SPOTIFY_LOOPBACK_REDIRECT_URI: &str = "http://127.0.0.1:8899/callback";

#[derive(Debug)]
struct LoopbackRedirectTarget {
    bind_address: String,
    path: String,
}

struct SpotifyAuthRequest {
    auth_url: String,
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
    rainmeter: Mutex<Option<RainmeterScheduler>>,
}

#[derive(Serialize)]
struct SpotifyAuthorizeStatus {
    status: &'static str,
    error_code: Option<&'static str>,
}

#[derive(Deserialize)]
struct SpotifyTokenResponse {
    refresh_token: Option<String>,
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
async fn authorize_spotify_and_copy_swpt1(client_id: String) -> SpotifyAuthorizeStatus {
    match authorize_spotify_and_copy_swpt1_inner(client_id, SPOTIFY_LOOPBACK_REDIRECT_URI).await {
        Ok(()) => SpotifyAuthorizeStatus {
            status: "copied",
            error_code: None,
        },
        Err(error_code) => SpotifyAuthorizeStatus {
            status: "error",
            error_code: Some(error_code),
        },
    }
}

async fn authorize_spotify_and_copy_swpt1_inner(
    client_id: String,
    redirect_uri: &str,
) -> Result<(), &'static str> {
    let client_id = client_id.trim().to_string();
    let request =
        build_spotify_oauth_request(&client_id, &redirect_uri).map_err(|_| "invalid_input")?;
    let target =
        parse_loopback_redirect_uri(&request.redirect_uri).map_err(|_| "invalid_redirect_uri")?;
    let listener = TcpListener::bind(&target.bind_address).map_err(|_| "listener_unavailable")?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "listener_unavailable")?;

    open_url_with_system_browser(&request.auth_url).map_err(|_| "browser_open_failed")?;

    let callback_path = target.path;
    let callback = tauri::async_runtime::spawn_blocking(move || {
        wait_for_oauth_callback(listener, &callback_path)
    })
    .await
    .map_err(|_| "callback_unavailable")?
    .map_err(|_| "callback_unavailable")?;

    let callback = parse_callback_query(&callback).map_err(|_| "callback_invalid")?;
    if callback.state.as_deref() != Some(request.state.as_str()) {
        return Err("state_mismatch");
    }
    if callback.error.is_some() {
        return Err("authorization_denied");
    }
    let code = callback.code.ok_or("callback_invalid")?;
    let refresh_token =
        exchange_spotify_code(&client_id, &code, &request.redirect_uri, &request.verifier)
            .await
            .map_err(|_| "token_exchange_failed")?;
    let swpt1 = encode_wallpaper_engine_token(&client_id, &refresh_token)
        .map_err(|_| "token_encoding_failed")?;

    if !native_confirm_copy() {
        return Err("copy_not_confirmed");
    }
    copy_to_clipboard(&swpt1).map_err(|_| "clipboard_unavailable")?;
    Ok(())
}

#[tauri::command]
fn start_rainmeter_scheduler(
    output_path: String,
    payload_json: String,
    is_playing: bool,
    stopped_update_interval_ms: u64,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let payload = rainmeter_payload(
        output_path,
        payload_json,
        is_playing,
        stopped_update_interval_ms,
    )?;
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
    let payload = rainmeter_payload(
        output_path,
        payload_json,
        is_playing,
        stopped_update_interval_ms,
    )?;
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
    std::fs::write(
        &temp_path,
        serde_json::to_vec_pretty(&payload)
            .map_err(|_| "Rainmeter JSON could not be serialized.".to_string())?,
    )
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

fn parse_callback_query(callback_url: &str) -> Result<CallbackQuery, &'static str> {
    let query = callback_url
        .split_once('?')
        .map(|(_, query)| query)
        .unwrap_or(callback_url);
    let query = query
        .split_once('#')
        .map(|(query, _)| query)
        .unwrap_or(query);
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
        return Err("callback_missing_result");
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
        output.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
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

fn build_spotify_oauth_request(
    client_id: &str,
    redirect_uri: &str,
) -> Result<SpotifyAuthRequest, String> {
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

    Ok(SpotifyAuthRequest {
        auth_url,
        verifier,
        state: state_value,
        redirect_uri: redirect_uri.to_string(),
    })
}

async fn exchange_spotify_code(
    client_id: &str,
    code: &str,
    redirect_uri: &str,
    verifier: &str,
) -> Result<String, String> {
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", client_id),
        ("code_verifier", verifier),
    ];

    let response = reqwest::Client::new()
        .post("https://accounts.spotify.com/api/token")
        .form(&params)
        .send()
        .await
        .map_err(|_| "request_failed".to_string())?;

    if !response.status().is_success() {
        return Err("exchange_rejected".to_string());
    }

    let token = response
        .json::<SpotifyTokenResponse>()
        .await
        .map_err(|_| "response_malformed".to_string())?;
    let refresh_token = token
        .refresh_token
        .ok_or_else(|| "refresh_token_missing".to_string())?;

    Ok(refresh_token)
}

fn encode_wallpaper_engine_token(client_id: &str, refresh_token: &str) -> Result<String, String> {
    let payload = serde_json::json!({
        "v": 1,
        "clientId": client_id,
        "refreshToken": refresh_token,
    });
    let bytes = serde_json::to_vec(&payload).map_err(|_| "serialize_failed".to_string())?;
    Ok(format!(
        "swpt1.{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    ))
}

fn native_confirm_copy() -> bool {
    #[cfg(target_os = "windows")]
    {
        return Command::new("powershell")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Add-Type -AssemblyName PresentationFramework; $r=[System.Windows.MessageBox]::Show('Spotify authorization succeeded. Copy the one-time Wallpaper Engine token to the clipboard?','Spotify Wallpaper',[System.Windows.MessageBoxButton]::YesNo,[System.Windows.MessageBoxImage]::Question); if ($r -eq 'Yes') { exit 0 } else { exit 1 }",
            ])
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
    }

    #[cfg(target_os = "macos")]
    {
        return Command::new("osascript")
            .args([
                "-e",
                "display dialog \"Spotify authorization succeeded. Copy the one-time Wallpaper Engine token to the clipboard?\" with title \"Spotify Wallpaper\" buttons {\"Cancel\", \"Copy\"} default button \"Copy\"",
            ])
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return Command::new("zenity")
            .args([
                "--question",
                "--title=Spotify Wallpaper",
                "--text=Spotify authorization succeeded. Copy the one-time Wallpaper Engine token to the clipboard?",
            ])
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
    }

    #[allow(unreachable_code)]
    false
}

fn copy_to_clipboard(value: &str) -> Result<(), &'static str> {
    #[cfg(target_os = "windows")]
    {
        return pipe_to_command(
            Command::new("powershell").args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "$input | Set-Clipboard",
            ]),
            value,
        );
    }

    #[cfg(target_os = "macos")]
    {
        return pipe_to_command(Command::new("pbcopy"), value);
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if pipe_to_command(
            Command::new("xclip").args(["-selection", "clipboard"]),
            value,
        )
        .is_ok()
        {
            return Ok(());
        }
        return pipe_to_command(Command::new("xsel").args(["--clipboard", "--input"]), value);
    }

    #[allow(unreachable_code)]
    Err("clipboard_unavailable")
}

fn pipe_to_command(command: &mut Command, value: &str) -> Result<(), &'static str> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "clipboard_unavailable")?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(value.as_bytes())
            .map_err(|_| "clipboard_unavailable")?;
    } else {
        return Err("clipboard_unavailable");
    }
    child
        .wait()
        .map_err(|_| "clipboard_unavailable")?
        .success()
        .then_some(())
        .ok_or("clipboard_unavailable")
}

fn parse_loopback_redirect_uri(redirect_uri: &str) -> Result<LoopbackRedirectTarget, String> {
    let Some(without_scheme) = redirect_uri.strip_prefix("http://") else {
        return Err("Redirect URI must start with http://127.0.0.1.".to_string());
    };
    let Some((host_port, path_and_query)) = without_scheme.split_once('/') else {
        return Err("Redirect URI must include a callback path.".to_string());
    };
    let Some((host, port)) = host_port.rsplit_once(':') else {
        return Err("Redirect URI must include an explicit local port.".to_string());
    };
    if host != "127.0.0.1" {
        return Err("Redirect URI must use 127.0.0.1 for automatic authorization.".to_string());
    }
    let port = port
        .parse::<u16>()
        .map_err(|_| "Redirect URI port was invalid.".to_string())?;
    let path = format!(
        "/{}",
        path_and_query
            .split_once('?')
            .map(|(path, _)| path)
            .unwrap_or(path_and_query)
    );
    if path == "/" {
        return Err("Redirect URI must include a callback path.".to_string());
    }

    Ok(LoopbackRedirectTarget {
        bind_address: format!("{host}:{port}"),
        path,
    })
}

fn wait_for_oauth_callback(
    listener: TcpListener,
    callback_path: &str,
) -> Result<String, &'static str> {
    let deadline = Instant::now() + Duration::from_secs(300);
    let mut stream = loop {
        match listener.accept() {
            Ok((stream, _)) => break stream,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("callback_timeout");
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return Err("callback_listener_failed"),
        }
    };
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| "callback_timeout_config_failed")?;
    let mut request_line = String::new();
    {
        let mut reader = BufReader::new(&mut stream);
        reader
            .read_line(&mut request_line)
            .map_err(|_| "callback_read_failed")?;
    }

    let path = request_line
        .split_whitespace()
        .nth(1)
        .ok_or("callback_request_malformed")?;
    if !path.starts_with(callback_path) {
        let _ = write_http_response(
            &mut stream,
            "404 Not Found",
            "Spotify callback path did not match. Return to Spotify Wallpaper Configurator.",
        );
        return Err("callback_path_mismatch");
    }

    write_http_response(
        &mut stream,
        "200 OK",
        "Spotify authorization finished. You can close this browser tab and return to Spotify Wallpaper Configurator.",
    )
    .map_err(|_| "callback_response_failed")?;
    Ok(path.to_string())
}

fn write_http_response(stream: &mut impl Write, status: &str, message: &str) -> Result<(), String> {
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Spotify Wallpaper</title></head><body><h1>{message}</h1></body></html>"
    );
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|_| "Spotify callback response could not be written.".to_string())
}

fn open_url_with_system_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let status = Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .status();

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(url).status();

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(url).status();

    match status {
        Ok(status) if status.success() => Ok(()),
        _ => Err("System browser could not be opened.".to_string()),
    }
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            validate_settings_json,
            write_rainmeter_json,
            authorize_spotify_and_copy_swpt1,
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

        let error = write_rainmeter_json_file(&output_path, payload)
            .expect_err("token fields are rejected");

        assert!(error.contains("sensitive credential"));
        assert!(!error.contains("secret-refresh-token"));
        assert!(!output_path.exists());
    }

    #[test]
    fn rejects_snake_case_oauth_keys() {
        let output_path = unique_temp_path("rainmeter-snake-secret.json");
        let payload = r#"{"title":"Track","oauth":{"access_token":"secret-access-token"}}"#;

        let error = write_rainmeter_json_file(&output_path, payload)
            .expect_err("snake case token fields are rejected");

        assert!(error.contains("sensitive credential"));
        assert!(!error.contains("secret-access-token"));
        assert!(!output_path.exists());
    }

    #[test]
    fn rejects_oauth_authorization_code_keys_without_blocking_unrelated_code_fields() {
        let output_path = unique_temp_path("rainmeter-oauth-code.json");
        let payload = r#"{"title":"Track","oauth":{"code":"secret-auth-code"}}"#;

        let error = write_rainmeter_json_file(&output_path, payload)
            .expect_err("oauth code fields are rejected");

        assert!(error.contains("sensitive credential"));
        assert!(!error.contains("secret-auth-code"));
        assert!(!output_path.exists());

        let safe_output_path = unique_temp_path("rainmeter-safe-code.json");
        let safe_payload = r#"{"title":"Track","status":{"code":"playing"}}"#;

        write_rainmeter_json_file(&safe_output_path, safe_payload)
            .expect("unrelated code fields should remain writable");
        let _ = std::fs::remove_file(safe_output_path);
    }

    #[test]
    fn parses_loopback_redirect_uri_for_automatic_oauth() {
        let target = parse_loopback_redirect_uri("http://127.0.0.1:8899/callback")
            .expect("loopback redirect should parse");

        assert_eq!(target.bind_address, "127.0.0.1:8899");
        assert_eq!(target.path, "/callback");
    }

    #[test]
    fn rejects_non_loopback_redirect_uri_for_automatic_oauth() {
        let error = parse_loopback_redirect_uri("https://example.com/callback")
            .expect_err("external callback URLs are not supported");

        assert!(error.contains("127.0.0.1"));
    }

    #[test]
    fn encodes_the_legacy_token_without_returning_oauth_material() {
        let token = encode_wallpaper_engine_token("client-id", "refresh-token")
            .expect("token encoding should succeed");
        assert!(token.starts_with("swpt1."));
        let encoded = token.trim_start_matches("swpt1.");
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(encoded)
            .expect("token payload should be base64url");
        let payload: serde_json::Value =
            serde_json::from_slice(&bytes).expect("payload should be JSON");
        assert_eq!(payload["v"], 1);
        assert_eq!(payload["clientId"], "client-id");
        assert_eq!(payload["refreshToken"], "refresh-token");
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
