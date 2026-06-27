# Cloakwork — Proof Systems

Cloakwork uses two off-chain proving paths. Both produce proofs that are verified
by Soroban contracts on Stellar using native BN254/Poseidon host functions.

---

## `circom/` — Groth16 via Circom 2.0 (primary path)

Proves that a DNS TXT challenge record is bound to specific Poseidon commitments
(domain, record value, owner address) and that the RRSIG validity window is correct
— without revealing the domain name, record, or DNSSEC material.

**Stack:** Circom 2.0 → snarkjs → Groth16 proof → Soroban `cloakwork_verifier`

```bash
# Compile circuit
cd circom && circom cloakwork.circom --r1cs --wasm --sym --O2 -o build/

# Trusted setup (one-time)
bash ../scripts/setup.sh

# Generate a proof
node scripts/prove.js --witness input.example.json
```

---

## `risc0/` — Groth16 via RISC Zero zkVM (DNSSEC validation path)

Proves that a full DNSSEC RRSIG is a valid cryptographic signature over a record set
under RFC 4034 canonicalization — without revealing the record, signature, or queried
domain name. Delegates Groth16 verification to the deployed
[stellar-risc0-verifier](https://github.com/NethermindEth/stellar-risc0-verifier).

**Stack:** RISC Zero guest (Rust) → Groth16 receipt → Soroban `cloakwork_risc0_verifier`

```bash
# Execute guest without proof (fast validation)
cd risc0/scripts && cargo run -- --execute

# Generate a chain-verifiable Groth16 proof
cd risc0/scripts && cargo run -- --prove groth16
```

**Prerequisites:** `cargo install cargo-risczero && cargo risczero install`

---

Both paths feed into the same `cloakwork_registry` credential issuance flow.
See [DEPLOYMENT.md](../DEPLOYMENT.md) for deploying the verifier contracts.
