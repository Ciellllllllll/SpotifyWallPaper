use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use thiserror::Error;
use zeroize::Zeroize;

const TOKEN_ENCRYPTION_INFO: &[u8] = b"spotify-wallpaper-backend:refresh-token:v1";
const PAIRING_HASH_DOMAIN: &[u8] = b"spotify-wallpaper-backend:pairing-token:v1";
const PKCE_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("encryption failed")]
    Encrypt,
    #[error("decryption failed")]
    Decrypt,
    #[error("key derivation failed")]
    KeyDerivation,
}

#[derive(Clone)]
pub struct EncryptionKey([u8; 32]);

impl EncryptionKey {
    pub fn derive(pairing_token: &str, salt: &[u8]) -> Result<Self, CryptoError> {
        let hk = Hkdf::<Sha256>::new(Some(salt), pairing_token.as_bytes());
        let mut key = [0_u8; 32];
        hk.expand(TOKEN_ENCRYPTION_INFO, &mut key)
            .map_err(|_| CryptoError::KeyDerivation)?;
        Ok(Self(key))
    }

    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    fn cipher(&self) -> Aes256Gcm {
        Aes256Gcm::new_from_slice(&self.0).expect("AES-256-GCM key length is fixed")
    }
}

impl Drop for EncryptionKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0_u8; N];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

pub fn hash_pairing_token(pairing_token: &str, salt: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(PAIRING_HASH_DOMAIN);
    hasher.update(salt);
    hasher.update(pairing_token.as_bytes());
    hasher.finalize().to_vec()
}

pub fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    left.ct_eq(right).into()
}

pub fn encrypt_string(
    value: &str,
    key: &EncryptionKey,
) -> Result<(Vec<u8>, [u8; 12]), CryptoError> {
    let nonce = random_bytes::<12>();
    let ciphertext = key
        .cipher()
        .encrypt(Nonce::from_slice(&nonce), value.as_bytes())
        .map_err(|_| CryptoError::Encrypt)?;
    Ok((ciphertext, nonce))
}

pub fn decrypt_string(
    ciphertext: &[u8],
    nonce: &[u8],
    key: &EncryptionKey,
) -> Result<String, CryptoError> {
    if nonce.len() != 12 {
        return Err(CryptoError::Decrypt);
    }

    let plaintext = key
        .cipher()
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| CryptoError::Decrypt)?;
    String::from_utf8(plaintext).map_err(|_| CryptoError::Decrypt)
}

pub fn generate_code_verifier() -> String {
    let mut bytes = [0_u8; 96];
    OsRng.fill_bytes(&mut bytes);
    bytes
        .iter()
        .map(|byte| PKCE_ALPHABET[*byte as usize % PKCE_ALPHABET.len()] as char)
        .collect()
}

pub fn code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

pub fn random_state() -> String {
    URL_SAFE_NO_PAD.encode(random_bytes::<32>())
}
