// Stretch-goal Noir circuit (PRD §9): proves that an ECDSA-P256 signature
// (the RRSIG) is valid over a DNSSEC RRset hash under a given public key
// (the zone's DNSKEY), without revealing the message or signature.
//
// This is the Noir/UltraHonk alternative to the RISC0 guest in `program/`.
// It is NOT wired up to a prover/verifier pipeline yet — `main` below is a
// skeleton matching the inputs `verify_rrsig` takes in `lib/src/lib.rs`, with
// the ECDSA check delegated to Noir's std-lib ECDSA-secp256r1 verifier.
// std::ecdsa_secp256r1::verify_signature already exists in the Noir stdlib —
// this circuit just needs to feed it the same canonicalized message that
// `construct_rrset_message_with_sig` builds today, hashed the same way.

use std::ecdsa_secp256r1;
use std::hash::sha256;

fn main(
    pub_key_x: [u8; 32],
    pub_key_y: [u8; 32],
    signature: [u8; 64],
    // Pre-hashed, pre-canonicalized RRset message (built off-circuit using
    // the unchanged `construct_rrset_message_with_sig` from `lib/`, then
    // SHA-256'd, since hashing arbitrary-length DNS wire-format bytes inside
    // the circuit would need a variable-length hash gadget).
    message_hash: [u8; 32],
) -> pub bool {
    ecdsa_secp256r1::verify_signature(pub_key_x, pub_key_y, signature, message_hash)
}

// Smoke test: a circuit that always rejects an all-zero signature/key/hash
// should at least compile and execute without panicking. This is not a
// cryptographic correctness test (that needs a real P256 test vector) — it
// only proves the circuit's wiring/types are sound, same purpose as every
// other smoke test in this repo. Real-vector tests should replace this once
// the off-circuit message-hash pipeline is wired up.
#[test]
fn smoke_circuit_executes_on_zeroed_inputs() {
    let pub_key_x: [u8; 32] = [0; 32];
    let pub_key_y: [u8; 32] = [0; 32];
    let signature: [u8; 64] = [0; 64];
    let message_hash: [u8; 32] = [0; 32];

    let result = main(pub_key_x, pub_key_y, signature, message_hash);
    // A zeroed signature must never verify as valid.
    assert(result == false);
}
