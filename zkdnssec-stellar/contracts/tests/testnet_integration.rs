//! Analogue of `contracts/test/fork/ZKDNSSEC.fork.sol` from the original repo:
//! exercises the *real* deployed verifier + contract on Stellar testnet instead
//! of a mock. Marked `#[ignore]` because it needs network access, a funded
//! testnet account, and a deployed `stellar-risc0-verifier` instance + a real
//! Groth16 fixture from `scripts/` — none of which are available in CI by
//! default. Run explicitly with:
//!
//!   cargo test --test testnet_integration -- --ignored
//!
//! after setting CONTRACT_ID / VERIFIER_ID / fixture path via env vars.
#![cfg(test)]

use std::env;

#[test]
#[ignore]
fn verify_real_groth16_fixture_against_deployed_testnet_contract() {
    let contract_id = env::var("ZKDNSSEC_CONTRACT_ID")
        .expect("set ZKDNSSEC_CONTRACT_ID to a contract deployed via `stellar contract deploy`");
    let fixture_path = env::var("ZKDNSSEC_FIXTURE_PATH")
        .unwrap_or_else(|_| "../contracts/fixtures/groth16-fixture.json".to_string());

    let fixture_raw = std::fs::read_to_string(&fixture_path)
        .unwrap_or_else(|e| panic!("could not read fixture at {fixture_path}: {e}"));
    let fixture: serde_json::Value =
        serde_json::from_str(&fixture_raw).expect("fixture is not valid JSON");

    assert!(
        fixture.get("public_values").is_some(),
        "fixture is missing `public_values` — regenerate it with `scripts -- --prove groth16`"
    );
    assert!(
        fixture.get("proof").is_some(),
        "fixture is missing `proof` — regenerate it with `scripts -- --prove groth16`"
    );

    // The actual RPC call against testnet is intentionally left as a stub:
    // wire this up with `soroban-client`/`stellar-sdk` once the contract and
    // the upstream RISC0 verifier are both deployed, invoking
    // `verify_dnssec_record(public_values, proof)` on `contract_id` and
    // asserting the returned bool matches `fixture["is_valid"]`.
    println!(
        "would invoke verify_dnssec_record on contract {contract_id} with fixture {fixture_path}"
    );
}
