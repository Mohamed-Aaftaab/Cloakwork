#![deny(warnings)]
#![no_std]

//! # Cloakwork SDK
//!
//! One-line domain credential verification for any Soroban smart contract.
//!
//! ## Usage
//!
//! ```toml
//! # Cargo.toml
//! [dependencies]
//! cloakwork-sdk = { path = "../sdk/cloakwork-sdk" }
//! ```
//!
//! ```rust,ignore
//! use cloakwork_sdk::CloakworkClient;
//!
//! fn my_gated_function(env: Env, owner: Address, nullifier: BytesN<32>, registry: Address) {
//!     // Panics with auth error if credential is invalid, expired, or revoked.
//!     CloakworkClient::require_valid_credential(&env, registry, owner, nullifier);
//!     // Protected logic follows — domain identity verified, zero knowledge preserved.
//! }
//! ```

use soroban_sdk::{Address, BytesN, Env, IntoVal, Symbol};

// Re-export shared types so SDK consumers don't need a direct cloakwork-types dep
pub use cloakwork_types::{CredentialStatus, DomainCredential};

/// Cross-contract client for the Cloakwork Registry.
///
/// All three methods invoke the deployed Registry contract via
/// `env.invoke_contract`. Consuming contracts only need to know the
/// Registry contract address — no ZK knowledge required.
pub struct CloakworkClient;

impl CloakworkClient {
    /// Assert that `owner` holds a valid, non-expired, non-revoked credential
    /// identified by `nullifier`.
    ///
    /// **Panics** with an authorization error if the credential:
    /// - does not exist,
    /// - belongs to a different owner,
    /// - has been revoked, or
    /// - has an `expires_at` timestamp in the past.
    ///
    /// This is the idiomatic guard for gating a contract function behind
    /// Cloakwork domain identity — call it at the top of any protected function.
    ///
    /// # Arguments
    /// * `env` - The current Soroban environment.
    /// * `registry` - The deployed `cloakwork_registry` contract address.
    /// * `owner` - The Stellar address claiming credential ownership.
    /// * `nullifier` - The 32-byte nullifier identifying the specific credential.
    pub fn require_valid_credential(
        env: &Env,
        registry: Address,
        owner: Address,
        nullifier: BytesN<32>,
    ) {
        env.invoke_contract::<()>(
            &registry,
            &Symbol::new(env, "require_valid_credential"),
            soroban_sdk::vec![env, owner.into_val(env), nullifier.into_val(env)],
        );
    }

    /// Retrieve the `DomainCredential` associated with `nullifier`.
    ///
    /// Returns `Some(credential)` if found, `None` otherwise.
    /// Does not authenticate — any caller may query credential state.
    ///
    /// # Arguments
    /// * `env` - The current Soroban environment.
    /// * `registry` - The deployed `cloakwork_registry` contract address.
    /// * `nullifier` - The 32-byte nullifier identifying the credential.
    pub fn get_credential(
        env: &Env,
        registry: Address,
        nullifier: BytesN<32>,
    ) -> Option<DomainCredential> {
        env.invoke_contract(
            &registry,
            &Symbol::new(env, "get_credential"),
            soroban_sdk::vec![env, nullifier.into_val(env)],
        )
    }

    /// Check whether a credential is currently active (non-revoked and non-expired).
    ///
    /// Returns `true` if and only if:
    /// - A credential with `nullifier` exists,
    /// - Its `owner` matches the provided address,
    /// - Its `status` is `Active`, and
    /// - Its `expires_at` is strictly greater than the current ledger timestamp.
    ///
    /// Returns `false` for all other cases including revoked, expired, or not found.
    ///
    /// # Arguments
    /// * `env` - The current Soroban environment.
    /// * `registry` - The deployed `cloakwork_registry` contract address.
    /// * `owner` - The Stellar address to check ownership against.
    /// * `nullifier` - The 32-byte nullifier identifying the credential.
    pub fn is_credential_active(
        env: &Env,
        registry: Address,
        owner: Address,
        nullifier: BytesN<32>,
    ) -> bool {
        let cred: Option<DomainCredential> = Self::get_credential(env, registry, nullifier);
        match cred {
            Some(c) => {
                let now = env.ledger().timestamp();
                c.owner == owner
                    && c.status == CredentialStatus::Active
                    && c.expires_at > now
            }
            None => false,
        }
    }
}
