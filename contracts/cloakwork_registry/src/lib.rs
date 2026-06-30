#![deny(warnings)]
#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error, Address, Bytes, BytesN, Env, IntoVal, Vec,
};
use cloakwork_types::{
    CredentialStatus, DomainCredential, PublicInputs, RegistryError,
};

// ─── Storage Keys ─────────────────────────────────────────────────────────────

/// Storage key variants used by the Registry contract.
///
/// - `Credential(BytesN<32>)` — persistent, keyed by nullifier.
/// - `NullifierUsed(BytesN<32>)` — persistent, boolean flag per nullifier.
/// - `OwnerCredentials(Address)` — persistent, list of nullifiers per address.
/// - `Admin` — persistent, the authorized admin address.
/// - `VerifierContract` — persistent, the deployed verifier contract address.
/// - `Initialized` — instance storage, initialization guard.
#[contracttype]
#[derive(Clone)]
enum DataKey {
    /// `DomainCredential` keyed by nullifier (32 bytes).
    Credential(BytesN<32>),
    /// `bool`: true if this nullifier has been used to issue a credential.
    NullifierUsed(BytesN<32>),
    /// `Vec<BytesN<32>>`: list of nullifiers owned by this address.
    OwnerCredentials(Address),
    /// `Address`: admin who can revoke any credential.
    Admin,
    /// `Address`: the deployed verifier contract.
    VerifierContract,
    /// `bool`: initialization guard (stored in instance storage).
    Initialized,
}

/// Minimum remaining TTL before an extension is triggered (~5.8 days at 5 s/ledger).
const TTL_THRESHOLD: u32 = 100_000;
/// Target TTL after extension (~30 days at 5 s/ledger).
const TTL_TARGET: u32 = 535_680;
/// Maximum credential lifetime: 30 days in seconds.
const MAX_CREDENTIAL_TTL_SECS: u64 = 2_592_000;

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct CloakworkRegistry;

#[contractimpl]
impl CloakworkRegistry {
    /// Initialize the registry with an admin address and verifier contract address.
    ///
    /// Can only be called once. Both addresses are written to persistent storage
    /// with TTL extended to `TTL_TARGET`. The initialization guard is stored in
    /// instance storage so it survives ledger archival of persistent entries.
    ///
    /// # Errors
    /// * [`RegistryError::AlreadyInitialized`] — if called more than once.
    pub fn initialize(
        env: Env,
        admin: Address,
        verifier_contract: Address,
    ) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(RegistryError::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Admin, TTL_THRESHOLD, TTL_TARGET);

        env.storage()
            .persistent()
            .set(&DataKey::VerifierContract, &verifier_contract);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::VerifierContract, TTL_THRESHOLD, TTL_TARGET);

        env.storage().instance().set(&DataKey::Initialized, &true);
        Ok(())
    }

    /// Verify a Groth16 proof and issue a `DomainCredential` if valid.
    ///
    /// Strict order of operations (per spec requirements 7.3–7.11):
    /// 1. Check nullifier not already used → [`RegistryError::NullifierAlreadyUsed`]
    /// 2. Check `not_before <= current timestamp` → [`RegistryError::ProofWindowNotYetActive`]
    /// 3. Check `not_after >= current timestamp` → [`RegistryError::ProofWindowExpired`]
    /// 4. Cross-contract call to verifier; `Ok(false)` or error → [`RegistryError::ProofVerificationFailed`]
    /// 5. Construct `DomainCredential` with `expires_at = min(not_after, issued_at + 2_592_000)`
    /// 6. Write credential, mark nullifier used, append to owner index; extend all TTLs.
    ///
    /// # Errors
    /// See [`RegistryError`] variants.
    pub fn verify_and_issue(
        env: Env,
        owner: Address,
        public_inputs: PublicInputs,
        proof: Bytes,
    ) -> Result<DomainCredential, RegistryError> {
        owner.require_auth();

        // Step 1: nullifier uniqueness check BEFORE any crypto operations.
        let nullifier_key = DataKey::NullifierUsed(public_inputs.nullifier.clone());
        if env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&nullifier_key)
            .unwrap_or(false)
        {
            return Err(RegistryError::NullifierAlreadyUsed);
        }

        // Step 2: proof window — not_before check.
        let now = env.ledger().timestamp();
        if public_inputs.not_before > now {
            return Err(RegistryError::ProofWindowNotYetActive);
        }

        // Step 3: proof window — not_after check.
        if public_inputs.not_after < now {
            return Err(RegistryError::ProofWindowExpired);
        }

        // Step 4: cross-contract call to verifier.
        let verifier: Address = env
            .storage()
            .persistent()
            .get(&DataKey::VerifierContract)
            .ok_or(RegistryError::Unauthorized)?;

        // Build the public_inputs vector (8 elements) for the verifier.
        // Order MUST match the circuit's public signal declaration:
        // [0]=domain_commitment, [1]=record_commitment, [2]=owner_commitment,
        // [3]=nullifier, [4]=not_before, [5]=not_after,
        // [6]=dnskey_root_hash, [7]=verifier_version
        let mut inputs_vec: Vec<BytesN<32>> = Vec::new(&env);
        inputs_vec.push_back(public_inputs.domain_commitment.clone()); // [0]
        inputs_vec.push_back(public_inputs.record_commitment.clone());  // [1]
        inputs_vec.push_back(public_inputs.owner_commitment.clone());   // [2]
        inputs_vec.push_back(public_inputs.nullifier.clone());          // [3]
        inputs_vec.push_back(u64_to_bytes32(&env, public_inputs.not_before)); // [4]
        inputs_vec.push_back(u64_to_bytes32(&env, public_inputs.not_after));  // [5]
        inputs_vec.push_back(public_inputs.dnskey_root_hash.clone());   // [6]
        inputs_vec.push_back(u32_to_bytes32(&env, public_inputs.verifier_version)); // [7]

        let verified: Result<bool, soroban_sdk::Error> = env.invoke_contract(
            &verifier,
            &soroban_sdk::Symbol::new(&env, "verify_proof"),
            soroban_sdk::vec![
                &env,
                proof.into_val(&env),
                inputs_vec.into_val(&env),
                public_inputs.verifier_version.into_val(&env),
            ],
        );

        match verified {
            Ok(true) => {}
            _ => return Err(RegistryError::ProofVerificationFailed),
        }

        // Step 5: construct credential.
        // expires_at = min(not_after, issued_at + MAX_CREDENTIAL_TTL_SECS)
        let issued_at = now;
        let max_expiry = issued_at.saturating_add(MAX_CREDENTIAL_TTL_SECS);
        let expires_at = if public_inputs.not_after < max_expiry {
            public_inputs.not_after
        } else {
            max_expiry
        };

        let credential = DomainCredential {
            owner: owner.clone(),
            commitment: public_inputs.domain_commitment.clone(),
            nullifier: public_inputs.nullifier.clone(),
            verifier_version: public_inputs.verifier_version,
            issued_at,
            expires_at,
            status: CredentialStatus::Active,
        };

        // Step 6: write credential keyed by nullifier, extend TTL.
        let cred_key = DataKey::Credential(public_inputs.nullifier.clone());
        env.storage().persistent().set(&cred_key, &credential);
        env.storage()
            .persistent()
            .extend_ttl(&cred_key, TTL_THRESHOLD, TTL_TARGET);

        // Mark nullifier as used; extend TTL.
        env.storage().persistent().set(&nullifier_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&nullifier_key, TTL_THRESHOLD, TTL_TARGET);

        // Append nullifier to owner's credential list; extend TTL.
        let owner_key = DataKey::OwnerCredentials(owner.clone());
        let mut owner_nullifiers: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&owner_key)
            .unwrap_or_else(|| Vec::new(&env));
        owner_nullifiers.push_back(public_inputs.nullifier.clone());
        env.storage().persistent().set(&owner_key, &owner_nullifiers);
        env.storage()
            .persistent()
            .extend_ttl(&owner_key, TTL_THRESHOLD, TTL_TARGET);

        Ok(credential)
    }

    /// Get the credential associated with a nullifier, or `None` if not found.
    ///
    /// Extends storage TTL on every successful read.
    pub fn get_credential(env: Env, nullifier: BytesN<32>) -> Option<DomainCredential> {
        let key = DataKey::Credential(nullifier);
        let cred: Option<DomainCredential> = env.storage().persistent().get(&key);
        if cred.is_some() {
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_THRESHOLD, TTL_TARGET);
        }
        cred
    }

    /// Get all nullifiers associated with an owner address.
    ///
    /// Returns an empty `Vec` if the owner has no credentials.
    pub fn get_credentials_by_owner(env: Env, owner: Address) -> Vec<BytesN<32>> {
        let key = DataKey::OwnerCredentials(owner);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Revoke a credential. Callable by the credential owner or the admin.
    ///
    /// In Soroban, `require_auth` succeeds if the invoker (or a top-level signer)
    /// has pre-authorized the call for that address. We attempt owner auth first;
    /// if the owner is different from the admin, we also attempt admin auth.
    /// Because only one party signs per invocation, exactly one `require_auth`
    /// will succeed; the other is not reached.
    ///
    /// # Errors
    /// * [`RegistryError::CredentialNotFound`] — nullifier not in registry.
    /// * [`RegistryError::Unauthorized`] — no admin registered.
    /// * [`RegistryError::CredentialRevoked`] — credential is already revoked.
    pub fn revoke(env: Env, caller: Address, nullifier: BytesN<32>) -> Result<(), RegistryError> {
        let cred_key = DataKey::Credential(nullifier.clone());
        let mut cred: DomainCredential = env
            .storage()
            .persistent()
            .get(&cred_key)
            .ok_or(RegistryError::CredentialNotFound)?;

        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::Unauthorized)?;

        // The caller must be either the credential owner or the admin.
        if caller != cred.owner && caller != admin {
            return Err(RegistryError::Unauthorized);
        }
        caller.require_auth();

        if cred.status == CredentialStatus::Revoked {
            return Err(RegistryError::CredentialRevoked);
        }

        cred.status = CredentialStatus::Revoked;
        env.storage().persistent().set(&cred_key, &cred);
        env.storage()
            .persistent()
            .extend_ttl(&cred_key, TTL_THRESHOLD, TTL_TARGET);
        Ok(())
    }

    /// Renew a credential by extending its expiry. Callable by the owner only.
    ///
    /// The new expiry must be strictly in the future; the credential must be Active.
    /// Storage TTL is extended on success.
    ///
    /// # Errors
    /// * [`RegistryError::CredentialNotFound`] — nullifier not in registry.
    /// * [`RegistryError::CredentialRevoked`] — cannot renew a revoked credential.
    /// * [`RegistryError::InvalidPublicInputs`] — `new_expires_at` is not in the future.
    pub fn renew(
        env: Env,
        nullifier: BytesN<32>,
        new_expires_at: u64,
    ) -> Result<(), RegistryError> {
        let cred_key = DataKey::Credential(nullifier.clone());
        let mut cred: DomainCredential = env
            .storage()
            .persistent()
            .get(&cred_key)
            .ok_or(RegistryError::CredentialNotFound)?;

        cred.owner.require_auth();

        if cred.status == CredentialStatus::Revoked {
            return Err(RegistryError::CredentialRevoked);
        }

        let now = env.ledger().timestamp();
        if new_expires_at <= now {
            return Err(RegistryError::InvalidPublicInputs);
        }

        cred.expires_at = new_expires_at;
        env.storage().persistent().set(&cred_key, &cred);
        env.storage()
            .persistent()
            .extend_ttl(&cred_key, TTL_THRESHOLD, TTL_TARGET);
        Ok(())
    }

    /// Assert that a credential is valid for `owner` and `nullifier`.
    ///
    /// Panics with the appropriate [`RegistryError`] if:
    /// - The credential does not exist.
    /// - The `owner` does not match the stored credential owner.
    /// - The credential status is [`CredentialStatus::Revoked`].
    /// - The credential has expired (`expires_at < current timestamp`).
    ///
    /// Extends storage TTL on every access.
    pub fn require_valid_credential(env: Env, owner: Address, nullifier: BytesN<32>) {
        let cred_key = DataKey::Credential(nullifier.clone());
        let cred: DomainCredential = env
            .storage()
            .persistent()
            .get(&cred_key)
            .unwrap_or_else(|| panic_with_error!(&env, RegistryError::CredentialNotFound));

        if cred.owner != owner {
            panic_with_error!(&env, RegistryError::Unauthorized);
        }
        if cred.status == CredentialStatus::Revoked {
            panic_with_error!(&env, RegistryError::CredentialRevoked);
        }
        let now = env.ledger().timestamp();
        if cred.expires_at < now {
            panic_with_error!(&env, RegistryError::CredentialExpired);
        }

        env.storage()
            .persistent()
            .extend_ttl(&cred_key, TTL_THRESHOLD, TTL_TARGET);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Pack a `u64` as a big-endian value in the last 8 bytes of a 32-byte field element.
///
/// This matches the encoding expected by the Groth16 circuit for timestamp inputs.
fn u64_to_bytes32(env: &Env, val: u64) -> BytesN<32> {
    let mut arr = [0u8; 32];
    let be = val.to_be_bytes();
    arr[24..32].copy_from_slice(&be);
    BytesN::from_array(env, &arr)
}

/// Pack a `u32` as a big-endian value in the last 4 bytes of a 32-byte field element.
///
/// This matches the encoding expected by the Groth16 circuit for the verifier version.
fn u32_to_bytes32(env: &Env, val: u32) -> BytesN<32> {
    let mut arr = [0u8; 32];
    let be = val.to_be_bytes();
    arr[28..32].copy_from_slice(&be);
    BytesN::from_array(env, &arr)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger, LedgerInfo};
    use soroban_sdk::{Address, Bytes, BytesN, Env};
    use cloakwork_types::{CredentialStatus, PublicInputs, RegistryError};

    // ── Mock Verifier ─────────────────────────────────────────────────────────

    /// A minimal mock verifier that always returns Ok(true) for any proof.
    /// Used to test registry logic without real BN254 arithmetic.
    #[contract]
    pub struct MockVerifier;

    #[contractimpl]
    impl MockVerifier {
        pub fn verify_proof(
            _env: Env,
            _proof: Bytes,
            _public_inputs: soroban_sdk::Vec<BytesN<32>>,
            _version: u32,
        ) -> Result<bool, cloakwork_types::VerifierError> {
            Ok(true)
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn make_env() -> Env {
        let env = Env::default();
        env.mock_all_auths();
        env
    }

    fn deploy_registry(env: &Env) -> (Address, CloakworkRegistryClient<'_>) {
        let id = env.register(CloakworkRegistry, ());
        let client = CloakworkRegistryClient::new(env, &id);
        (id, client)
    }

    fn deploy_mock_verifier(env: &Env) -> Address {
        env.register(MockVerifier, ())
    }

    fn deploy_and_init(env: &Env) -> (Address, CloakworkRegistryClient<'_>, Address, Address) {
        let admin = Address::generate(env);
        let verifier = deploy_mock_verifier(env);
        let (id, client) = deploy_registry(env);
        client.initialize(&admin, &verifier);
        (id, client, admin, verifier)
    }

    /// Build a dummy `PublicInputs` with all-zero commitments.
    fn dummy_inputs(env: &Env, now: u64) -> PublicInputs {
        let zeros: BytesN<32> = BytesN::from_array(env, &[0u8; 32]);
        PublicInputs {
            domain_commitment: zeros.clone(),
            record_commitment: zeros.clone(),
            owner_commitment: zeros.clone(),
            nullifier: zeros.clone(),
            dnskey_root_hash: zeros.clone(),
            not_before: now - 10,
            not_after: now + 10_000,
            verifier_version: 1,
        }
    }

    /// Build dummy `PublicInputs` with a specific nullifier byte.
    fn dummy_inputs_with_nullifier(env: &Env, now: u64, nullifier_byte: u8) -> PublicInputs {
        let zeros: BytesN<32> = BytesN::from_array(env, &[0u8; 32]);
        let mut null_arr = [0u8; 32];
        null_arr[0] = nullifier_byte;
        PublicInputs {
            domain_commitment: zeros.clone(),
            record_commitment: zeros.clone(),
            owner_commitment: zeros.clone(),
            nullifier: BytesN::from_array(env, &null_arr),
            dnskey_root_hash: zeros.clone(),
            not_before: now - 10,
            not_after: now + 10_000,
            verifier_version: 1,
        }
    }

    // ── initialize tests ──────────────────────────────────────────────────────

    #[test]
    fn test_initialize_success() {
        let env = make_env();
        let (_id, client, _admin, _verifier) = deploy_and_init(&env);
        // Reaching here without panic confirms initialize succeeded.
        let _ = client;
    }

    #[test]
    fn test_initialize_double_init_fails() {
        let env = make_env();
        let (_id, client, admin, verifier) = deploy_and_init(&env);
        let result = client.try_initialize(&admin, &verifier);
        assert_eq!(
            result,
            Err(Ok(RegistryError::AlreadyInitialized)),
            "second initialize must return AlreadyInitialized"
        );
    }

    // ── verify_and_issue tests ────────────────────────────────────────────────

    #[test]
    fn test_verify_and_issue_success() {
        let env = make_env();
        let (_id, client, _admin, _verifier) = deploy_and_init(&env);
        env.ledger().set(LedgerInfo {
            timestamp: 1_000_000,
            protocol_version: 26,
            sequence_number: 100,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 16,
            min_persistent_entry_ttl: 4096,
            max_entry_ttl: 6_312_000,
        });
        let owner = Address::generate(&env);
        let inputs = dummy_inputs(&env, 1_000_000);
        let proof = Bytes::from_array(&env, &[0u8; 256]);

        let result = client.try_verify_and_issue(&owner, &inputs, &proof);
        assert!(result.is_ok(), "valid issuance must succeed");
        let cred = result.unwrap().unwrap();
        assert_eq!(cred.status, CredentialStatus::Active);
        assert_eq!(cred.owner, owner);
        assert_eq!(cred.verifier_version, 1);
    }

    #[test]
    fn test_verify_and_issue_nullifier_reuse_fails() {
        let env = make_env();
        let (_id, client, _admin, _verifier) = deploy_and_init(&env);
        env.ledger().set(LedgerInfo {
            timestamp: 1_000_000,
            protocol_version: 26,
            sequence_number: 100,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 16,
            min_persistent_entry_ttl: 4096,
            max_entry_ttl: 6_312_000,
        });
        let owner = Address::generate(&env);
        let inputs = dummy_inputs(&env, 1_000_000);
        let proof = Bytes::from_array(&env, &[0u8; 256]);

        // First issuance succeeds.
        client.verify_and_issue(&owner, &inputs, &proof);

        // Second issuance with same nullifier must fail.
        let result = client.try_verify_and_issue(&owner, &inputs, &proof);
        assert!(
            matches!(result, Err(Ok(RegistryError::NullifierAlreadyUsed))),
            "duplicate nullifier must return NullifierAlreadyUsed"
        );
    }

    #[test]
    fn test_verify_and_issue_proof_window_not_yet_active() {
        let env = make_env();
        let (_id, client, _admin, _verifier) = deploy_and_init(&env);
        env.ledger().set(LedgerInfo {
            timestamp: 1_000,
            protocol_version: 26,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 16,
            min_persistent_entry_ttl: 4096,
            max_entry_ttl: 6_312_000,
        });
        let owner = Address::generate(&env);
        let zeros: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);
        // not_before is in the future relative to ledger timestamp
        let inputs = PublicInputs {
            domain_commitment: zeros.clone(),
            record_commitment: zeros.clone(),
            owner_commitment: zeros.clone(),
            nullifier: zeros.clone(),
            dnskey_root_hash: zeros.clone(),
            not_before: 5_000,
            not_after: 50_000,
            verifier_version: 1,
        };
        let proof = Bytes::from_array(&env, &[0u8; 256]);
        let result = client.try_verify_and_issue(&owner, &inputs, &proof);
        assert!(matches!(result, Err(Ok(RegistryError::ProofWindowNotYetActive))));
    }

    #[test]
    fn test_verify_and_issue_proof_window_expired() {
        let env = make_env();
        let (_id, client, _admin, _verifier) = deploy_and_init(&env);
        env.ledger().set(LedgerInfo {
            timestamp: 100_000,
            protocol_version: 26,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 16,
            min_persistent_entry_ttl: 4096,
            max_entry_ttl: 6_312_000,
        });
        let owner = Address::generate(&env);
        let zeros: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);
        // not_after is in the past
        let inputs = PublicInputs {
            domain_commitment: zeros.clone(),
            record_commitment: zeros.clone(),
            owner_commitment: zeros.clone(),
            nullifier: zeros.clone(),
            dnskey_root_hash: zeros.clone(),
            not_before: 1_000,
            not_after: 50_000,
            verifier_version: 1,
        };
        let proof = Bytes::from_array(&env, &[0u8; 256]);
        let result = client.try_verify_and_issue(&owner, &inputs, &proof);
        assert!(matches!(result, Err(Ok(RegistryError::ProofWindowExpired))));
    }

    // ── require_valid_credential tests ────────────────────────────────────────

    #[test]
    #[should_panic]
    fn test_require_valid_credential_not_found_panics() {
        let env = make_env();
        let (_id, client, _admin, _verifier) = deploy_and_init(&env);
        env.ledger().set(LedgerInfo {
            timestamp: 1_000_000,
            protocol_version: 26,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 16,
            min_persistent_entry_ttl: 4096,
            max_entry_ttl: 6_312_000,
        });
        let owner = Address::generate(&env);
        let fake_nullifier = BytesN::from_array(&env, &[0u8; 32]);
        // Should panic — credential does not exist.
        client.require_valid_credential(&owner, &fake_nullifier);
    }

    // ── revoke tests ──────────────────────────────────────────────────────────

    #[test]
    fn test_revoke_active_credential_succeeds() {
        let env = make_env();
        let (_id, client, admin, _verifier) = deploy_and_init(&env);
        env.ledger().set(LedgerInfo {
            timestamp: 1_000_000,
            protocol_version: 26,
            sequence_number: 100,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 16,
            min_persistent_entry_ttl: 4096,
            max_entry_ttl: 6_312_000,
        });
        let owner = Address::generate(&env);
        let inputs = dummy_inputs(&env, 1_000_000);
        let proof = Bytes::from_array(&env, &[0u8; 256]);
        let nullifier = inputs.nullifier.clone();

        client.verify_and_issue(&owner, &inputs, &proof);

        // Owner revokes.
        client.revoke(&owner, &nullifier);

        let cred = client.get_credential(&nullifier).expect("credential must exist");
        assert_eq!(
            cred.status,
            CredentialStatus::Revoked,
            "status must be Revoked after revoke"
        );

        // Admin can also revoke (test that path) — already Revoked here, so expect error.
        let result = client.try_revoke(&admin, &nullifier);
        assert_eq!(
            result,
            Err(Ok(RegistryError::CredentialRevoked)),
            "revoking already-revoked credential must return CredentialRevoked"
        );
    }

    #[test]
    fn test_revoke_unauthorized_caller_fails() {
        let env = make_env();
        let (_id, client, _admin, _verifier) = deploy_and_init(&env);
        env.ledger().set(LedgerInfo {
            timestamp: 1_000_000,
            protocol_version: 26,
            sequence_number: 100,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 16,
            min_persistent_entry_ttl: 4096,
            max_entry_ttl: 6_312_000,
        });
        let owner = Address::generate(&env);
        let stranger = Address::generate(&env);
        let inputs = dummy_inputs(&env, 1_000_000);
        let proof = Bytes::from_array(&env, &[0u8; 256]);
        let nullifier = inputs.nullifier.clone();

        client.verify_and_issue(&owner, &inputs, &proof);

        let result = client.try_revoke(&stranger, &nullifier);
        assert_eq!(
            result,
            Err(Ok(RegistryError::Unauthorized)),
            "stranger must not be able to revoke"
        );
    }

    // ── renew tests ───────────────────────────────────────────────────────────

    #[test]
    fn test_renew_revoked_credential_fails() {
        let env = make_env();
        let (_id, client, _admin, _verifier) = deploy_and_init(&env);
        env.ledger().set(LedgerInfo {
            timestamp: 1_000_000,
            protocol_version: 26,
            sequence_number: 100,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 16,
            min_persistent_entry_ttl: 4096,
            max_entry_ttl: 6_312_000,
        });
        let owner = Address::generate(&env);
        let inputs = dummy_inputs(&env, 1_000_000);
        let proof = Bytes::from_array(&env, &[0u8; 256]);
        let nullifier = inputs.nullifier.clone();

        client.verify_and_issue(&owner, &inputs, &proof);
        client.revoke(&owner, &nullifier);

        // Renewing a revoked credential must fail.
        let result = client.try_renew(&nullifier, &2_000_000u64);
        assert_eq!(
            result,
            Err(Ok(RegistryError::CredentialRevoked)),
            "renew on revoked credential must return CredentialRevoked"
        );
    }

    #[test]
    fn test_renew_with_past_expiry_fails() {
        let env = make_env();
        let (_id, client, _admin, _verifier) = deploy_and_init(&env);
        env.ledger().set(LedgerInfo {
            timestamp: 1_000_000,
            protocol_version: 26,
            sequence_number: 100,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 16,
            min_persistent_entry_ttl: 4096,
            max_entry_ttl: 6_312_000,
        });
        let owner = Address::generate(&env);
        let inputs = dummy_inputs(&env, 1_000_000);
        let proof = Bytes::from_array(&env, &[0u8; 256]);
        let nullifier = inputs.nullifier.clone();

        client.verify_and_issue(&owner, &inputs, &proof);

        // new_expires_at is in the past relative to ledger timestamp.
        let result = client.try_renew(&nullifier, &500_000u64);
        assert_eq!(
            result,
            Err(Ok(RegistryError::InvalidPublicInputs)),
            "renew with past expiry must return InvalidPublicInputs"
        );
    }

    // ── retrieval tests ───────────────────────────────────────────────────────

    #[test]
    fn test_get_credential_and_by_owner_after_issuance() {
        let env = make_env();
        let (_id, client, _admin, _verifier) = deploy_and_init(&env);
        env.ledger().set(LedgerInfo {
            timestamp: 1_000_000,
            protocol_version: 26,
            sequence_number: 100,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 16,
            min_persistent_entry_ttl: 4096,
            max_entry_ttl: 6_312_000,
        });
        let owner = Address::generate(&env);
        let inputs = dummy_inputs_with_nullifier(&env, 1_000_000, 42);
        let proof = Bytes::from_array(&env, &[0u8; 256]);
        let nullifier = inputs.nullifier.clone();

        client.verify_and_issue(&owner, &inputs, &proof);

        // get_credential by nullifier.
        let cred = client.get_credential(&nullifier);
        assert!(cred.is_some(), "get_credential must find the issued credential");

        // get_credentials_by_owner.
        let nullifiers = client.get_credentials_by_owner(&owner);
        assert_eq!(nullifiers.len(), 1, "owner must have exactly one credential");
        assert_eq!(nullifiers.get(0).unwrap(), nullifier);
    }
}
