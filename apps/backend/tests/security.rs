use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use spotify_wallpaper_backend::{
    app,
    crypto::EncryptionKey,
    db::{BackendDatabase, StoredTokens},
    AppConfig, AppState,
};
use tempfile::tempdir;
use tower::ServiceExt;

#[test]
fn sqlite_file_does_not_store_refresh_token_or_pairing_token_plaintext() {
    let dir = tempdir().expect("temp dir");
    let db_path = dir.path().join("backend.sqlite3");
    let database = BackendDatabase::open(&db_path).expect("open database");
    let pairing_token = "pairing-token-secret";
    let refresh_token = "refresh-token-secret";

    let key = database
        .provision_pairing_token(pairing_token)
        .expect("provision pairing token");
    database
        .store_tokens(&StoredTokens {
            client_id: "spotify-client-id".to_string(),
            refresh_token: refresh_token.to_string(),
            access_token: None,
            access_token_expires_at_ms: None,
            encryption_key: key,
        })
        .expect("store encrypted tokens");
    drop(database);

    let bytes = std::fs::read(&db_path).expect("read sqlite database");
    let sqlite = String::from_utf8_lossy(&bytes);

    assert!(!sqlite.contains(refresh_token));
    assert!(!sqlite.contains(pairing_token));
}

#[test]
fn encrypted_refresh_token_round_trips_only_with_pairing_token_key() {
    let dir = tempdir().expect("temp dir");
    let db_path = dir.path().join("backend.sqlite3");
    let database = BackendDatabase::open(&db_path).expect("open database");
    let key = database
        .provision_pairing_token("pairing-token-secret")
        .expect("provision pairing token");

    database
        .store_tokens(&StoredTokens {
            client_id: "spotify-client-id".to_string(),
            refresh_token: "refresh-token-secret".to_string(),
            access_token: Some("access-token-secret".to_string()),
            access_token_expires_at_ms: Some(123_456),
            encryption_key: key,
        })
        .expect("store encrypted tokens");

    let verified_key = database
        .verify_pairing_token("pairing-token-secret")
        .expect("verify pairing token")
        .expect("pairing key");
    let tokens = database
        .load_tokens(&verified_key)
        .expect("load encrypted tokens")
        .expect("tokens");
    assert_eq!(tokens.refresh_token, "refresh-token-secret");

    let wrong_key = EncryptionKey::from_bytes([7; 32]);
    assert!(database.load_tokens(&wrong_key).is_err());
}

#[tokio::test]
async fn playback_endpoint_requires_authorization_bearer() {
    let dir = tempdir().expect("temp dir");
    let database =
        BackendDatabase::open(dir.path().join("backend.sqlite3")).expect("open database");
    let state = AppState::new(database, AppConfig::default());
    let response = app(state)
        .oneshot(
            Request::builder()
                .uri("/api/playback")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn auth_start_does_not_replace_existing_pairing_token() {
    let dir = tempdir().expect("temp dir");
    let database =
        BackendDatabase::open(dir.path().join("backend.sqlite3")).expect("open database");
    let key = database
        .provision_pairing_token("existing-pairing-token")
        .expect("provision existing pairing");
    database
        .store_tokens(&StoredTokens {
            client_id: "spotify-client-id".to_string(),
            refresh_token: "refresh-token-secret".to_string(),
            access_token: None,
            access_token_expires_at_ms: None,
            encryption_key: key,
        })
        .expect("store existing tokens");

    let state = AppState::new(database.clone(), AppConfig::default());
    let response = app(state)
        .oneshot(
            Request::builder()
                .uri("/auth/start?clientId=spotify-client-id")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    let verified_key = database
        .verify_pairing_token("existing-pairing-token")
        .expect("verify existing pairing")
        .expect("existing key");
    let tokens = database
        .load_tokens(&verified_key)
        .expect("load existing tokens")
        .expect("tokens");
    assert_eq!(tokens.refresh_token, "refresh-token-secret");
}
