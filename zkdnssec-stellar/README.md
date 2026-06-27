# zkDNSSEC-Stellar

**Zero-Knowledge DNSSEC Validation for Trustless, Private DNS — on Stellar/Soroban**

Proves that a DNS record (`A`, `TXT`, `CNAME`, ...) is validly signed under DNSSEC
([RFC 4034](https://www.rfc-editor.org/rfc/rfc4034)) without revealing the record, its RRSIG
signature, or the queried domain name. Proofs are generated with the
[RISC Zero zkVM](https://dev.risczero.com/) and verified on **Soroban** using Stellar's native
BN254/Poseidon host functions, via
[Nethermind's RISC0 Groth16 verifier](https://github.com/NethermindEth/stellar-risc0-verifier).

Originally built and demoed as [envoy1084/zk-dnssec](https://github.com/envoy1084/zk-dnssec)
against SP1 + EVM. This repo carries the DNSSEC parsing and signature-verification core forward
unchanged and rebuilds the proving + on-chain verification layers for Stellar.

## Layout

```
lib/        DNSSEC/DNS wire-format parsing + ECDSA verification core (chain-agnostic)
program/    RISC0 zkVM guest program — proves RRSIG validity over a record set
scripts/    Host-side prover harness: fetches records, drives the RISC0 prover, writes fixtures
contracts/  Soroban contract verifying RISC0 Groth16 proofs of DNSSEC validity
stretch/    Optional Noir/UltraHonk path (smaller proofs, more circuit-design effort)
  noir-circuit/        Noir circuit re-expressing the ECDSA check as constraints
  ultrahonk-contract/  Soroban wrapper for an UltraHonk verifier
smoke_tests/run_all.sh  Runs the strongest check available for every component above
```

## Stack

| Plane | Component | Notes |
|---|---|---|
| Proving | RISC0 zkVM (`program/`, `scripts/`) | Rust guest program, Groth16-wrapped output |
| On-chain verification | Soroban contract (`contracts/`) | Wraps `stellar-risc0-verifier`, decodes `is_valid` |
| Stretch: proving | Noir circuit (`stretch/noir-circuit/`) | ECDSA-P256 as arithmetic constraints |
| Stretch: verification | Soroban + UltraHonk (`stretch/ultrahonk-contract/`) | Wraps an UltraHonk verifier |

## Building & running

Requires a current Rust toolchain (`rustup`, stable ≥ 1.85), the
[RISC0 toolchain](https://dev.risczero.com/api/zkvm/install) (`cargo install cargo-risczero &&
cargo risczero install`), and the [Stellar CLI](https://developers.stellar.org/docs/tools/cli).

```bash
# Execute the guest program without producing a proof
cd scripts && cargo run -- --execute

# Generate a chain-verifiable Groth16 proof
cd scripts && cargo run -- --prove groth16

# Build + deploy the Soroban verifier wrapper
cd contracts && stellar contract build
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/zkdnssec_contract.wasm \
  --source <deployer> --network testnet

# Run contract tests
cd contracts && cargo test
```

For the Noir/UltraHonk stretch path: `cd stretch/noir-circuit && nargo test`, and
`cd stretch/ultrahonk-contract && cargo test` for its Soroban wrapper.

## Smoke tests

`smoke_tests/run_all.sh` checks every component above, including both stretch goals. For each
one it runs the strongest check actually possible: real `cargo test`/`nargo test` if the relevant
toolchain is installed, and a structural/consistency check otherwise (so it still runs somewhere
without RISC0, Soroban, or Nargo installed).

```bash
bash smoke_tests/run_all.sh
```

> Note: this scaffold was assembled in a sandboxed environment with only an apt-installed Rust
> 1.75 toolchain and no access to `rustup`'s installer or the RISC0/Soroban toolchain installers.
> Several current crates in this dependency tree (RustCrypto's `zeroize`/`elliptic-curve` chain,
> `risc0-zkvm`, `soroban-sdk`) require `edition2024`/rustc ≥ 1.85. `lib/`'s logic was validated
> against the original SP1-based program's expected behavior; full `cargo test` runs across the
> whole workspace need a real, current Rust + RISC0 + Soroban toolchain to execute.

## Use cases

- Private domain-ownership proofs
- Trustless cross-chain bridge authorization via a DNSSEC-signed TXT record
- DNSSEC-anchored confidential PKI (CAA/TLSA validation without revealing the certificate)
- Light-client peer-list validation without trusting (or exposing queries to) a resolver

## References

- ZK Proofs on Stellar: https://developers.stellar.org/docs/build/apps/zk
- Privacy on Stellar: https://developers.stellar.org/docs/build/apps/privacy
- RISC0 Groth16 Soroban verifier: https://github.com/NethermindEth/stellar-risc0-verifier
- RISC Zero zkVM: https://dev.risczero.com/
- Stellar Skills (AI agent context): https://skills.stellar.org/
- Noir (stretch): https://noir-lang.org/docs/
- UltraHonk Soroban verifiers (stretch): https://github.com/yugocabrio/rs-soroban-ultrahonk,
  https://github.com/indextree/ultrahonk_soroban_contract

<!-- Submitted to Stellar Hacks: Real-World ZK � June 2026 -->
