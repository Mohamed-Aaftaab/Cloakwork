# zkDNS Stellar — Product Requirements & Build PRD

> **Read me first for the implementing agent.** Build **zkDNS Stellar** as a native Stellar/Soroban privacy product: a zero-knowledge DNSSEC identity primitive that lets users prove domain-backed authorization while keeping the domain and DNS record private. The final product must be a focused identity, credential, and gated-action application for Stellar.
>
> The product must let a user prove, through a zero-knowledge proof, that a DNSSEC-secured domain contains an authorized DNS record, while keeping the domain and record value hidden from the public chain. A Soroban verifier contract must check the proof and issue a reusable on-chain verification receipt that other Stellar apps can use for private domain ownership, business identity, gated payments, and recovery flows.
>
> This document is the source of truth for what to build and how the pieces map. After reading it, produce an implementation plan for M0–M4 before writing code.

---

## 1. What zkDNS Stellar is

**zkDNS Stellar** is a privacy-preserving DNS identity layer for Stellar. It allows a user, company, DAO, or app to prove control of a DNSSEC-secured domain without revealing the domain name, TXT record, wallet address, or authorization payload on-chain.

The user adds a DNS TXT record under a domain they control. The app fetches DNSSEC data, creates a zero-knowledge proof that the DNSSEC signature chain and TXT record are valid, and submits the proof to a Soroban smart contract. The contract verifies the proof and stores a compact verification receipt keyed by a nullifier and commitment.

The product narrative for judges:

> “Stellar has fast payments and a serious real-world asset story, but public wallets leak business identity. zkDNS Stellar lets a business prove it controls a real DNS domain and authorize Stellar actions without exposing the domain publicly.”

### Product planes

| Plane | Responsibility | Stellar-native design |
|---|---|---|
| **Proof plane** | DNSSEC collection, canonicalization, proof creation | Off-chain prover using RISC Zero zkVM or Circom/Groth16. DNSSEC data stays private. |
| **Verification plane** | Trust-minimized proof validation | Soroban Rust verifier contract using Stellar ZK primitives / Groth16 verifier pattern. |
| **Identity plane** | Reusable credential state | Soroban `DomainCredential` receipt with nullifier, commitment, expiry, verifier version, and owner key. |
| **App plane** | User flow and demo | React interface for wallet connect, DNS record guidance, proof generation, verification, and credential-gated actions. |
| **Relay plane** | Optional UX layer | Fee-bump / relayer path so users can verify without managing transaction fees manually. |

### Locked design decisions

- **Primary use case:** private DNSSEC-backed domain ownership proof for Stellar.
- **Primary demo:** prove a business domain privately, receive a Soroban credential, then use that credential to unlock a gated Stellar action.
- **Verifier:** Soroban Rust contract.
- **Proof generation:** off-chain. Do not attempt DNSSEC parsing or RSA verification directly inside Soroban.
- **ZK path:** RISC Zero zkVM for DNSSEC-heavy logic, with Groth16 verification on-chain where feasible. Circom/Groth16 is acceptable for a narrower MVP that proves a simplified TXT-record statement.
- **Privacy:** public chain sees only commitments, nullifiers, timestamps, verifier version, and credential state.
- **Wallet:** Stellar wallet flow using Freighter / Stellar Wallets Kit / Stellar JS SDK.
- **Application shape:** use a clean React interface, Soroban contracts, Stellar network config, proof adapters, and wallet hooks.
- **Product copy:** describe the app only as a private DNS identity and proof product.

---

## 2. The Stellar ZK stack for the implementing agent

Fetch current Stellar docs before non-trivial integration work because the ZK path is evolving quickly.

- **Stellar + Soroban** — Stellar smart contracts are written in Rust through Soroban. The verifier, credential registry, and demo action contract must be Soroban contracts.
- **Stellar ZK primitives** — Stellar’s ZK docs describe BN254 operations such as `g1_add`, `g1_mul`, and `pairing_check`, plus Poseidon/Poseidon2 hash functions for ZK-friendly hashing. These are the basis for succinct proof verification.
- **RISC Zero verifier path** — Stellar’s developer material shows verifying RISC Zero execution in a Stellar smart contract. This is the preferred route for DNSSEC logic because DNSSEC canonicalization and signature checks are complex.
- **Groth16 verifier path** — The private-payment examples use Groth16-style verification. For MVP, a Groth16 verifier can validate a proof that a private DNS record satisfies a public commitment.
- **Stellar assets and actions** — A verified credential can gate payments, custom asset trust, allowlisted redemptions, recovery flows, or B2B transaction approvals.
- **TTL and state archival** — Soroban contract data has TTL behavior. Any credential state, verifier state, and allowlist state must include an explicit renewal strategy.

---

## 3. Architecture and implementation seam

The application should use a clear separation between UI components, hooks, Stellar client utilities, Soroban contracts, proof tooling, deployment scripts, and configuration.

### GitHub repository baseline

Use the following repository as the implementation baseline for DNSSEC proof logic, SP1 proof generation patterns, and existing Groth16/PLONK proof modes:

```bash
git clone https://github.com/Envoy-VC/zk-dnssec.git
cd zk-dnssec
```

Repository reference: https://github.com/Envoy-VC/zk-dnssec

Why this repository matters for the build:

- It contains a Rust/SP1 DNSSEC proof workflow that is close to the product's proof plane.
- It already models RRset, RRSIG, DNSKEY parsing, RFC 4034-style signed-data reconstruction, signature validation, validity-window checks, and proof generation.
- It supports proof modes that are useful for a Stellar verifier path, especially Groth16-style succinct verification.
- It should be used as the proof-engine starting point, while the final app, contracts, wallet flow, state model, and credential UX remain Stellar/Soroban-specific.

Implementation instruction for the agent:

1. Clone the repository above into a fresh workspace.
2. Preserve the DNSSEC proof-engine concepts that are useful for the Stellar proof plane.
3. Replace EVM-facing verifier assumptions with Soroban verifier requirements.
4. Add a Stellar/Soroban workspace with Rust contracts for registry, verifier, and gated action.
5. Add a React app focused on Freighter/Stellar Wallets Kit, DNS challenge guidance, proof generation, Soroban verification, and credential display.
6. Keep all product copy focused on private DNS identity, Stellar verification, and credential-gated Stellar actions.


### Target structure

```txt
contracts/
  zkdns_registry/
    Cargo.toml
    src/lib.rs
  zkdns_verifier/
    Cargo.toml
    src/lib.rs
  gated_action_demo/
    Cargo.toml
    src/lib.rs

proofs/
  risc0-dnssec/
    Cargo.toml
    methods/
    host/
  circom-lite/
    zkdns.circom
    input.example.json
    scripts/

src/
  components/
    Header.js
    WalletConnect.js
    DNSRecordGuide.js
    ProofGenerator.js
    VerificationPanel.js
    CredentialCard.js
    GatedActionDemo.js
  hooks/
    useStellarWallet.js
    useZkDnsProof.js
    useDomainCredential.js
    useGatedAction.js
  stellar-client/
    ctx.js
    registry.js
    verifier.js
    credential.js
    tx.js
    network.js
  utils/
    dnssec.js
    commitments.js
    proofFormat.js
    validation.js
  config/
    stellar.js
    verifier.js
```

### Target client context

```ts
export interface ZkDnsCtx {
  network: 'testnet' | 'futurenet' | 'mainnet';
  horizonUrl: string;
  rpcUrl: string;
  walletAddress: string;
  signTransaction: (xdr: string) => Promise<string>;
  registryContractId: string;
  verifierContractId: string;
  gatedActionContractId?: string;
}
```

### Write path

1. User enters a domain and target Stellar address locally.
2. App tells user the exact TXT record to publish.
3. DNSSEC fetcher gathers RRset, RRSIG, DNSKEY, DS chain, and proof metadata.
4. Prover creates a proof with private DNS inputs and public commitment values.
5. React app submits proof to Soroban verifier.
6. Registry contract stores a `DomainCredential` receipt.
7. Credential can be used by other contracts through `require_valid_credential`.

### Read path

1. Query registry by wallet, commitment, or nullifier.
2. Load credential state from Soroban.
3. Show expiry, verifier version, status, and linked gated actions.
4. Never reveal the raw domain unless the user explicitly chooses local display.

---

## 4. Component-by-component build map

| Area | File(s) | Required action |
|---|---|---|
| **React shell** | `src/App.js`, `src/index.js`, `src/index.css` | Build a single-page proof and credential experience. |
| **Header** | `src/components/Header.js` | Show app name, wallet, selected Stellar network, and proof state. |
| **Wallet flow** | `src/components/WalletConnect.js`, `src/hooks/useStellarWallet.js` | Implement Stellar wallet connection through Freighter or Stellar Wallets Kit. |
| **Network config** | `src/config/stellar.js` | Store Stellar testnet/futurenet/mainnet contract IDs, Horizon URLs, RPC URLs, and network passphrases. |
| **Proof UI** | `src/components/ProofGenerator.js`, `DNSRecordGuide.js`, `VerificationPanel.js` | Guide the user through TXT challenge creation, DNSSEC validation, proof generation, and Soroban verification. |
| **Credential UI** | `src/components/CredentialCard.js` | Show credential status, issue time, expiry, verifier version, and public/private data explanation. |
| **Gated action UI** | `src/components/GatedActionDemo.js` | Demonstrate another Soroban contract consuming the credential. |
| **Proof utility** | `src/utils/proofFormat.js`, `src/utils/commitments.js` | Implement proof serialization, public input formatting, commitment creation, and nullifier derivation. |
| **DNSSEC utility** | `src/utils/dnssec.js` | Fetch and locally validate RRset, RRSIG, DNSKEY, DS-chain metadata, and TXT presence before proving. |
| **Credential hook** | `src/hooks/useDomainCredential.js` | Read credential status, expiry, verifier version, and nullifier records from Soroban. |
| **Proof hook** | `src/hooks/useZkDnsProof.js` | Coordinate local DNS checks, prover calls, proof status, and verifier submission. |
| **Action hook** | `src/hooks/useGatedAction.js` | Submit a credential-gated action transaction. |
| **Soroban contracts** | `contracts/zkdns_registry`, `contracts/zkdns_verifier`, `contracts/gated_action_demo` | Implement registry, verifier, and credential-gated demo action in Rust. |
| **Deployment scripts** | `scripts/deploy-stellar.*` | Use Stellar CLI to build, deploy, invoke, and bind contract IDs to frontend env. |
| **Tests** | `contracts/*/src/test.rs`, `tests/integration` | Add Soroban unit and integration tests for proof acceptance, proof rejection, nullifier reuse, expiry, revocation, and gated access. |
| **Docs** | `README.md`, `DEPLOYMENT.md`, `DEMO.md` | Document Stellar testnet setup, DNSSEC proof flow, verifier deployment, environment config, and demo script. |

---

## 5. Core domain model

### 5.1 Public credential state

```rust
pub struct DomainCredential {
    pub owner: Address,
    pub commitment: BytesN<32>,
    pub nullifier: BytesN<32>,
    pub verifier_version: u32,
    pub issued_at: u64,
    pub expires_at: u64,
    pub status: CredentialStatus,
}
```

### 5.2 Public proof inputs

```rust
pub struct PublicInputs {
    pub domain_commitment: BytesN<32>,
    pub record_commitment: BytesN<32>,
    pub owner_commitment: BytesN<32>,
    pub nullifier: BytesN<32>,
    pub dnskey_root_hash: BytesN<32>,
    pub not_before: u64,
    pub not_after: u64,
    pub verifier_version: u32,
}
```

### 5.3 Private proof witnesses

The following must remain off-chain and private:

- domain name
- DNS TXT record value
- DNSSEC RRset
- RRSIG
- DNSKEY / DS chain material, unless using a public pinned root
- nonce / secret
- raw Stellar address binding, if the UX uses an address commitment

### 5.4 Credential status values

```rust
pub enum CredentialStatus {
    Active,
    Revoked,
    Expired,
}
```

### 5.5 Required indexes

| Index | Key | Value |
|---|---|---|
| By owner | `owner` | list of credential IDs / nullifiers |
| By nullifier | `nullifier` | credential record |
| By commitment | `domain_commitment` | latest credential status |
| Verifier state | `verifier_version` | verifying key hash + active flag |

---

## 6. Key flows

### 6.1 Create private DNS challenge

1. User connects Stellar wallet.
2. User enters domain locally.
3. App generates a nonce.
4. App builds the TXT record value:

```txt
_stellar-zkdns.<domain> TXT "zkdns:v1:<owner_commitment>:<nonce_commitment>"
```

5. User adds the TXT record in their DNS provider.
6. App polls DNS until the record resolves with DNSSEC data.

### 6.2 Generate proof

1. App or local prover fetches DNSSEC material.
2. Prover verifies canonical DNSSEC data off-chain.
3. Prover creates a proof that the following statement is true:

```txt
I know a DNSSEC-valid domain and TXT record such that:
- the TXT record binds to this owner commitment
- the DNSSEC signature chain is valid under the configured trust anchor
- the record is inside its validity window
- the nullifier is derived correctly
- the public commitments match the private data
```

4. Proof and public inputs are returned to the browser.

### 6.3 Verify proof on Stellar

1. User signs a Stellar transaction.
2. Transaction calls `verify_and_issue` on the registry contract.
3. Registry calls verifier contract.
4. Verifier validates proof and public inputs.
5. Registry checks:
   - nullifier not already used
   - proof validity window is current
   - verifier version is active
   - expiry is within allowed max duration
6. Registry stores the credential.
7. UI displays a verified credential card.

### 6.4 Use credential in a gated action

1. User opens the demo action card.
2. App calls `execute_with_credential` on the gated action contract.
3. Contract checks the credential via registry.
4. If active, the user can perform the protected action.

Recommended demo actions:

- claim a “verified business wallet” badge
- unlock a testnet asset transfer flow
- create a private B2B payment memo
- register a private merchant profile
- authorize wallet recovery contact creation

### 6.5 Revoke or renew credential

1. User signs a revoke or renew transaction.
2. Registry updates status or expiry.
3. UI shows new state.
4. Gated contracts reject revoked or expired credentials.

---

## 7. Headline demo — private business domain proof

The demo should tell one clean story:

> A merchant wants to use Stellar without publicly exposing its domain-to-wallet link. The merchant proves DNS control privately, receives a credential, and uses that credential to unlock a verified merchant action.

### Demo script

1. Connect Stellar wallet.
2. Enter domain locally.
3. App generates DNS TXT instruction.
4. Click “Check DNSSEC record”.
5. App shows “DNSSEC material found”.
6. Click “Generate ZK proof”.
7. Submit proof to Soroban.
8. Credential card appears:
   - status: Active
   - owner: Stellar address
   - public commitment
   - expiry
   - verifier version
9. Click “Use credential”.
10. Gated action succeeds.

### What judges must see

- The domain is never printed on-chain.
- The TXT value is never printed on-chain.
- Soroban validates a succinct proof.
- Nullifier prevents duplicate credential issuance.
- Credential is reusable by another contract.
- The UI is understandable to non-cryptographers.

---

## 8. Product surface

### 8.1 Landing screen

Headline:

```txt
Private DNS identity for Stellar
```

Subcopy:

```txt
Prove domain ownership with DNSSEC and zero-knowledge proofs. Issue a reusable Stellar credential without revealing the domain publicly.
```

Primary CTA:

```txt
Create private domain proof
```

Secondary CTA:

```txt
View verifier contract
```

### 8.2 Proof workspace

Cards:

- Wallet status
- DNS challenge
- DNSSEC check
- Proof generation
- Soroban verification
- Credential result

### 8.3 Credential card

Fields:

- Status
- Owner address
- Public commitment
- Nullifier hash
- Issued at
- Expires at
- Verifier version
- Contract ID

### 8.4 Gated action demo

Use a simple high-confidence action. Do not add unrelated financial complexity. The goal is to prove that another contract can consume the credential.

Recommended action:

```txt
Verified Merchant Payment Intent
```

Flow:

1. User selects “Create payment intent”.
2. Contract checks active credential.
3. Contract emits an event with credential commitment and payment metadata.
4. UI shows success.

---

## 9. Milestones

### M0 — Product cleanup and Stellar foundation

- Rename app to zkDNS Stellar.
- Keep product screens focused only on proof generation, credentials, and credential-gated actions.
- Add Stellar wallet connection.
- Add Stellar network config.
- Create Soroban workspace.
- Add registry and verifier contract skeletons.
- Add README with exact local setup.

Acceptance:

- App runs.
- Wallet connects.
- Contract IDs are loaded from env.
- UI shows proof workflow shell.

### M1 — Credential registry on Soroban

Build Soroban registry functions:

```rust
initialize(admin, verifier_contract)
verify_and_issue(owner, public_inputs, proof)
get_credential(nullifier)
get_credentials_by_owner(owner)
revoke(nullifier)
renew(nullifier, new_expiry)
require_valid_credential(owner, nullifier)
```

Acceptance:

- Registry stores credential state.
- Duplicate nullifier fails.
- Expired credential fails gated check.
- Revoked credential fails gated check.
- Unit tests cover all status transitions.

### M2 — Proof adapter and verifier contract

Build the verifier contract and proof adapter.

MVP path:

- Use a Groth16 verifier contract.
- Use a small circuit proving private preimage ownership, record commitment binding, nullifier derivation, and timestamp bounds.

Full path:

- Use RISC Zero for DNSSEC verification logic.
- Verify compressed/Groth16 proof on Soroban.
- Keep raw DNSSEC material outside the chain.

Acceptance:

- Valid proof passes.
- Invalid proof fails.
- Wrong nullifier fails.
- Wrong owner commitment fails.
- Stale validity window fails.

### M3 — DNSSEC ingestion and private DNS proof UX

- Add DNS TXT instruction generator.
- Add DNSSEC fetcher utility.
- Add local DNSSEC canonicalization validation.
- Add proof generation status timeline.
- Add credential result card.
- Add clear errors for missing TXT, unsigned zone, invalid RRSIG, expired proof, and duplicate nullifier.

Acceptance:

- User can complete full proof path on testnet.
- UI never sends raw domain to Soroban.
- UI makes failed DNSSEC states understandable.

### M4 — Gated action demo and final polish

- Add `gated_action_demo` Soroban contract.
- Add `GatedActionDemo.js` UI.
- Add explorer links.
- Add final README.
- Add short demo script.
- Add testnet deployment instructions.
- Add “what is private vs public” section.

Acceptance:

- Credential gates another contract.
- Demo can be completed in under three minutes.
- README allows a fresh developer to run the app.
- Product-facing screens remain focused on private DNS identity and Stellar credentials.

---

## 10. Environment and config

Create `.env` for frontend:

```env
REACT_APP_STELLAR_NETWORK=testnet
REACT_APP_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
REACT_APP_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
REACT_APP_ZKDNS_REGISTRY_CONTRACT_ID=
REACT_APP_ZKDNS_VERIFIER_CONTRACT_ID=
REACT_APP_GATED_ACTION_CONTRACT_ID=
REACT_APP_PROVER_URL=http://localhost:8080
```

Create `.env` for prover:

```env
PROVER_MODE=risc0
DNSSEC_TRUST_ANCHOR_FILE=./trust-anchors/root.json
MAX_PROOF_AGE_SECONDS=300
MAX_CREDENTIAL_TTL_SECONDS=2592000
```

Create `.env` for deployment:

```env
STELLAR_SECRET_KEY=
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
```

---

## 11. Risks and open questions

### DNSSEC circuit complexity

DNSSEC is byte-heavy. RSA, SHA-256, canonical RRset construction, label handling, and signature validity checks are non-trivial inside circuits. The practical route is zkVM first, narrowed circuit second.

### Trust anchor strategy

MVP can pin a DNSSEC root or known DNSKEY hash. Full product should verify the chain from the root to the target zone.

### Proof size and verification cost

Soroban verification cost must be measured early. Keep public inputs minimal and use commitments aggressively.

### State lifetime

Credential state and contract Wasm need renewal rules. Add renewal transactions and document operational steps.

### DNS resolver trust

The resolver is only a data fetcher. The proof must validate DNSSEC data independently. Do not trust resolver output without proof verification.

### UX timing

DNS propagation can be slow. The UI should let users save the challenge and resume later.

---

## 12. Reference links for implementers

Use these links as the canonical starting set while implementing. Re-check versioned docs before final deployment because Stellar ZK and Soroban tooling are actively evolving.

### Stellar / Soroban core

| Topic | Link |
|---|---|
| Stellar ZK proof docs | https://developers.stellar.org/docs/build/apps/zk |
| Stellar privacy app docs | https://developers.stellar.org/docs/build/apps/privacy |
| Protocol 25 / X-Ray announcement | https://stellar.org/blog/developers/announcing-stellar-x-ray-protocol-25 |
| Soroban smart contracts overview | https://developers.stellar.org/docs/build/smart-contracts/overview |
| Soroban Rust SDK | https://docs.rs/soroban-sdk |
| Stellar contract SDKs | https://developers.stellar.org/docs/tools/sdks/contract-sdks |
| Stellar CLI overview | https://developers.stellar.org/docs/tools/cli |
| Stellar CLI manual | https://developers.stellar.org/docs/tools/cli/stellar-cli |
| Stellar CLI cookbook | https://developers.stellar.org/docs/tools/cli/cookbook |
| Stellar networks, Testnet, Futurenet, Mainnet | https://developers.stellar.org/docs/networks |
| Stellar RPC providers | https://developers.stellar.org/docs/data/apis/rpc/providers |
| Stellar JS SDK | https://stellar.github.io/js-stellar-sdk/ |
| Stellar frontend dapp guide | https://developers.stellar.org/docs/build/guides/dapps/frontend-guide |
| Contract TTL / storage lifecycle | https://developers.stellar.org/docs/build/guides/conventions/extending-wasm-ttl |
| Stellar asset issuance guide | https://developers.stellar.org/docs/tokens/how-to-issue-an-asset |

### Stellar wallet integration

| Topic | Link |
|---|---|
| Freighter wallet guide | https://developers.stellar.org/docs/build/guides/freighter |
| Freighter developer docs | https://docs.freighter.app/ |
| Freighter API package | https://www.npmjs.com/package/@stellar/freighter-api |
| Stellar Wallet Integration docs | https://developers.stellar.org/docs/tools/developer-tools/wallets |
| Stellar Wallets Kit docs | https://creit-tech.github.io/Stellar-Wallets-Kit/ |
| Stellar Wallets Kit repository | https://github.com/Creit-Tech/Stellar-Wallets-Kit |

### ZK proving and verification

| Topic | Link |
|---|---|
| zkDNSSEC GitHub repository | https://github.com/Envoy-VC/zk-dnssec |
| zkDNSSEC ETHGlobal showcase | https://ethglobal.com/showcase/zkdnssec-6sd9h |
| Succinct SP1 docs | https://docs.succinct.xyz/ |
| RISC Zero verifier on Stellar | https://stellar.org/blog/developers/risc-zero-verifier |
| Nethermind Stellar RISC Zero verifier docs | https://github.com/NethermindEth/stellar-risc0-verifier/blob/main/docs/verifying-risc0-proofs.md |
| RISC Zero verifier contracts docs | https://dev.risczero.com/api/blockchain-integration/contracts/verifier |
| RISC Zero security model | https://dev.risczero.com/api/security-model |
| RISC Zero main site | https://risczero.com/ |
| stellar-zk-groth16 crate | https://docs.rs/stellar-zk-groth16/ |
| stellar-zk-ultrahonk crate | https://docs.rs/crate/stellar-zk-ultrahonk/0.1.0 |
| Soroban verifier generator | https://github.com/mysteryon88/soroban-verifier-gen |
| Stellar Hacks ZK resources | https://dorahacks.io/hackathon/stellar-hacks-zk/resources |
| Stellar Hacks ZK detail page | https://dorahacks.io/hackathon/stellar-hacks-zk/detail |

### DNSSEC standards and domain-proof references

| Topic | Link |
|---|---|
| RFC 4033 — DNSSEC introduction and requirements | https://www.rfc-editor.org/info/rfc4033/ |
| RFC 4034 — DNSSEC resource records | https://datatracker.ietf.org/doc/html/rfc4034 |
| RFC 4035 — DNSSEC protocol modifications | https://datatracker.ietf.org/doc/html/rfc4035 |
| RFC 5155 — DNSSEC NSEC3 | https://datatracker.ietf.org/doc/html/rfc5155 |
| RFC 6840 — DNSSEC clarifications and implementation notes | https://www.rfc-editor.org/info/rfc6840/ |
| RFC 9276 — NSEC3 parameter guidance | https://www.rfc-editor.org/info/rfc9276/ |
| Cloudflare DNSSEC explanation | https://www.cloudflare.com/learning/dns/dnssec/how-dnssec-works/ |
| Cloudflare TXT record explanation | https://www.cloudflare.com/learning/dns/dns-records/dns-txt-record/ |
| Cloudflare DNSSEC registrar guide | https://developers.cloudflare.com/registrar/get-started/enable-dnssec/ |

### Security and engineering review

| Topic | Link |
|---|---|
| Soroban security checklist by Veridise | https://veridise.com/blog/audit-insights/building-on-stellar-soroban-grab-this-security-checklist-to-avoid-vulnerabilities/ |
| OpenZeppelin Stellar contracts | https://github.com/OpenZeppelin/stellar-contracts |

### AI assistance and developer workflow

Use AI assistance only as an implementation accelerator. AI tools may help generate scaffolding, explain unfamiliar SDKs, draft tests, review Rust/TypeScript errors, and create demo documentation, but they must not be treated as the source of truth for protocol behavior, cryptographic security, Stellar transaction semantics, or DNSSEC validation. Every AI-generated implementation detail must be checked against the official Stellar, Soroban, DNSSEC, and proving-system references above.

| Topic | Link | Usage note |
|---|---|---|
| OpenAI platform docs | https://platform.openai.com/docs | Use for coding-assistant workflows, tool-backed agents, structured outputs, and implementation planning. |
| OpenAI API reference | https://platform.openai.com/docs/api-reference | Use when building any optional AI-assisted local developer agent or PRD-to-task automation. |
| OpenAI prompting guide | https://platform.openai.com/docs/guides/prompting | Use to standardize prompts for code review, test generation, and documentation drafting. |
| Anthropic Claude API docs | https://docs.anthropic.com/ | Use for alternative AI assistant workflows and long-context codebase review. |
| Claude Code overview | https://docs.anthropic.com/en/docs/claude-code/overview | Use for terminal-based codebase editing, bug fixing, and implementation assistance. |
| Claude Code quickstart | https://docs.anthropic.com/en/docs/claude-code/quickstart | Use to set up local AI-assisted development if the team chooses Claude Code. |
| Claude prompt engineering docs | https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview | Use to create repeatable prompts for reviewing Soroban contracts, prover code, and frontend flows. |
| Cursor documentation | https://docs.cursor.com/ | Use for IDE-based code generation, project indexing, and implementation assistance. |
| GitHub Copilot documentation | https://docs.github.com/en/copilot | Use for inline coding support and test-writing assistance. |

AI-assistance guardrails:

- Do not use AI-generated cryptography code without human review and deterministic tests.
- Do not accept AI-generated DNSSEC canonicalization logic unless it is checked against RFC 4034 and RFC 4035 test cases.
- Do not let AI tools invent Stellar host functions, Soroban APIs, RPC methods, or wallet APIs. Verify each API call against current docs.
- Do not put private domains, private keys, secrets, proof witnesses, or real DNS records into external AI tools.
- Prefer AI assistance for scaffolding, test-case expansion, docs, error explanation, and UI copy.
- Require manual review for verifier contracts, proof serialization, public input ordering, nullifier derivation, credential expiry logic, and relayer flows.

## 13. Definition of done

MVP is done when:

- React app is branded as zkDNS Stellar.
- Stellar wallet connection works on testnet.
- Soroban registry contract stores credentials.
- Verifier contract accepts a valid proof and rejects invalid proof inputs.
- Nullifier reuse is blocked.
- Credential expiry is enforced.
- Gated action contract consumes the credential.
- UI shows what is public and what stays private.
- README includes setup, deploy, proof generation, and demo instructions.
- Product-facing copy describes private DNS identity and credential-gated Stellar actions.

M2 demo can be considered shippable if the DNSSEC proof is simplified but the public/private input model is honest and the verifier path is real.

M4 demo is the target for judging: full DNSSEC proof path, Soroban credential, and reusable gated action.
