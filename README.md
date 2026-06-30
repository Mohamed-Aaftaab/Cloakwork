# Cloakwork

**Private DNS identity for Stellar.**

Cloakwork lets any Stellar wallet privately prove it controls a real DNS domain and receive a reusable, revocable on-chain credential — without the domain name, DNS record, or any identifying business data ever appearing on-chain.

Built for the [Stellar Hacks: Real-World ZK](https://dorahacks.io/hackathon/stellar-hacks-zk/detail) hackathon.

---

## What It Does

1. You add a TXT record to a domain you control (e.g. `_stellar-cloakwork.acme.com`)
2. Cloakwork fetches the DNSSEC-signed record and generates a Groth16 zero-knowledge proof off-chain
3. The proof is verified by a Soroban smart contract on Stellar using native BN254 host functions
4. Your wallet receives a reusable `DomainCredential` — a permanent, on-chain badge
5. Any other Soroban contract can verify your credential with one line using the `cloakwork-sdk`

**Your domain name never touches the blockchain.** Only cryptographic commitments (Poseidon hashes) and a Groth16 proof are submitted on-chain.

---

## Architecture

```
Browser (private data stays here)          Stellar Testnet (Soroban)
─────────────────────────────────          ─────────────────────────
DNS challenge generator                    cloakwork_verifier
DNSSEC fetcher (DoH)              ──────►  cloakwork_registry
snarkjs WASM prover (Web Worker)           gated_action_demo
React frontend                    ◄──────  (uses cloakwork-sdk)
Stellar Wallets Kit
```

**Privacy boundary:**

| On-chain (public) | Never leaves browser |
|---|---|
| `domain_commitment` (Poseidon hash) | Domain name |
| `record_commitment` (Poseidon hash) | TXT record value |
| `owner_commitment` (Poseidon hash) | DNSSEC RRset / RRSIG / DNSKEY bytes |
| `nullifier` (Poseidon hash) | nonce, secret |
| RRSIG validity timestamps | |
| Groth16 proof bytes (256 bytes) | |

---

## Project Structure

```
cloakwork/
├── contracts/
│   ├── cloakwork_verifier/    # Groth16 verifier using BN254 host functions
│   ├── cloakwork_registry/    # Credential store + nullifier anti-replay
│   └── gated_action_demo/     # Demo contract using cloakwork-sdk
├── sdk/
│   └── cloakwork-sdk/         # Reusable Rust crate for any Soroban contract
├── proofs/
│   └── circom/                # Circom 2.0 ZK circuit + snarkjs setup
├── src/                       # React frontend
├── scripts/                   # Deploy + build scripts
└── tests/integration/         # End-to-end tests
```

---

## Prerequisites

- [Rust](https://rustup.rs/) (stable ≥ 1.91, 2021 edition) + `wasm32v1-none` target
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli) `>= 27.0.0`
- [Node.js](https://nodejs.org/) `>= 18`
- [Circom](https://docs.circom.io/getting-started/installation/) `>= 2.0.0`
- [snarkjs](https://github.com/iden3/snarkjs) `npm install -g snarkjs`

---

## Local Development Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/cloakwork.git
cd cloakwork
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in contract IDs after deployment (see Deployment section)
```

### 3. Build Soroban contracts

```bash
make build
# or: stellar contract build
```

### 4. Run tests

```bash
make test
# or: cargo test --workspace
```

### 5. Start the frontend

```bash
npm start
```

The app opens at `http://localhost:3000`.

---

## Environment Variables

| Variable | Description | Example |
|---|---|---|
| `REACT_APP_STELLAR_NETWORK` | Network name shown in the UI | `testnet` |
| `REACT_APP_STELLAR_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `REACT_APP_STELLAR_HORIZON_URL` | Horizon API endpoint | `https://horizon-testnet.stellar.org` |
| `REACT_APP_CLOAKWORK_REGISTRY_CONTRACT_ID` | Registry contract ID (after deploy) | `CAB...` |
| `REACT_APP_CLOAKWORK_VERIFIER_CONTRACT_ID` | Verifier contract ID (after deploy) | `CBC...` |
| `REACT_APP_GATED_ACTION_CONTRACT_ID` | GatedAction demo contract ID | `CCA...` |

All variables default to Stellar testnet values when not set. No contract IDs or passphrases are hardcoded in source code.

---

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full testnet deployment guide including exact `stellar contract` commands.

---

## Using the Cloakwork SDK

Any Soroban smart contract can verify a Cloakwork credential in one line:

```toml
# Cargo.toml
[dependencies]
cloakwork-sdk = { path = "../sdk/cloakwork-sdk" }
```

```rust
use cloakwork_sdk::CloakworkClient;

fn my_gated_function(env: Env, owner: Address, nullifier: BytesN<32>) {
    // Panics with auth error if credential is invalid, expired, or revoked
    CloakworkClient::require_valid_credential(&env, REGISTRY_ADDRESS, owner, nullifier);
    // Protected logic follows — domain identity verified, zero knowledge preserved
}
```

No ZK knowledge required. The SDK handles all cross-contract calls to the Registry.

---

## Privacy Model

**What goes on-chain:**
- `domain_commitment` — Poseidon(domain_bytes, nonce)
- `record_commitment` — Poseidon(record_value_bytes, nonce)
- `owner_commitment` — Poseidon(stellar_address_bytes, nonce)
- `nullifier` — Poseidon(domain_bytes, secret)
- `not_before` / `not_after` — RRSIG validity window timestamps
- `verifier_version` — circuit version identifier
- Groth16 proof bytes (256 bytes)

**What never leaves your browser:**
- Domain name string
- DNS TXT record value
- DNSSEC RRset, RRSIG bytes, DNSKEY bytes
- nonce (32 bytes)
- secret (32 bytes)

---

## Tech Stack

| Layer | Technology |
|---|---|
| ZK Circuit | Circom 2.0 + snarkjs (Groth16) |
| On-chain verification | Soroban (Rust) + Stellar Protocol 25+ BN254 host functions |
| ZK-friendly hash | Poseidon (native Stellar Protocol 25 host function) |
| Blockchain | Stellar testnet |
| Frontend | React + TypeScript |
| Wallet | Stellar Wallets Kit + Freighter |
| DNS | DNS-over-HTTPS (Cloudflare DoH) |
| SDK | `cloakwork-sdk` Rust crate |

---

## License

MIT — see [LICENSE](./LICENSE)
