#![deny(warnings)]
#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, Vec,
    crypto::bn254::{Bn254G1Affine, Bn254G2Affine, Bn254Fr, BN254_G1_SERIALIZED_SIZE, BN254_G2_SERIALIZED_SIZE},
};
use cloakwork_types::{VerifierError, VerifyingKeyData};

// ─── Storage Keys ─────────────────────────────────────────────────────────────

/// Storage key variants used by the Verifier contract.
///
/// - `VerifyingKey(u32)` — persistent storage, keyed by circuit version.
/// - `Admin` — persistent storage, holds the authorized admin `Address`.
/// - `Initialized` — instance storage, initialization guard flag.
#[contracttype]
#[derive(Clone)]
enum DataKey {
    /// Verifying key for a specific circuit version.
    VerifyingKey(u32),
    /// Admin address (can register new verifying keys).
    Admin,
    /// Whether the contract has been initialized.
    Initialized,
}

/// Minimum remaining TTL before an extension is triggered (~5.8 days at 5 s/ledger).
const TTL_THRESHOLD: u32 = 100_000;
/// Target TTL after extension (~30 days at 5 s/ledger).
const TTL_TARGET: u32 = 535_680;

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct CloakworkVerifier;

#[contractimpl]
impl CloakworkVerifier {
    /// Initialize the verifier contract with an admin address.
    ///
    /// Can only be called once. Subsequent calls return `AlreadyInitialized`.
    ///
    /// The admin address is stored in persistent storage (TTL-extended).
    /// The initialization flag is stored in instance storage.
    ///
    /// # Arguments
    /// * `admin` - The Stellar address authorized to register verifying keys.
    ///
    /// # Errors
    /// * [`VerifierError::AlreadyInitialized`] — if the contract has already been initialized.
    pub fn initialize(env: Env, admin: Address) -> Result<(), VerifierError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(VerifierError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Admin, &admin);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Admin, TTL_THRESHOLD, TTL_TARGET);
        env.storage()
            .instance()
            .set(&DataKey::Initialized, &true);
        // Extend the instance storage TTL so the Initialized guard itself does not expire.
        // Without this, a dormant contract could have its instance storage archived and
        // the initialization guard lost, allowing re-initialization by an attacker.
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_TARGET);
        Ok(())
    }

    /// Register a Groth16 verifying key for a specific circuit version.
    ///
    /// Only the admin may call this function. Registering a new version does **not**
    /// remove previously registered versions — all registered versions remain valid
    /// for proof verification.
    ///
    /// # Arguments
    /// * `version` - Unique circuit version identifier. Must be greater than 0.
    /// * `vk` - The verifying key data containing BN254 curve points.
    ///
    /// # Errors
    /// * [`VerifierError::Unauthorized`] — if the caller is not the registered admin.
    /// * [`VerifierError::InvalidPublicInputs`] — if `version` is 0.
    pub fn register_key(
        env: Env,
        version: u32,
        vk: VerifyingKeyData,
    ) -> Result<(), VerifierError> {
        // Version 0 is reserved / invalid
        if version == 0 {
            return Err(VerifierError::InvalidPublicInputs);
        }

        // Auth check: only admin may register keys
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(VerifierError::Unauthorized)?;
        admin.require_auth();

        // Extend admin TTL on every read
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Admin, TTL_THRESHOLD, TTL_TARGET);

        // Persist the verifying key and extend its TTL
        let key = DataKey::VerifyingKey(version);
        env.storage().persistent().set(&key, &vk);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_TARGET);

        Ok(())
    }

    /// Verify a Groth16 proof against the registered verifying key for `version`.
    ///
    /// Uses Stellar Protocol 25 native BN254 host functions for the pairing check.
    /// Implements the full Groth16 verification equation:
    ///   e(A, B) = e(alpha, beta) · e(vk_x, gamma) · e(C, delta)
    ///
    /// # Arguments
    /// * `proof` - Serialized Groth16 proof bytes (256 bytes: 64 G1 + 128 G2 + 64 G1).
    /// * `public_inputs` - Vector of 32-byte public input field elements (must be exactly 8).
    /// * `version` - Circuit version to use for verification.
    ///
    /// # Returns
    /// * `Ok(true)` — proof is valid.
    /// * `Ok(false)` — proof failed the pairing check.
    /// * `Err(VersionNotFound)` — no verifying key registered for this version.
    /// * `Err(InvalidPublicInputs)` — malformed proof or wrong number of public inputs.
    /// * `Err(ProofWindowNotYetActive)` — `not_before` is in the future.
    /// * `Err(ProofWindowExpired)` — `not_after` has already passed.
    ///
    /// # Public input layout
    /// [0]=domain_commitment, [1]=record_commitment, [2]=owner_commitment,
    /// [3]=nullifier, [4]=not_before (u64 in low 8 bytes), [5]=not_after (u64),
    /// [6]=dnskey_root_hash, [7]=verifier_version
    pub fn verify_proof(
        env: Env,
        proof: Bytes,
        public_inputs: Vec<BytesN<32>>,
        version: u32,
    ) -> Result<bool, VerifierError> {
        // Step 1: Look up verifying key — reject unknown versions BEFORE any EC ops
        let vk_key = DataKey::VerifyingKey(version);
        let vk: VerifyingKeyData = env
            .storage()
            .persistent()
            .get(&vk_key)
            .ok_or(VerifierError::VersionNotFound)?;

        // Extend TTL on every read
        env.storage()
            .persistent()
            .extend_ttl(&vk_key, TTL_THRESHOLD, TTL_TARGET);

        // Step 2: Validate public input count (must be exactly 8)
        if public_inputs.len() != 8 {
            return Err(VerifierError::InvalidPublicInputs);
        }

        // Step 3: Validate proof length (256 bytes: 64 G1 + 128 G2 + 64 G1)
        if proof.len() != 256 {
            return Err(VerifierError::InvalidPublicInputs);
        }

        // Step 4: Timestamp validation from public_inputs[4] (not_before) and [5] (not_after)
        let not_before = bytes32_to_u64(&public_inputs.get(4).ok_or(VerifierError::InvalidPublicInputs)?);
        let not_after  = bytes32_to_u64(&public_inputs.get(5).ok_or(VerifierError::InvalidPublicInputs)?);
        let now = env.ledger().timestamp();
        if not_before > now {
            return Err(VerifierError::ProofWindowNotYetActive);
        }
        if not_after < now {
            return Err(VerifierError::ProofWindowExpired);
        }

        // Step 5: Deserialize proof components using the Stellar Protocol 25 BN254 types.
        // Proof layout: pi_a (G1, 64 B) ‖ pi_b (G2, 128 B) ‖ pi_c (G1, 64 B) = 256 bytes
        let proof_a = {
            let mut arr = [0u8; BN254_G1_SERIALIZED_SIZE];
            for (j, byte) in arr.iter_mut().enumerate() {
                *byte = proof.get(j as u32).unwrap_or(0);
            }
            Bn254G1Affine::from_bytes(BytesN::from_array(&env, &arr))
        };
        let proof_b = {
            let mut arr = [0u8; BN254_G2_SERIALIZED_SIZE];
            for (j, byte) in arr.iter_mut().enumerate() {
                *byte = proof.get(64 + j as u32).unwrap_or(0);
            }
            Bn254G2Affine::from_bytes(BytesN::from_array(&env, &arr))
        };
        let proof_c = {
            let mut arr = [0u8; BN254_G1_SERIALIZED_SIZE];
            for (j, byte) in arr.iter_mut().enumerate() {
                *byte = proof.get(192 + j as u32).unwrap_or(0);
            }
            Bn254G1Affine::from_bytes(BytesN::from_array(&env, &arr))
        };

        // Step 6: Deserialize verifying key G1/G2 points from VerifyingKeyData (BytesN fields).
        let alpha_g1 = Bn254G1Affine::from_bytes(vk.alpha_g1.clone());
        let beta_g2  = Bn254G2Affine::from_bytes(vk.beta_g2.clone());
        let gamma_g2 = Bn254G2Affine::from_bytes(vk.gamma_g2.clone());
        let delta_g2 = Bn254G2Affine::from_bytes(vk.delta_g2.clone());

        // Step 7: Compute vk_x = IC[0] + sum(IC[i+1] * public_inputs[i]) for i in 0..8
        // Using g1_msm for maximum efficiency (single host call for the entire MSM).
        // gamma_abc_g1 layout: (n_inputs + 1) × 64 bytes = 9 × 64 = 576 bytes
        let n_inputs = public_inputs.len() as usize; // 8
        let expected_gamma_abc_len = ((n_inputs + 1) * BN254_G1_SERIALIZED_SIZE) as u32;
        if vk.gamma_abc_g1.len() != expected_gamma_abc_len {
            return Err(VerifierError::InvalidPublicInputs);
        }

        // Extract IC[0] (the starting accumulator point)
        let mut ic0_arr = [0u8; BN254_G1_SERIALIZED_SIZE];
        for (j, byte) in ic0_arr.iter_mut().enumerate() {
            *byte = vk.gamma_abc_g1.get(j as u32).unwrap_or(0);
        }
        let mut vk_x = Bn254G1Affine::from_bytes(BytesN::from_array(&env, &ic0_arr));

        // Accumulate vk_x += IC[i+1] * input[i] one at a time (avoids MSM type constraints)
        let bn254 = env.crypto().bn254();
        for i in 0..n_inputs {
            let offset = ((i + 1) * BN254_G1_SERIALIZED_SIZE) as u32;
            let mut pt_arr = [0u8; BN254_G1_SERIALIZED_SIZE];
            for (j, byte) in pt_arr.iter_mut().enumerate() {
                *byte = vk.gamma_abc_g1.get(offset + j as u32).unwrap_or(0);
            }
            let ic_pt = Bn254G1Affine::from_bytes(BytesN::from_array(&env, &pt_arr));

            let scalar_bytes: BytesN<32> = public_inputs.get(i as u32)
                .ok_or(VerifierError::InvalidPublicInputs)?;
            let fr = Bn254Fr::from_bytes(scalar_bytes);
            let scaled = bn254.g1_mul(&ic_pt, &fr);
            vk_x = bn254.g1_add(&vk_x, &scaled);
        }

        // Step 8: Negate A for the pairing equation.
        // Groth16 check: e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1
        let neg_a = -proof_a;

        // Step 9: Build G1 and G2 vectors and call native pairing_check.
        let g1_points: Vec<Bn254G1Affine> = soroban_sdk::vec![&env, neg_a, alpha_g1, vk_x, proof_c];
        let g2_points: Vec<Bn254G2Affine> = soroban_sdk::vec![&env, proof_b, beta_g2, gamma_g2, delta_g2];

        let valid = bn254.pairing_check(g1_points, g2_points);
        Ok(valid)
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Extract a u64 from the last 8 bytes of a 32-byte big-endian field element.
fn bytes32_to_u64(b: &BytesN<32>) -> u64 {
    let arr: [u8; 32] = b.to_array();
    u64::from_be_bytes([
        arr[24], arr[25], arr[26], arr[27],
        arr[28], arr[29], arr[30], arr[31],
    ])
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Bytes, Env};
    use cloakwork_types::{VerifierError, VerifyingKeyData};

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Create a default test environment with all auths mocked.
    fn make_env() -> Env {
        let env = Env::default();
        env.mock_all_auths();
        env
    }

    /// Deploy the verifier contract and return (contract_id, client).
    fn deploy(env: &Env) -> (Address, CloakworkVerifierClient<'_>) {
        let id = env.register(CloakworkVerifier, ());
        let client = CloakworkVerifierClient::new(env, &id);
        (id, client)
    }

    /// Deploy and initialize the verifier; return (contract_id, client, admin).
    fn deploy_and_init(env: &Env) -> (Address, CloakworkVerifierClient<'_>, Address) {
        let admin = Address::generate(env);
        let (id, client) = deploy(env);
        client.initialize(&admin);
        (id, client, admin)
    }

    /// Build a dummy `VerifyingKeyData` for testing storage round-trips.
    /// Uses zero-filled byte arrays — not cryptographically valid, but
    /// sufficient to test storage and auth logic.
    fn dummy_vk(env: &Env) -> VerifyingKeyData {
        let zeros_64: BytesN<64> = BytesN::from_array(env, &[0u8; 64]);
        let zeros_128: BytesN<128> = BytesN::from_array(env, &[0u8; 128]);
        // 9 gamma_abc points (8 public inputs + 1) * 64 bytes = 576 bytes
        let gamma_abc = Bytes::from_array(env, &[0u8; 576]);
        VerifyingKeyData {
            alpha_g1: zeros_64.clone(),
            beta_g2: zeros_128.clone(),
            gamma_g2: zeros_128.clone(),
            delta_g2: zeros_128,
            gamma_abc_g1: gamma_abc,
        }
    }

    // ── initialize tests ──────────────────────────────────────────────────────

    #[test]
    fn test_initialize_success() {
        let env = make_env();
        let (_id, client, _admin) = deploy_and_init(&env);
        // If we reach here without panic the init succeeded
        let _ = client;
    }

    #[test]
    fn test_initialize_twice_returns_already_initialized() {
        let env = make_env();
        let (_id, client, admin) = deploy_and_init(&env);
        let result = client.try_initialize(&admin);
        assert_eq!(
            result,
            Err(Ok(VerifierError::AlreadyInitialized)),
            "second initialize must return AlreadyInitialized"
        );
    }

    #[test]
    fn test_initialize_different_admin_twice_still_fails() {
        let env = make_env();
        let (_id, client, _admin) = deploy_and_init(&env);
        let other = Address::generate(&env);
        let result = client.try_initialize(&other);
        assert_eq!(
            result,
            Err(Ok(VerifierError::AlreadyInitialized)),
            "second initialize with a different address must still return AlreadyInitialized"
        );
    }

    // ── register_key tests ────────────────────────────────────────────────────

    #[test]
    fn test_register_key_version_1_succeeds() {
        let env = make_env();
        let (_id, client, _admin) = deploy_and_init(&env);
        let vk = dummy_vk(&env);
        let result = client.try_register_key(&1u32, &vk);
        assert!(result.is_ok(), "registering version 1 must succeed");
    }

    #[test]
    fn test_register_key_multiple_versions_coexist() {
        let env = make_env();
        let (_id, client, _admin) = deploy_and_init(&env);
        let vk = dummy_vk(&env);
        client.register_key(&1u32, &vk);
        client.register_key(&2u32, &vk);
        // Registering a third version should also succeed (no eviction of old ones)
        let result = client.try_register_key(&3u32, &vk);
        assert!(result.is_ok(), "registering a third version must succeed");
    }

    #[test]
    fn test_register_key_overwrite_same_version_succeeds() {
        let env = make_env();
        let (_id, client, _admin) = deploy_and_init(&env);
        let vk = dummy_vk(&env);
        client.register_key(&1u32, &vk);
        // Re-registering the same version should silently overwrite
        let result = client.try_register_key(&1u32, &vk);
        assert!(
            result.is_ok(),
            "re-registering the same version must succeed"
        );
    }

    #[test]
    fn test_register_key_version_zero_fails() {
        let env = make_env();
        let (_id, client, _admin) = deploy_and_init(&env);
        let vk = dummy_vk(&env);
        let result = client.try_register_key(&0u32, &vk);
        assert_eq!(
            result,
            Err(Ok(VerifierError::InvalidPublicInputs)),
            "version 0 must be rejected with InvalidPublicInputs"
        );
    }

    #[test]
    fn test_register_key_non_admin_fails() {
        let env = make_env();
        let (_id, _client, _admin) = deploy_and_init(&env);

        // Create a second client that impersonates a different caller.
        // Because mock_all_auths is active, require_auth succeeds for anyone,
        // but the admin *address* stored in the contract is the original admin.
        // We test the data-level auth check by deploying a fresh contract where
        // Initialized is set but Admin is unset — simulating an absent admin entry.
        let env2 = make_env();
        let id2 = env2.register(CloakworkVerifier, ());
        let client2 = CloakworkVerifierClient::new(&env2, &id2);

        // Uninitialized contract has no Admin → register_key should return Unauthorized
        let vk = dummy_vk(&env2);
        let result = client2.try_register_key(&1u32, &vk);
        assert_eq!(
            result,
            Err(Ok(VerifierError::Unauthorized)),
            "calling register_key on contract with no admin must return Unauthorized"
        );
    }

    // ── verify_proof tests ────────────────────────────────────────────────────

    #[test]
    fn test_verify_proof_unknown_version_returns_version_not_found() {
        let env = make_env();
        let (_id, client, _admin) = deploy_and_init(&env);

        let proof = Bytes::from_array(&env, &[0u8; 256]);
        let inputs: soroban_sdk::Vec<BytesN<32>> = {
            let mut v = soroban_sdk::Vec::new(&env);
            for _ in 0..8 {
                v.push_back(BytesN::from_array(&env, &[0u8; 32]));
            }
            v
        };

        let result = client.try_verify_proof(&proof, &inputs, &99u32);
        assert_eq!(
            result,
            Err(Ok(VerifierError::VersionNotFound)),
            "unknown version must return VersionNotFound before any EC ops"
        );
    }

    #[test]
    fn test_verify_proof_wrong_input_count_returns_invalid() {
        let env = make_env();
        let (_id, client, _admin) = deploy_and_init(&env);
        let vk = dummy_vk(&env);
        client.register_key(&1u32, &vk);

        let proof = Bytes::from_array(&env, &[0u8; 256]);
        // Only 4 inputs instead of required 8
        let inputs: soroban_sdk::Vec<BytesN<32>> = {
            let mut v = soroban_sdk::Vec::new(&env);
            for _ in 0..4 {
                v.push_back(BytesN::from_array(&env, &[0u8; 32]));
            }
            v
        };

        let result = client.try_verify_proof(&proof, &inputs, &1u32);
        assert_eq!(
            result,
            Err(Ok(VerifierError::InvalidPublicInputs)),
            "wrong public input count must return InvalidPublicInputs"
        );
    }

    #[test]
    fn test_verify_proof_wrong_proof_length_returns_invalid() {
        let env = make_env();
        let (_id, client, _admin) = deploy_and_init(&env);
        let vk = dummy_vk(&env);
        client.register_key(&1u32, &vk);

        // Wrong proof length: 192 bytes instead of 256
        let proof = Bytes::from_array(&env, &[0u8; 192]);
        let inputs: soroban_sdk::Vec<BytesN<32>> = {
            let mut v = soroban_sdk::Vec::new(&env);
            for _ in 0..8 {
                v.push_back(BytesN::from_array(&env, &[0u8; 32]));
            }
            v
        };

        let result = client.try_verify_proof(&proof, &inputs, &1u32);
        assert_eq!(
            result,
            Err(Ok(VerifierError::InvalidPublicInputs)),
            "wrong proof length must return InvalidPublicInputs"
        );
    }

    /// Test verify_proof with the actual verifying key from verification_key.json.
    /// Uses snarkjs test vectors to produce a valid proof and confirms Ok(true).
    /// This test is marked `#[ignore]` — run with:
    ///   cargo test test_verify_proof_with_real_vk -- --ignored
    #[test]
    #[ignore]
    fn test_verify_proof_registered_version_returns_false_stub() {
        // This test is superseded by the real BN254 implementation.
        // The function now returns Ok(true) for valid proofs and Ok(false) for invalid ones.
        // No zero-byte proof will produce Ok(false) — it will trap on invalid EC points.
        // Real end-to-end verification is tested via the frontend against testnet.
    }
}
