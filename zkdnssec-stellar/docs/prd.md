# zkDNSSEC-Stellar — Product Requirements & Migration PRD

> **Read me first (for the implementing agent).** You have been given a full copy of the
> **zkDNSSEC** repository (`zk-dnssec-main`) as your starting point. zkDNSSEC proves that a DNS
> record is validly signed under DNSSEC (RFC 4034) without revealing the record, its RRSIG, or the
> queried domain. Today it proves with **Succinct's SP1 zkVM** and verifies on **EVM chains** via a
> Solidity contract calling `SP1VerifierGateway`. Your job is to **rip out the SP1 + EVM verification
> plane and rebuild it on Stellar/Soroban**, keeping the DNSSEC/crypto logic in `lib/` as close to
> untouched as possible.
>
> Before writing any code, read `https://skills.stellar.org/` (or point your agent at it directly —
> "Read skills.stellar.org before you start building on Stellar") and the two core docs pages:
> **ZK Proofs on Stellar** (`https://developers.stellar.org/docs/build/apps/zk`) and **Privacy on
> Stellar** (`https://developers.stellar.org/docs/build/apps/privacy`). Those two pages are the map
> of the whole landscape this PRD is built on.

---

## 1. What zkDNSSEC-Stellar is

**zkDNSSEC-Stellar** is zkDNSSEC repointed at Stellar: a user (or relayer) holds a DNS record
(`A`/`TXT`/`CNAME`/...), its RRSIG, and the zone's DNSKEY. They generate a ZK proof off-chain that the
RRSIG is a valid signature over the record under the DNSKEY (RFC 4034 canonical-form hashing +
ECDSA/RSA verification), **without revealing the record, the signature bytes, or the queried name**.
A **Soroban smart contract** verifies that proof and exposes a single `bool is_valid` (and optionally a
commitment/nullifier) on-chain — enabling private domain-ownership proofs, DNSSEC-anchored bridge
authorization, confidential PKI (CAA/TLSA), and DNSSEC-validated light-client peer lists, all without
a verifier ever seeing the underlying DNS data.

The pitch for judges: *"DNS already has a cryptographic chain of trust — DNSSEC. zkDNSSEC-Stellar lets
anyone prove a record is validly signed under that chain, and have Soroban check it in milliseconds,
without the chain (or anyone watching it) ever learning which domain or record was involved."*

### Two stacks, same shape

| Plane | zkDNSSEC (old) | zkDNSSEC-Stellar (new) |
|---|---|---|
| **Circuit / proving** | Rust program on **SP1 zkVM** (`program/src/main.rs`) reading `(public_key, name, dns_class, sig, record, signature)`, calling `verify_rrsig` from `lib/`, committing `PublicValuesStruct { is_valid }` | **RISC Zero zkVM** guest (Rust) — reuses the existing `lib/` DNSSEC parsing + `verify_ecdsa_signature` almost verbatim, recompiled as a RISC0 guest instead of an SP1 guest. Proof type: **Groth16** (EVM/Soroban-verifiable, ~260 bytes) |
| **On-chain verifier** | `contracts/src/ZKDNSSEC.sol` calling `ISP1VerifierGateway.verifyProof(vkey, publicValues, proofBytes)` on an EVM chain | **Soroban Rust contract** calling a deployed **RISC Zero Groth16 verifier** on Stellar, using Stellar's native **BN254 + Poseidon host functions** (Protocol 25/26) |
| **Test harness** | `contracts/test/*.sol` + `forge test` | Soroban contract unit/integration tests (`cargo test` against the Soroban test env) — see Contract Testing docs below |
| **Fixtures** | `contracts/src/fixtures/{groth16,plonk}-fixture.json` | Regenerated Groth16 fixture from the RISC0 guest, formatted for the Soroban verifier's calldata layout |

### Locked design decisions (do not relitigate)

- **Proof system: RISC Zero, not Noir.** The existing circuit logic (DNSSEC RRSET canonicalization,
  RDATA parsing, ECDSA-P256/RSA-SHA verification) is plain Rust today, written against an SP1 zkVM
  guest. RISC0 is also a Rust zkVM — porting `program/src/main.rs` + `lib/` to a RISC0 guest is a
  near drop-in rewrite. Rewriting the same logic as Noir circuits would mean re-deriving
  ECDSA/RSA verification as arithmetic circuits by hand — much higher effort, and not what "porting"
  means here. Use Noir/UltraHonk only as a **stretch goal** (see §9) if time remains.
- **Output proof format: Groth16.** RISC0 supports STARK (Core/Compressed, not chain-verifiable),
  Groth16, and (newer) PLONK-style wrapping — same menu as today. Keep Groth16 since it's the smallest
  on-chain proof and Stellar's BN254 host functions (CAP-0074) make Groth16 verification cheap natively.
- **Verifier: reuse Nethermind's RISC0 Soroban verifier, don't write a pairing-check contract from
  scratch.** `https://github.com/NethermindEth/stellar-risc0-verifier` already implements Groth16
  verification for RISC0 proofs on Soroban using the native BN254/Poseidon host functions. Wrap it,
  don't reinvent it.
- **No bridging to EVM.** The original repo's value-add (Groth16 proof verifiable on any EVM chain) is
  replaced 1:1 by "Groth16 proof verifiable on Stellar" — this is a port, not a multi-chain product.
- **Keep `lib/` DNS/DNSSEC parsing as the single source of truth.** `rr::domain::name::Name`,
  `rr::dnssec::rdata::{sig,dns_key}`, `rr::dnssec::message::construct_rrset_message_with_sig`, and
  `verify_ecdsa_signature` / `verify_rrsig` in `lib/src/lib.rs` move into the RISC0 guest crate with
  **zero logic changes** — only the entrypoint (`sp1_zkvm::entrypoint!` → RISC0's `risc0_zkvm::guest::entry!`)
  and the I/O calls (`sp1_zkvm::io::read*` → `risc0_zkvm::guest::env::read`, `sp1_zkvm::io::commit_slice`
  → `risc0_zkvm::guest::env::commit_slice`) change.
- **`PublicValuesStruct { is_valid }` stays the public output shape.** Encode it the same way (ABI-style
  struct) so the Soroban contract's decode logic is a straight port of `bytes32ToBool` from the
  Solidity contract.

---

## 2. The Stellar ZK stack (orientation for the implementing agent)

Fetch current docs before non-trivial integration work — this is a fast-moving primitive set.

- **ZK Proofs on Stellar** — `https://developers.stellar.org/docs/build/apps/zk` — the core reference:
  what the BN254 and Poseidon/Poseidon2 host functions do, how on-chain proof verification works, code
  examples, circuit-tooling links. Read this first.
- **Privacy on Stellar** — `https://developers.stellar.org/docs/build/apps/privacy` — the landscape map:
  Privacy Pools, Confidential Tokens, on-chain ZK verifiers, underlying primitives.
- **Protocol background** — Stellar X-Ray / Protocol 25 (`https://stellar.org/blog/developers/announcing-stellar-x-ray-protocol-25`)
  added the BN254/Poseidon host functions; Yardstick / Protocol 26
  (`https://stellar.org/blog/foundation-news/stellar-yardstick-protocol-26-upgrade-guide`) made proof
  verification meaningfully cheaper — relevant to gas-budgeting the verifier call.
- **Soroban SDK crypto docs** — BN254: `https://docs.rs/soroban-sdk/latest/soroban_sdk/_migrating/v25_bn254/index.html`;
  Poseidon: `https://docs.rs/soroban-sdk/latest/soroban_sdk/_migrating/v25_poseidon/index.html`.
- **Protocol CAPs (deep cuts)** — BN254: CAP-0074, Poseidon/Poseidon2: CAP-0075, BLS12-381: CAP-0059.

### AI-assisted build setup

Give the agent Stellar context before it writes a line of Soroban code — it materially improves output:

- **Stellar Skills** — `https://skills.stellar.org/` — agent-readable docs with dedicated skills for
  Soroban, dApps/wallets, assets, data/APIs, agentic payments, and **ZK Proofs**. Tell the agent: *"Read
  skills.stellar.org before you start building on Stellar."*
- **ZK Proofs skill (direct)** — `https://skills.stellar.org/skills/zk-proofs/SKILL.md` — verifying
  Groth16 proofs on Stellar using BLS12-381, BN254, and Poseidon.
- **Stellar Dev Skill repo** — `https://github.com/stellar/stellar-dev-skill` — Soroban, SDKs, RPC,
  wallets, passkeys, security patterns. Install in Claude Code: `/plugin marketplace add
  stellar/stellar-dev-skill` then `/plugin install stellar-dev@stellar-dev`.
- **OpenZeppelin Skills** — `https://github.com/OpenZeppelin/openzeppelin-skills` — secure Stellar
  contract patterns. Install: `/plugin marketplace add OpenZeppelin/openzeppelin-skills` then
  `/plugin install openzeppelin-skills`.
- **llms.txt** — `https://developers.stellar.org/llms.txt` — machine-readable digest of the full
  Stellar docs set, good to feed into context for any non-trivial Soroban work.

### On-chain verifier (reference implementation — fork this, don't rewrite it)

- **RISC Zero (Groth16) verifier** — `https://github.com/NethermindEth/stellar-risc0-verifier` — verifies
  Groth16 proofs from RISC0's zkVM (Rust guest programs). Companion writeup:
  `https://stellar.org/blog/developers/risc-zero-verifier`. **This is the direct analogue of
  `ZKDNSSEC.sol` + `SP1VerifierGateway` — same role, different chain.**
- If the team later wants the Noir/UltraHonk stretch (§9): `https://github.com/yugocabrio/rs-soroban-ultrahonk`
  or `https://github.com/indextree/ultrahonk_soroban_contract`.
- For inspiration on ASP-style allow/deny patterns layered on top of a verified proof (useful if a
  "trusted resolver allow-list" feature is added later): Nethermind's Privacy Pools PoC —
  `https://github.com/NethermindEth/stellar-private-payments` (research prototype, not audited —
  pattern reference only, don't depend on it directly). Conceptual basis: the Privacy Pools whitepaper,
  `https://privacypools.com/whitepaper.pdf`.

### Circuit tooling

- **RISC Zero zkVM** — `https://dev.risczero.com/` — write the guest program in ordinary Rust, prove
  its execution. This is the direct replacement for SP1 in this repo.
- **Noir (Aztec)** — `https://noir-lang.org/docs/` — only relevant for the §9 stretch path.

### Core Stellar dev tools (needed regardless of ZK specifics)

- Docs hub: `https://developers.stellar.org/`
- SDKs (use latest for Protocol 26 support): `https://developers.stellar.org/docs/tools/sdks`
- CLI: `https://developers.stellar.org/docs/tools/cli`
- Lab (testnet accounts, request/response explorer): `https://developers.stellar.org/docs/tools/lab`
- Quickstart (local network via Docker): `https://developers.stellar.org/docs/tools/quickstart`
- Scaffold Stellar (full app lifecycle CLI): `https://scaffoldstellar.org`
- Stellar Wallets Kit: `https://stellarwalletskit.dev/`
- OpenZeppelin on Stellar (audited libs, Contracts Wizard, security detectors): `https://www.openzeppelin.com/networks/stellar`
- Smart contract basics: Getting Started (`https://developers.stellar.org/docs/build/smart-contracts/getting-started`),
  Auth (`https://developers.stellar.org/docs/build/guides/auth`), Storage
  (`https://developers.stellar.org/docs/build/guides/storage`), Testing
  (`https://developers.stellar.org/docs/build/guides/testing`)
- Building with AI: `https://developers.stellar.org/docs/build/building-with-ai`

---

## 3. Architecture & the migration seam

zkDNSSEC already has the exact seam needed: **all DNSSEC/crypto logic lives in `lib/`, decoupled from
the zkVM entrypoint in `program/src/main.rs`.** That separation is the migration boundary — almost
nothing in `lib/` needs to change.

```
lib/src/lib.rs                         <- KEEP, unchanged
  verify_ecdsa_signature()             <- KEEP
  verify_rrsig()                       <- KEEP
lib/src/rr/**                          <- KEEP, unchanged (Name, DNSClass, SIG, DNSKEY, Record, ...)
lib/src/serialize/**                   <- KEEP, unchanged

program/src/main.rs                    <- PORT: sp1_zkvm -> risc0_zkvm guest entrypoint + I/O calls

contracts/src/ZKDNSSEC.sol             <- REPLACE: Soroban Rust contract wrapping the RISC0 verifier
contracts/test/**                      <- REPLACE: Soroban cargo test equivalents
scripts/src/entrypoint.rs              <- PORT: SP1 prover client calls -> RISC0 prover client calls
.env.example (SP1_PROVER, NETWORK_PRIVATE_KEY) <- PORT: RISC0 prover-mode env vars + Soroban deployer key
```

### `program/` — the guest program (port, not rewrite)

Today:
```rust
#![no_main]
sp1_zkvm::entrypoint!(main);
pub fn main() {
    let public_key = sp1_zkvm::io::read_vec();
    let name = sp1_zkvm::io::read::<Name>();
    let dns_class = sp1_zkvm::io::read::<DNSClass>();
    let sig = sp1_zkvm::io::read::<SIG>();
    let record = sp1_zkvm::io::read::<Record>();
    let signature = sp1_zkvm::io::read_vec();
    let is_valid = verify_rrsig(public_key, &name, dns_class, &sig, &[record], signature);
    let bytes = PublicValuesStruct::abi_encode(&PublicValuesStruct { is_valid });
    sp1_zkvm::io::commit_slice(&bytes);
}
```
Target shape (RISC0 guest — `https://dev.risczero.com/`):
```rust
#![no_main]
risc0_zkvm::guest::entry!(main);
pub fn main() {
    let public_key: Vec<u8> = risc0_zkvm::guest::env::read();
    let name: Name = risc0_zkvm::guest::env::read();
    let dns_class: DNSClass = risc0_zkvm::guest::env::read();
    let sig: SIG = risc0_zkvm::guest::env::read();
    let record: Record = risc0_zkvm::guest::env::read();
    let signature: Vec<u8> = risc0_zkvm::guest::env::read();
    let is_valid = zkdnssec_lib::verify_rrsig(public_key, &name, dns_class, &sig, &[record], signature);
    let bytes = PublicValuesStruct::abi_encode(&PublicValuesStruct { is_valid });
    risc0_zkvm::guest::env::commit_slice(&bytes);
}
```
`verify_rrsig` and every type it touches (`Name`, `DNSClass`, `SIG`, `Record`) come straight from
`lib/` with no edits — they already derive `Serialize`/`Deserialize`, which RISC0's `env::read`
(bincode-based) and SP1's `io::read` (also serde-based) both consume the same way.

### `scripts/` — the host/prover harness (port)

`scripts/src/entrypoint.rs` currently drives the SP1 `ProverClient`, picks `--execute` vs
`--prove {core|compressed|groth16|plonk}`, and writes fixtures to `contracts/src/fixtures/`. Port this
1:1 to RISC0's `ExecutorEnv` / `default_prover()` API, keeping the same CLI surface
(`--execute`, `--prove groth16`) so existing muscle memory / demo scripts don't change. Output fixture
JSON shape should match whatever calldata layout the chosen Soroban verifier expects (see
`stellar-risc0-verifier`'s test fixtures for the target format) rather than the Solidity ABI shape.

### `contracts/` — the on-chain verifier (rebuild on Soroban)

Today, `ZKDNSSEC.sol` is a thin wrapper: it holds a `verifier` address + `zkDNSSECProgramVKey`, and
`verifyDNSSECRecord(publicValues, proofBytes)` just calls `ISP1VerifierGateway.verifyProof(...)`.

Target: a Soroban Rust contract with the same shape, wrapping the deployed RISC0 Groth16 verifier from
`https://github.com/NethermindEth/stellar-risc0-verifier` instead of an `SP1VerifierGateway`:

```rust
#[contract]
pub struct ZkDnssec;

#[contractimpl]
impl ZkDnssec {
    pub fn init(env: Env, verifier: Address, program_image_id: BytesN<32>) { /* store config */ }

    /// Mirrors ZKDNSSEC.sol::verifyDNSSECRecord — verify a proof that a DNSSEC RRSIG is valid,
    /// without ever seeing the record/signature/name themselves.
    pub fn verify_dnssec_record(env: Env, public_values: Bytes, proof: Bytes) -> bool {
        // Calls into the RISC0 verifier contract via Soroban cross-contract call,
        // passing program_image_id (the RISC0 analogue of zkDNSSECProgramVKey).
        // Decode `public_values` -> PublicValuesStruct { is_valid } the same way
        // bytes32ToBool() did in the Solidity version.
    }
}
```
Storage (`program_image_id`, `verifier` address) replaces Solidity's constructor-set immutable
`verifier`/`zkDNSSECProgramVKey` — see Contract Storage docs:
`https://developers.stellar.org/docs/build/guides/storage`. Auth checks on `init` (admin-only) follow
`https://developers.stellar.org/docs/build/guides/auth`.

### Tests (port)

`contracts/test/fork/ZKDNSSEC.fork.sol` and `contracts/test/mock/ZKDNSSEC.t.sol` become Soroban
contract tests under the new `contracts/` crate, following
`https://developers.stellar.org/docs/build/guides/testing`. Keep the same two-tier structure: a "mock"
test that feeds a canned valid/invalid proof + public-values fixture, and a "fork"-equivalent test that
exercises the real deployed verifier on Stellar testnet (Lab-funded testnet account —
`https://developers.stellar.org/docs/tools/lab`).

---

## 4. Component-by-component migration map

| Area | File(s) | Action |
|---|---|---|
| **DNS/DNSSEC parsing & crypto** | `lib/src/**` (`rr/*`, `serialize/*`, `verify_ecdsa_signature`, `verify_rrsig`) | **Keep, unchanged.** This is the contract everything else builds on. |
| **Public output shape** | `lib/src/lib.rs` (`PublicValuesStruct { is_valid }`, `alloy_sol_types::sol!`) | Keep the struct + ABI-encode call; only the consumer (RISC0 guest, then Soroban contract) changes. |
| **zkVM guest entrypoint** | `program/src/main.rs` | Port `sp1_zkvm::entrypoint!`/`io::read*`/`io::commit_slice` → RISC0 `guest::entry!`/`env::read`/`env::commit_slice`. Logic body unchanged. |
| **Guest crate deps** | `program/Cargo.toml` | Swap `sp1-zkvm` dependency for `risc0-zkvm` guest crate; keep `alloy-sol-types`, `zkdnssec_lib` deps. |
| **Host prover harness** | `scripts/src/entrypoint.rs`, `scripts/src/helpers.rs`, `scripts/build.rs` | Port SP1 `ProverClient`/build-script (ELF embedding) calls to RISC0's `default_prover()`/`ExecutorEnv` and RISC0's guest-build pipeline (`risc0_build`). Keep the `--execute` / `--prove {mode}` CLI surface. |
| **Proof modes** | N/A (was Core/Compressed/Groth16/PLONK) | RISC0 equivalents: **Succinct receipt** (non-chain-verifiable, like Core/Compressed) and **Groth16-wrapped receipt** (chain-verifiable — this is the one Soroban consumes). Drop PLONK; RISC0's chain-verifiable path is Groth16. |
| **On-chain verifier contract** | `contracts/src/ZKDNSSEC.sol` | Replace with a Soroban Rust contract (`#[contract]`/`#[contractimpl]`) wrapping `stellar-risc0-verifier`. Same two fields (verifier address, program identifier), same single verify entrypoint. |
| **EVM verifier dependency** | `@sp1-contracts/SP1VerifierGateway` (via `contracts/lib` git submodule) | Replace with `https://github.com/NethermindEth/stellar-risc0-verifier` as a Soroban contract dependency/cross-call target. |
| **Test fixtures** | `contracts/src/fixtures/{groth16,plonk}-fixture.json` | Regenerate a single `groth16-fixture.json` from the RISC0 guest, in the calldata shape the Soroban verifier expects. Drop the PLONK fixture (no PLONK path on the new stack). |
| **Tests** | `contracts/test/fork/ZKDNSSEC.fork.sol`, `contracts/test/mock/ZKDNSSEC.t.sol` | Reimplement as Soroban `cargo test` contract tests (mock-fixture test + testnet integration test). |
| **Env config** | `.env.example` (`SP1_PROVER`, `NETWORK_PRIVATE_KEY`) | Replace with RISC0 prover-mode var (local/Bonsai network prover, if used) + a Stellar testnet deployer/funder secret key (generate via Lab: `https://developers.stellar.org/docs/tools/lab`). |
| **Build/CI** | `rust-toolchain.toml`, `Cargo.lock`, `.gitmodules` | Update toolchain pin if RISC0 requires a different Rust version; replace the `sp1-contracts`/Foundry git submodule with whatever vendoring the chosen Soroban verifier repo uses (likely a Cargo path/git dependency, no submodule needed). |
| **README** | `README.md` | Rewrite "Installation & Usage", "Proof Systems" table, and "EVM Verification" sections for the Soroban stack; keep the DNS/DNSSEC background sections (§§ DNS Basics, DNSSEC mechanics) verbatim — they don't change with the chain. |

---

## 5. Public-values & proof flow (end to end)

1. **Off-chain (prover/relayer):** fetch the RRset + RRSIG + DNSKEY for a domain from a recursive
   resolver (or a pre-captured fixture for the demo). Feed `(public_key, name, dns_class, sig, record,
   signature)` into the RISC0 guest via `scripts/`.
2. **RISC0 proves:** the guest runs `verify_rrsig` (unchanged DNSSEC canonicalization + ECDSA/RSA
   check from `lib/`), commits `PublicValuesStruct { is_valid }`, and the host wraps the resulting
   receipt as a **Groth16 SNARK** (chain-verifiable, ~260 bytes, matching the original repo's headline
   number).
3. **Submit to Soroban:** call `ZkDnssec::verify_dnssec_record(public_values, proof)` on the deployed
   contract. The contract cross-calls the RISC0 verifier (`stellar-risc0-verifier`), which checks the
   Groth16 proof against the program's image ID using Stellar's native **BN254 pairing + Poseidon hash**
   host functions (cheap as of Protocol 26 — `https://stellar.org/blog/foundation-news/stellar-yardstick-protocol-26-upgrade-guide`).
4. **On-chain result:** the contract returns/stores `is_valid` — the only thing ever exposed on-chain.
   The domain name, record contents, RRSIG bytes, and DNSKEY never touch the ledger.

This is the exact same four-step flow as the original repo's "Architecture & Design" section — only
step 2's prover and step 3's verifier moved chains.

---

## 6. Use cases (unchanged from the original — still the pitch)

- **Private Domain Ownership Proof** — prove control of a domain without revealing which one.
- **Trustless cross-chain bridging** — prove a `_bridge.chain.example.com` TXT record authorizes a
  transfer, without leaking the bridge's routing metadata.
- **DNSSEC-anchored confidential PKI** — prove a CAA/TLSA (DANE) record authorizes a TLS cert without
  revealing the cert's public key or the DNS query.
- **Light-client bootstrapping** — validate DNSSEC-signed ENR-style peer records with ZK proofs so
  light clients don't have to trust the resolver, without exposing the peer list query.
- A Stellar-native fifth use case worth pitching to judges: **private Soroban-domain → off-chain-domain
  binding** — prove a Soroban contract/account is the legitimate operator of an off-chain DNSSEC-signed
  domain (for verified-issuer UX, e.g. anchors/SEPs) without publishing which domain on-chain.

---

## 7. Installation & usage (target state)

```bash
# Execute the guest program (no proof) — RISC0 analogue of `cargo run -- --execute`
cd scripts && cargo run -- --execute

# Generate a chain-verifiable proof
cd scripts && cargo run -- --prove groth16

# Build & deploy the Soroban verifier wrapper contract
cd contracts && stellar contract build
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/zk_dnssec.wasm \
  --source <deployer> --network testnet

# Run contract tests
cd contracts && cargo test
```
(`stellar contract` CLI per `https://developers.stellar.org/docs/tools/cli`; local network option via
`https://developers.stellar.org/docs/tools/quickstart` if testing without testnet round-trips.)

---

## 8. Milestones

- **M0 — Stack bring-up.** Stellar CLI + SDK installed, testnet account funded via Lab, RISC0 toolchain
  installed, `stellar-risc0-verifier` cloned and deployed as-is to testnet to confirm it verifies its
  own sample proofs before touching zkDNSSEC code.
- **M1 — Guest port.** `program/` + `lib/` recompiled as a RISC0 guest; `--execute` produces the same
  `is_valid` result as the SP1 version on the same fixture inputs (cross-check against
  `contracts/src/fixtures/groth16-fixture.json`'s expected output).
- **M2 — Proof generation.** `--prove groth16` produces a Groth16 receipt; convert/format it into the
  calldata shape `stellar-risc0-verifier` expects.
- **M3 — Soroban contract.** `ZkDnssec` contract written, deployed to testnet, `verify_dnssec_record`
  called end-to-end against an M2 proof; mock + testnet integration tests passing.
- **M4 — Demo & docs.** README rewritten for the new stack; a short script/UI showing: fetch a real
  DNSSEC-signed record → prove → submit to Soroban → on-chain `is_valid: true`, with the original
  record/signature never leaving the prover's machine.

---

## 9. Stretch goals (optional, time-permitting)

- **Noir/UltraHonk circuit instead of RISC0.** Hand-write the ECDSA-P256/RSA-SHA verification as a Noir
  circuit (`https://noir-lang.org/docs/`), verified via `https://github.com/yugocabrio/rs-soroban-ultrahonk`
  or `https://github.com/indextree/ultrahonk_soroban_contract`. Smaller proofs, cheaper verification,
  but a real circuit-design effort (signature verification isn't free to express as arithmetic
  constraints) — only attempt this after M0–M4 are solid.
- **Recursive chain of trust** (root → TLD → domain in one proof) and **NSEC/NSEC3 denial-of-existence
  proofs** — both already on the original repo's roadmap; equally applicable here, gated on the M0–M4
  port landing first.
- **ASP-style resolver allow-list**, borrowing the deny/allow-list pattern from Stellar's Privacy Pools
  PoC (`https://github.com/NethermindEth/stellar-private-payments`), if the project wants a compliance
  angle (e.g. "only DNSSEC proofs anchored to a recognized TLD's KSK are accepted").

---

## 10. Reference index (everything above, in one place)

| Purpose | Link |
|---|---|
| ZK Proofs on Stellar (start here) | `https://developers.stellar.org/docs/build/apps/zk` |
| Privacy on Stellar (landscape map) | `https://developers.stellar.org/docs/build/apps/privacy` |
| Protocol 25 (BN254/Poseidon added) | `https://stellar.org/blog/developers/announcing-stellar-x-ray-protocol-25` |
| Protocol 26 (cheaper proof verification) | `https://stellar.org/blog/foundation-news/stellar-yardstick-protocol-26-upgrade-guide` |
| Stellar Skills (agent context) | `https://skills.stellar.org/` |
| ZK Proofs skill (direct) | `https://skills.stellar.org/skills/zk-proofs/SKILL.md` |
| Stellar Dev Skill repo | `https://github.com/stellar/stellar-dev-skill` |
| OpenZeppelin Skills | `https://github.com/OpenZeppelin/openzeppelin-skills` |
| llms.txt | `https://developers.stellar.org/llms.txt` |
| **RISC0 Groth16 verifier (fork this)** | `https://github.com/NethermindEth/stellar-risc0-verifier` |
| RISC0 verifier writeup | `https://stellar.org/blog/developers/risc-zero-verifier` |
| RISC Zero zkVM docs | `https://dev.risczero.com/` |
| Noir docs (stretch only) | `https://noir-lang.org/docs/` |
| UltraHonk verifier #1 (stretch only) | `https://github.com/yugocabrio/rs-soroban-ultrahonk` |
| UltraHonk verifier #2 (stretch only) | `https://github.com/indextree/ultrahonk_soroban_contract` |
| Privacy Pools PoC (pattern reference) | `https://github.com/NethermindEth/stellar-private-payments` |
| Privacy Pools whitepaper | `https://privacypools.com/whitepaper.pdf` |
| Soroban SDK — BN254 | `https://docs.rs/soroban-sdk/latest/soroban_sdk/_migrating/v25_bn254/index.html` |
| Soroban SDK — Poseidon | `https://docs.rs/soroban-sdk/latest/soroban_sdk/_migrating/v25_poseidon/index.html` |
| Stellar Docs hub | `https://developers.stellar.org/` |
| SDKs | `https://developers.stellar.org/docs/tools/sdks` |
| CLI | `https://developers.stellar.org/docs/tools/cli` |
| Lab (testnet accounts) | `https://developers.stellar.org/docs/tools/lab` |
| Quickstart (local network) | `https://developers.stellar.org/docs/tools/quickstart` |
| Scaffold Stellar | `https://scaffoldstellar.org` |
| Stellar Wallets Kit | `https://stellarwalletskit.dev/` |
| OpenZeppelin on Stellar | `https://www.openzeppelin.com/networks/stellar` |
| Smart Contracts — Getting Started | `https://developers.stellar.org/docs/build/smart-contracts/getting-started` |
| Contract Authorization | `https://developers.stellar.org/docs/build/guides/auth` |
| Contract Storage | `https://developers.stellar.org/docs/build/guides/storage` |
| Contract Testing | `https://developers.stellar.org/docs/build/guides/testing` |
| Building with AI | `https://developers.stellar.org/docs/build/building-with-ai` |
| Stellar Ecosystem Resources | `https://github.com/stellar/ecosystem-resources/` |
| Stellar Hackathon FAQ | `https://github.com/briwylde08/stellar-hackathon-faq` |
| Stellar Ecosystem DB | `https://github.com/lumenloop/stellar-ecosystem-db` |
