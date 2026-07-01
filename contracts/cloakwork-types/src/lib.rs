#![deny(warnings)]
#![no_std]

use soroban_sdk::{contracterror, contracttype, Address, Bytes, BytesN};

/// The current lifecycle status of a DomainCredential.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum CredentialStatus {
    /// Credential is valid and can be used to gate actions.
    Active,
    /// Credential has been explicitly revoked by the owner or admin.
    /// Revoked credentials cannot be renewed or reused.
    Revoked,
    /// Credential's expiry timestamp has passed.
    ///
    /// **IMPORTANT: This is a computed/display state only — the Registry never writes
    /// `Expired` to on-chain storage.** On-chain, an expired credential is stored as
    /// `Active` with `expires_at < current_ledger_timestamp`. The `Expired` variant
    /// exists for frontend display purposes and SDK convenience. Do NOT match this
    /// variant against data read directly from the chain — `require_valid_credential`
    /// will still panic for an expired-but-`Active`-stored credential.
    Expired,
}

/// On-chain credential record stored in the Registry.
///
/// The `commitment` is a Poseidon hash of the domain and nonce,
/// binding the credential to a specific domain without revealing it.
/// The `nullifier` is a Poseidon hash of the domain and a private secret,
/// used to prevent the same domain proof from issuing multiple credentials.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DomainCredential {
    /// Stellar address of the credential owner.
    pub owner: Address,
    /// `Poseidon(domain_bytes, nonce)` — binds credential to domain without revealing it.
    pub commitment: BytesN<32>,
    /// `Poseidon(domain_bytes, secret)` — unique per issuance, prevents replay.
    pub nullifier: BytesN<32>,
    /// Version of the Groth16 circuit used to verify this credential.
    pub verifier_version: u32,
    /// Ledger timestamp at the moment of issuance.
    pub issued_at: u64,
    /// `min(not_after, issued_at + 2_592_000)` — maximum 30 days.
    pub expires_at: u64,
    /// Current lifecycle status.
    pub status: CredentialStatus,
}

/// Public inputs extracted from the Groth16 proof, passed to `verify_and_issue`.
///
/// All values are commitments or public metadata — no private data.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PublicInputs {
    /// `Poseidon(domain_bytes, nonce)` — public commitment to the domain.
    pub domain_commitment: BytesN<32>,
    /// `Poseidon(record_value_bytes, nonce)` — public commitment to the TXT record.
    pub record_commitment: BytesN<32>,
    /// `Poseidon(stellar_address_bytes, nonce)` — public commitment to the owner address.
    pub owner_commitment: BytesN<32>,
    /// `Poseidon(domain_bytes, secret)` — nullifier for anti-replay enforcement.
    pub nullifier: BytesN<32>,
    /// Hash of the DNSKEY trust anchor used in the circuit.
    pub dnskey_root_hash: BytesN<32>,
    /// RRSIG inception timestamp (UNIX seconds). Maps to circuit `not_before`.
    pub not_before: u64,
    /// RRSIG expiration timestamp (UNIX seconds). Maps to circuit `not_after`.
    pub not_after: u64,
    /// Circuit version. Must match a registered verifying key.
    pub verifier_version: u32,
}

/// Verifying key data for a Groth16 circuit, stored per version in the Verifier contract.
#[contracttype]
#[derive(Clone)]
pub struct VerifyingKeyData {
    /// Alpha G1 point (64 bytes, uncompressed BN254).
    pub alpha_g1: BytesN<64>,
    /// Beta G2 point (128 bytes, uncompressed BN254).
    pub beta_g2: BytesN<128>,
    /// Gamma G2 point (128 bytes).
    pub gamma_g2: BytesN<128>,
    /// Delta G2 point (128 bytes).
    pub delta_g2: BytesN<128>,
    /// `[n_inputs + 1]` gamma_abc G1 points for linear combination.
    /// Encoded as concatenated 64-byte uncompressed G1 points.
    pub gamma_abc_g1: Bytes,
}

/// Errors returned by the Verifier contract.
#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum VerifierError {
    /// No verifying key registered for the requested version.
    VersionNotFound = 1,
    /// Proof failed the BN254 pairing check.
    VerificationFailed = 2,
    /// Public inputs are malformed or have incorrect length.
    InvalidPublicInputs = 3,
    /// The proof's `not_before` timestamp is in the future.
    ProofWindowNotYetActive = 4,
    /// The proof's `not_after` timestamp has already passed.
    ProofWindowExpired = 5,
    /// Caller is not authorized to perform this operation.
    Unauthorized = 6,
    /// Contract has already been initialized.
    AlreadyInitialized = 7,
}

/// Errors returned by the Registry contract.
#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RegistryError {
    /// The submitted nullifier has already been used to issue a credential.
    NullifierAlreadyUsed = 1,
    /// The ZK proof failed verification in the Verifier contract.
    ProofVerificationFailed = 2,
    /// The proof's validity window has expired.
    ProofWindowExpired = 3,
    /// The proof's validity window has not yet started.
    ProofWindowNotYetActive = 4,
    /// No credential found for the given nullifier.
    CredentialNotFound = 5,
    /// Credential has been revoked and cannot be used.
    CredentialRevoked = 6,
    /// Credential has expired (expires_at < current timestamp).
    CredentialExpired = 7,
    /// Caller is not the credential owner or admin.
    Unauthorized = 8,
    /// The requested verifier version is not active.
    VersionNotActive = 9,
    /// Contract has already been initialized.
    AlreadyInitialized = 10,
    /// A public input value is invalid (e.g. nullifier not 32 bytes).
    InvalidPublicInputs = 11,
}

/// Errors returned by the GatedAction demo contract.
#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GatedActionError {
    /// Contract has not been initialized.
    NotInitialized = 1,
    /// Contract has already been initialized.
    AlreadyInitialized = 2,
    /// No credential found for the given nullifier.
    CredentialNotFound = 3,
    /// Credential is invalid (revoked, expired, or wrong owner).
    CredentialInvalid = 4,
}
