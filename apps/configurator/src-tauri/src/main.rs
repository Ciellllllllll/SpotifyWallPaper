#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn validate_settings_json(settings_json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&settings_json)
        .map(|_| ())
        .map_err(|_| "Settings JSON is malformed.".to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![validate_settings_json])
        .run(tauri::generate_context!())
        .expect("error while running spotify wallpaper configurator");
}
