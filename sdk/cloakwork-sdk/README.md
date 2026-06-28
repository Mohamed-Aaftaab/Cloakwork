# cloakwork-sdk

**One-line domain credential verification for any Soroban smart contract.**

`cloakwork-sdk` is a Rust crate that gives any Soroban contract access to
Cloakwork's privacy-preserving domain identity system — without needing to
understand ZK proofs, BN254 curve math, or DNSSEC.

---

## Installation

```toml
# Cargo.toml
[dependencies]
cloakwork-sdk = { path = "../sdk/cloakwork-sdk" }
```

---

## Usage

```rust
use cloakwork_sdk::CloakworkClient;
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

#[contract]
pub struct MyProtocol;

#[contractimpl]
impl MyProtocol {
    /// Gate this function behind verified domain identity.
    /// The caller must hold an active Cloakwork DomainCredential.
    pub fn protected_action(
        env: Env,
        owner: Address,
        nullifier: BytesN<32>,
        registry: Address,
        // ... your function args
    ) {
        owner.require_auth();

        // One line to enforce domain-backed identity gating.
        // Panics with auth error if credential is invalid, expired, or revoked.
        CloakworkClient::require_valid_credential(&env, registry, owner, nullifier);

        // Protected logic — domain identity verified, zero knowledge revealed.
    }
}
```

---

## API

### `CloakworkClient::require_valid_credential`

```rust
pub fn require_valid_credential(
    env: &Env,
    registry: Address,
    owner: Address,
    nullifier: BytesN<32>,
)
```

Panics with an authorization error if the credential is:
- not found,
- owned by a different address,
- revoked, or
- expired (`expires_at < current ledger timestamp`).

Use this as an auth guard at the top of any protected function.

---

### `CloakworkClient::get_credential`

```rust
pub fn get_credential(
    env: &Env,
    registry: Address,
    nullifier: BytesN<32>,
) -> Option<DomainCredential>
```

Returns the credential or `None`. Does not authenticate.

---

### `CloakworkClient::is_credential_active`

```rust
pub fn is_credential_active(
    env: &Env,
    registry: Address,
    owner: Address,
    nullifier: BytesN<32>,
) -> bool
```

Returns `true` only if the credential exists, matches `owner`, has `Active` status,
and has not expired. Returns `false` for all other cases.

---

## Re-exported types

```rust
pub use cloakwork_types::{CredentialStatus, DomainCredential};
```

---

## Deployed Registry (Stellar testnet)

`cloakwork_registry`: `CBIACVGBZHTQLUGFEL52GUI6B4FYE7TVR2GOV4G6UO45X6FSFGO6IYB3`

[View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CBIACVGBZHTQLUGFEL52GUI6B4FYE7TVR2GOV4G6UO45X6FSFGO6IYB3)
