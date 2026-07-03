pub mod crypto;
pub mod db;
pub mod routes;
pub mod spotify;

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use db::BackendDatabase;
use spotify::{RealSpotifyClient, SpotifyClient};

pub use routes::app;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub public_base_url: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            public_base_url: "http://127.0.0.1:43879".to_string(),
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub database: BackendDatabase,
    pub config: AppConfig,
    pub pending_auth: Arc<Mutex<HashMap<String, PendingAuthSession>>>,
    pub access_token: Arc<Mutex<Option<CachedAccessToken>>>,
    pub spotify: Arc<dyn SpotifyClient>,
}

impl AppState {
    pub fn new(database: BackendDatabase, config: AppConfig) -> Self {
        Self {
            database,
            config,
            pending_auth: Arc::new(Mutex::new(HashMap::new())),
            access_token: Arc::new(Mutex::new(None)),
            spotify: Arc::new(RealSpotifyClient::default()),
        }
    }
}

#[derive(Clone)]
pub struct CachedAccessToken {
    pub client_id: String,
    pub access_token: String,
    pub expires_at_ms: i64,
}

#[derive(Clone)]
pub struct PendingAuthSession {
    pub client_id: String,
    pub redirect_uri: String,
    pub code_verifier: String,
    pub pairing_token: String,
    pub expires_at_ms: i64,
}
