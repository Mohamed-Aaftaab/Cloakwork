#![deny(warnings)]
#![no_std]

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype,
    Address, Bytes, BytesN, Env,
};
use cloakwork_types::GatedActionError;
use cloakwork_sdk::CloakworkClient;

// ─── Events ───────────────────────────────────────────────────────────────────

/// Emitted when a credential-gated action is successfully executed.
/// The `domain_commitment` is a Poseidon hash — the domain is never revealed.
/// `action_payload` is in the data section.
#[contractevent]
#[derive(Clone, Debug)]
pub struct ActionExecuted {
    /// Stellar address of the credential owner (topic, indexed).
    #[topic]
    pub owner: Address,
    /// Poseidon hash of the domain — no raw domain ever on-chain (topic).
    #[topic]
    pub domain_commitment: BytesN<32>,
    /// Arbitrary action payload bytes (data).
    pub action_payload: Bytes,
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
enum DataKey {
    /// The deployed Registry contract address.
    Registry,
    /// Initialization guard (instance storage).
    Initialized,
}

const TTL_THRESHOLD: u32 = 100_000;
const TTL_TARGET: u32 = 535_680;

// ─── Contract ─────────────────────────────────────────────────────────────────

/// Demo contract demonstrating SDK-based credential gating.
///
/// Any Soroban contract can follow this same pattern to gate
/// its functions behind Cloakwork domain identity — without
/// importing any ZK logic or knowing what the underlying domain is.
#[contract]
pub struct GatedActionDemo;

#[contractimpl]
impl GatedActionDemo {
    /// Initialize the demo contract with the Registry contract address.
    ///
    /// Must be called once before `execute_with_credential`.
    ///
    /// # Errors
    /// * [`GatedActionError::AlreadyInitialized`] — if called more than once.
    pub fn initialize(env: Env, registry: Address) -> Result<(), GatedActionError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(GatedActionError::AlreadyInitialized);
        }
        env.storage().persistent().set(&DataKey::Registry, &registry);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Registry, TTL_THRESHOLD, TTL_TARGET);
        env.storage().instance().set(&DataKey::Initialized, &true);
        Ok(())
    }

    /// Execute a credential-gated action — "Verified Merchant Payment Intent".
    ///
    /// Uses `CloakworkClient::require_valid_credential` to enforce that the
    /// caller holds an active, non-revoked, non-expired domain credential.
    /// If the credential check passes, emits an `action_executed` Soroban event
    /// containing the owner address, domain commitment, and action payload.
    ///
    /// **The underlying domain is never revealed.** Only the domain_commitment
    /// (a Poseidon hash) appears in the event.
    ///
    /// # Arguments
    /// * `owner` - The credential owner executing the action.
    /// * `nullifier` - The 32-byte nullifier identifying their credential.
    /// * `action_payload` - Arbitrary payload bytes for the action (e.g. payment metadata).
    ///
    /// # Errors
    /// * [`GatedActionError::NotInitialized`] — if `initialize` was not called.
    /// * Panics with auth error from Registry if credential is invalid/revoked/expired.
    pub fn execute_with_credential(
        env: Env,
        owner: Address,
        nullifier: BytesN<32>,
        action_payload: Bytes,
    ) -> Result<(), GatedActionError> {
        owner.require_auth();

        let registry: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Registry)
            .ok_or(GatedActionError::NotInitialized)?;

        // Extend registry ref TTL on every read
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Registry, TTL_THRESHOLD, TTL_TARGET);

        // SDK call — panics with auth error if credential is invalid, revoked, or expired.
        // This is the only line needed to gate any function behind Cloakwork identity.
        CloakworkClient::require_valid_credential(
            &env,
            registry.clone(),
            owner.clone(),
            nullifier.clone(),
        );

        // Fetch the credential to include domain_commitment in the event.
        // The domain name itself never appears here or on-chain.
        let cred = CloakworkClient::get_credential(&env, registry, nullifier)
            .ok_or(GatedActionError::CredentialNotFound)?;

        // Emit: ActionExecuted event with owner + domain_commitment + payload data
        // The domain name itself never appears here or on-chain.
        ActionExecuted {
            owner: owner.clone(),
            domain_commitment: cred.commitment,
            action_payload,
        }
        .publish(&env);

        Ok(())
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events, Ledger, LedgerInfo};
    use soroban_sdk::{panic_with_error, Address, Bytes, BytesN, Env};
    use cloakwork_types::{
        CredentialStatus, DomainCredential, GatedActionError,
    };

    // ── Mock Registry ─────────────────────────────────────────────────────────

    #[contract]
    pub struct MockRegistry;

    #[contractimpl]
    impl MockRegistry {
        /// Store a mock credential.
        pub fn seed(env: Env, nullifier: BytesN<32>, cred: DomainCredential) {
            env.storage().persistent().set(&nullifier, &cred);
        }

        pub fn require_valid_credential(env: Env, owner: Address, nullifier: BytesN<32>) {
            let cred: DomainCredential = env
                .storage()
                .persistent()
                .get(&nullifier)
                .unwrap_or_else(|| panic_with_error!(&env, cloakwork_types::RegistryError::CredentialNotFound));
            if cred.owner != owner {
                panic_with_error!(&env, cloakwork_types::RegistryError::Unauthorized);
            }
            if cred.status == CredentialStatus::Revoked {
                panic_with_error!(&env, cloakwork_types::RegistryError::CredentialRevoked);
            }
            let now = env.ledger().timestamp();
            if cred.expires_at < now {
                panic_with_error!(&env, cloakwork_types::RegistryError::CredentialExpired);
            }
        }

        pub fn get_credential(env: Env, nullifier: BytesN<32>) -> Option<DomainCredential> {
            env.storage().persistent().get(&nullifier)
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn make_env() -> Env {
        let env = Env::default();
        env.mock_all_auths();
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
        env
    }

    fn deploy_and_init(env: &Env) -> (Address, GatedActionDemoClient<'_>, Address, MockRegistryClient<'_>) {
        let registry_id = env.register(MockRegistry, ());
        let registry_client = MockRegistryClient::new(env, &registry_id);

        let demo_id = env.register(GatedActionDemo, ());
        let demo_client = GatedActionDemoClient::new(env, &demo_id);
        demo_client.initialize(&registry_id);

        (demo_id, demo_client, registry_id, registry_client)
    }

    fn active_cred(env: &Env, owner: &Address) -> DomainCredential {
        DomainCredential {
            owner: owner.clone(),
            commitment: BytesN::from_array(env, &[1u8; 32]),
            nullifier: BytesN::from_array(env, &[0u8; 32]),
            verifier_version: 1,
            issued_at: 900_000,
            expires_at: 2_000_000,
            status: CredentialStatus::Active,
        }
    }

    // ── initialize tests ──────────────────────────────────────────────────────

    #[test]
    fn test_initialize_twice_fails() {
        let env = make_env();
        let (_demo_id, demo_client, registry_id, _reg) = deploy_and_init(&env);
        let result = demo_client.try_initialize(&registry_id);
        assert_eq!(result, Err(Ok(GatedActionError::AlreadyInitialized)));
    }

    // ── execute_with_credential tests ─────────────────────────────────────────

    #[test]
    fn test_execute_active_credential_emits_event() {
        let env = make_env();
        let (_demo_id, demo_client, _reg_id, reg_client) = deploy_and_init(&env);
        let owner = Address::generate(&env);
        let nullifier = BytesN::from_array(&env, &[0u8; 32]);
        let cred = active_cred(&env, &owner);
        reg_client.seed(&nullifier, &cred);

        let payload = Bytes::from_array(&env, b"payment:100USDC");
        let result = demo_client.try_execute_with_credential(&owner, &nullifier, &payload);
        assert!(result.is_ok(), "active credential must succeed: {:?}", result);

        let events = env.events().all();
        // ContractEvents.events() returns &[xdr::ContractEvent]
        assert!(!events.events().is_empty(), "at least one event must be emitted");
    }

    #[test]
    #[should_panic]
    fn test_execute_revoked_credential_panics() {
        let env = make_env();
        let (_demo_id, demo_client, _reg_id, reg_client) = deploy_and_init(&env);
        let owner = Address::generate(&env);
        let nullifier = BytesN::from_array(&env, &[0u8; 32]);
        let mut cred = active_cred(&env, &owner);
        cred.status = CredentialStatus::Revoked;
        reg_client.seed(&nullifier, &cred);

        let payload = Bytes::from_array(&env, b"payment");
        // Should panic because credential is revoked
        demo_client.execute_with_credential(&owner, &nullifier, &payload);
    }

    #[test]
    #[should_panic]
    fn test_execute_expired_credential_panics() {
        let env = make_env();
        let (_demo_id, demo_client, _reg_id, reg_client) = deploy_and_init(&env);
        let owner = Address::generate(&env);
        let nullifier = BytesN::from_array(&env, &[0u8; 32]);
        let mut cred = active_cred(&env, &owner);
        cred.expires_at = 500_000; // past ledger timestamp of 1_000_000
        reg_client.seed(&nullifier, &cred);

        let payload = Bytes::from_array(&env, b"payment");
        // Should panic because credential is expired
        demo_client.execute_with_credential(&owner, &nullifier, &payload);
    }
}
