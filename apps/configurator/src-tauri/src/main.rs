#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;

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
        .invoke_handler(tauri::generate_handler![
            validate_settings_json,
            write_rainmeter_json
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
