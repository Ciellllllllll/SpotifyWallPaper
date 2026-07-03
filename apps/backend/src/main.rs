use std::{env, net::SocketAddr, path::PathBuf};

use spotify_wallpaper_backend::{app, db::BackendDatabase, AppConfig, AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let bind_addr = bind_addr()?;
    let database = BackendDatabase::open(data_dir().join("backend.sqlite3"))?;
    let config = AppConfig {
        public_base_url: format!("http://{bind_addr}"),
    };
    let state = AppState::new(database, config);
    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    axum::serve(listener, app(state)).await?;
    Ok(())
}

fn bind_addr() -> anyhow::Result<SocketAddr> {
    let raw = env::var("SPOTIFY_WALLPAPER_BACKEND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:43879".to_string());
    let addr = raw.parse::<SocketAddr>()?;
    if !addr.ip().is_loopback() {
        anyhow::bail!("backend may only bind to a loopback address");
    }
    Ok(addr)
}

fn data_dir() -> PathBuf {
    env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir)
        .join("SpotifyWallPaper")
        .join("backend")
}
