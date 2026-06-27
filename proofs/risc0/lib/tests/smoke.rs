//! Smoke test for `cloakwork-risc0-lib` — proves the crypto core that the rest of
//! this port depends on (RISC0 guest, Noir stretch circuit, both contracts)
//! still does what it did in the original repo, since this crate was carried
//! over unchanged. Run with: `cargo test -p cloakwork-risc0-lib`.

use ecdsa::signature::Signer;
use p256::ecdsa::{Signature, SigningKey};
use rand_core::OsRng;
use cloakwork_risc0_lib::verify_ecdsa_signature;

#[test]
fn smoke_valid_ecdsa_signature_verifies() {
    let signing_key = SigningKey::random(&mut OsRng);
    let verifying_key_bytes = signing_key
        .verifying_key()
        .to_encoded_point(false)
        .as_bytes()
        .to_vec();

    let message = b"example.com. 3600 IN A 1.2.3.4".to_vec();
    let signature: Signature = signing_key.sign(&message);

    let is_valid = verify_ecdsa_signature(
        verifying_key_bytes,
        message,
        signature.to_bytes().to_vec(),
    );

    assert!(is_valid, "a correctly-signed RRset message must verify");
}

#[test]
fn smoke_tampered_message_fails_verification() {
    let signing_key = SigningKey::random(&mut OsRng);
    let verifying_key_bytes = signing_key
        .verifying_key()
        .to_encoded_point(false)
        .as_bytes()
        .to_vec();

    let original = b"example.com. 3600 IN A 1.2.3.4".to_vec();
    let signature: Signature = signing_key.sign(&original);

    let tampered = b"evil.example. 3600 IN A 6.6.6.6".to_vec();

    let is_valid = verify_ecdsa_signature(
        verifying_key_bytes,
        tampered,
        signature.to_bytes().to_vec(),
    );

    assert!(!is_valid, "a signature over a different message must not verify");
}

#[test]
fn smoke_wrong_key_fails_verification() {
    let signing_key = SigningKey::random(&mut OsRng);
    let other_key = SigningKey::random(&mut OsRng);
    let wrong_verifying_key_bytes = other_key
        .verifying_key()
        .to_encoded_point(false)
        .as_bytes()
        .to_vec();

    let message = b"example.com. 3600 IN A 1.2.3.4".to_vec();
    let signature: Signature = signing_key.sign(&message);

    let is_valid = verify_ecdsa_signature(
        wrong_verifying_key_bytes,
        message,
        signature.to_bytes().to_vec(),
    );

    assert!(!is_valid, "a signature checked against the wrong key must not verify");
}

