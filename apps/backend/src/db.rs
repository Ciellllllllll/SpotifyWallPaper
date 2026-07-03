use std::{
    path::Path,
    sync::{Arc, Mutex},
};

use rusqlite::{params, Connection, OptionalExtension};
use thiserror::Error;

use crate::crypto::{
    constant_time_eq, decrypt_string, encrypt_string, hash_pairing_token, random_bytes,
    CryptoError, EncryptionKey,
};

#[derive(Debug, Error)]
pub enum DbError {
    #[error("database error")]
    Sqlite(#[from] rusqlite::Error),
    #[error("cryptography error")]
    Crypto(#[from] CryptoError),
    #[error("database lock failed")]
    Lock,
}

#[derive(Clone)]
pub struct BackendDatabase {
    conn: Arc<Mutex<Connection>>,
}

pub struct StoredTokens {
    pub client_id: String,
    pub refresh_token: String,
    pub access_token: Option<String>,
    pub access_token_expires_at_ms: Option<i64>,
    pub encryption_key: EncryptionKey,
}

#[derive(Debug, Clone)]
pub struct LoadedTokens {
    pub client_id: String,
    pub refresh_token: String,
    pub access_token: Option<String>,
    pub access_token_expires_at_ms: Option<i64>,
}

impl BackendDatabase {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, DbError> {
        let conn = Connection::open(path)?;
        let database = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        database.migrate()?;
        Ok(database)
    }

    pub fn open_in_memory() -> Result<Self, DbError> {
        let conn = Connection::open_in_memory()?;
        let database = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        database.migrate()?;
        Ok(database)
    }

    pub fn provision_pairing_token(&self, pairing_token: &str) -> Result<EncryptionKey, DbError> {
        let salt = random_bytes::<32>();
        let hash = hash_pairing_token(pairing_token, &salt);
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        conn.execute(
            "INSERT INTO pairing(id, salt, token_hash) VALUES(1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET salt = excluded.salt, token_hash = excluded.token_hash",
            params![salt.as_slice(), hash],
        )?;
        EncryptionKey::derive(pairing_token, &salt).map_err(DbError::from)
    }

    pub fn store_pairing_and_tokens(
        &self,
        pairing_token: &str,
        client_id: &str,
        refresh_token: &str,
        access_token: Option<&str>,
        access_token_expires_at_ms: Option<i64>,
    ) -> Result<(), DbError> {
        let salt = random_bytes::<32>();
        let hash = hash_pairing_token(pairing_token, &salt);
        let encryption_key = EncryptionKey::derive(pairing_token, &salt)?;
        let (refresh_ciphertext, refresh_nonce) = encrypt_string(refresh_token, &encryption_key)?;
        let (access_ciphertext, access_nonce) = match access_token {
            Some(access_token) => {
                let (ciphertext, nonce) = encrypt_string(access_token, &encryption_key)?;
                (Some(ciphertext), Some(nonce.to_vec()))
            }
            None => (None, None),
        };

        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let transaction = conn.transaction()?;
        transaction.execute(
            "INSERT INTO pairing(id, salt, token_hash) VALUES(1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET salt = excluded.salt, token_hash = excluded.token_hash",
            params![salt.as_slice(), hash],
        )?;
        transaction.execute(
            "INSERT INTO credentials(
                id,
                client_id,
                refresh_token_ciphertext,
                refresh_token_nonce,
                access_token_ciphertext,
                access_token_nonce,
                access_token_expires_at_ms
             ) VALUES(1, ?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                client_id = excluded.client_id,
                refresh_token_ciphertext = excluded.refresh_token_ciphertext,
                refresh_token_nonce = excluded.refresh_token_nonce,
                access_token_ciphertext = excluded.access_token_ciphertext,
                access_token_nonce = excluded.access_token_nonce,
                access_token_expires_at_ms = excluded.access_token_expires_at_ms",
            params![
                client_id,
                refresh_ciphertext,
                refresh_nonce.as_slice(),
                access_ciphertext,
                access_nonce,
                access_token_expires_at_ms
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn pairing_is_configured(&self) -> Result<bool, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let exists: Option<i64> = conn
            .query_row("SELECT id FROM pairing WHERE id = 1", [], |row| row.get(0))
            .optional()?;
        Ok(exists.is_some())
    }

    pub fn verify_pairing_token(
        &self,
        pairing_token: &str,
    ) -> Result<Option<EncryptionKey>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let stored: Option<(Vec<u8>, Vec<u8>)> = conn
            .query_row(
                "SELECT salt, token_hash FROM pairing WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((salt, expected_hash)) = stored else {
            return Ok(None);
        };

        let actual_hash = hash_pairing_token(pairing_token, &salt);
        if !constant_time_eq(&actual_hash, &expected_hash) {
            return Ok(None);
        }

        Ok(Some(EncryptionKey::derive(pairing_token, &salt)?))
    }

    pub fn store_tokens(&self, tokens: &StoredTokens) -> Result<(), DbError> {
        let (refresh_ciphertext, refresh_nonce) =
            encrypt_string(&tokens.refresh_token, &tokens.encryption_key)?;
        let (access_ciphertext, access_nonce) = match tokens.access_token.as_deref() {
            Some(access_token) => {
                let (ciphertext, nonce) = encrypt_string(access_token, &tokens.encryption_key)?;
                (Some(ciphertext), Some(nonce.to_vec()))
            }
            None => (None, None),
        };

        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        conn.execute(
            "INSERT INTO credentials(
                id,
                client_id,
                refresh_token_ciphertext,
                refresh_token_nonce,
                access_token_ciphertext,
                access_token_nonce,
                access_token_expires_at_ms
             ) VALUES(1, ?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                client_id = excluded.client_id,
                refresh_token_ciphertext = excluded.refresh_token_ciphertext,
                refresh_token_nonce = excluded.refresh_token_nonce,
                access_token_ciphertext = excluded.access_token_ciphertext,
                access_token_nonce = excluded.access_token_nonce,
                access_token_expires_at_ms = excluded.access_token_expires_at_ms",
            params![
                tokens.client_id,
                refresh_ciphertext,
                refresh_nonce.as_slice(),
                access_ciphertext,
                access_nonce,
                tokens.access_token_expires_at_ms
            ],
        )?;
        Ok(())
    }

    pub fn load_tokens(&self, key: &EncryptionKey) -> Result<Option<LoadedTokens>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let row: Option<CredentialRow> = conn
            .query_row(
                "SELECT
                    client_id,
                    refresh_token_ciphertext,
                    refresh_token_nonce,
                    access_token_ciphertext,
                    access_token_nonce,
                    access_token_expires_at_ms
                 FROM credentials WHERE id = 1",
                [],
                |row| {
                    Ok(CredentialRow {
                        client_id: row.get(0)?,
                        refresh_token_ciphertext: row.get(1)?,
                        refresh_token_nonce: row.get(2)?,
                        access_token_ciphertext: row.get(3)?,
                        access_token_nonce: row.get(4)?,
                        access_token_expires_at_ms: row.get(5)?,
                    })
                },
            )
            .optional()?;
        let Some(row) = row else {
            return Ok(None);
        };

        let refresh_token =
            decrypt_string(&row.refresh_token_ciphertext, &row.refresh_token_nonce, key)?;
        let access_token = match (row.access_token_ciphertext, row.access_token_nonce) {
            (Some(ciphertext), Some(nonce)) => Some(decrypt_string(&ciphertext, &nonce, key)?),
            _ => None,
        };

        Ok(Some(LoadedTokens {
            client_id: row.client_id,
            refresh_token,
            access_token,
            access_token_expires_at_ms: row.access_token_expires_at_ms,
        }))
    }

    pub fn clear_tokens(&self) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        conn.execute("DELETE FROM credentials WHERE id = 1", [])?;
        Ok(())
    }

    fn migrate(&self) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS pairing (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                salt BLOB NOT NULL,
                token_hash BLOB NOT NULL
            );

            CREATE TABLE IF NOT EXISTS credentials (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                client_id TEXT NOT NULL,
                refresh_token_ciphertext BLOB NOT NULL,
                refresh_token_nonce BLOB NOT NULL,
                access_token_ciphertext BLOB,
                access_token_nonce BLOB,
                access_token_expires_at_ms INTEGER
            );
            ",
        )?;
        Ok(())
    }
}

struct CredentialRow {
    client_id: String,
    refresh_token_ciphertext: Vec<u8>,
    refresh_token_nonce: Vec<u8>,
    access_token_ciphertext: Option<Vec<u8>>,
    access_token_nonce: Option<Vec<u8>>,
    access_token_expires_at_ms: Option<i64>,
}
