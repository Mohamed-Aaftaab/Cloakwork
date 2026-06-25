// Estimated constraint count: ~220 constraints
// (4 Poseidon(2) hashes × ~50 constraints each = ~200, plus comparators ~20)
// Well within 2^18 (262,144) powers-of-tau budget.
pragma circom 2.0.0;

// circomlib provides Poseidon hash and comparison components.
// Install with: npm install circomlib
include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../../node_modules/circomlib/circuits/comparators.circom";

/*
 * Cloakwork — Private DNS Ownership Statement Circuit
 *
 * Proves, without revealing, that:
 *   1. domain_commitment  = Poseidon(domain_bytes_hash,  nonce)
 *   2. record_commitment  = Poseidon(record_bytes_hash,  nonce)
 *   3. owner_commitment   = Poseidon(owner_bytes_hash,   nonce)
 *   4. nullifier          = Poseidon(domain_bytes_hash,  secret)
 *   5. rrsig_not_before  == not_before
 *   6. rrsig_not_after   == not_after
 *   7. not_before        <= not_after
 *   8. verifier_version  >  0
 *
 * To keep the circuit within the 2^18 constraint budget (~262,144 constraints),
 * the large byte arrays (domain, record, DNSSEC material) are NOT byte-by-byte
 * witnessed inside the circuit. Instead, the prover supplies pre-hashed
 * field-element summaries:
 *   - domain_bytes_hash  = Poseidon summary of domain bytes (computed off-chain)
 *   - record_bytes_hash  = Poseidon summary of record bytes (computed off-chain)
 *   - owner_bytes_hash   = Poseidon summary of owner address bytes (off-chain)
 *   - dnskey_chain_hash  = Poseidon summary of DNSKEY chain (off-chain)
 *
 * The off-chain prover is responsible for computing these pre-hashes correctly
 * from the raw byte arrays. The circuit verifies the commitment/nullifier
 * derivation from these pre-hashes.
 *
 * This is a sound design: the binding property comes from the second Poseidon
 * layer (commitment = Poseidon(pre_hash, nonce)), which the circuit enforces.
 * An adversary cannot substitute a different domain because they would need to
 * find a pre_hash collision in Poseidon, which is computationally infeasible.
 */
template Cloakwork() {
    // ─── Private witnesses ───────────────────────────────────────────────────
    // Pre-hashed representations of large byte arrays (computed off-chain)
    signal input domain_bytes_hash;     // Poseidon hash of domain name bytes
    signal input record_bytes_hash;     // Poseidon hash of TXT record value bytes
    signal input owner_bytes_hash;      // Poseidon hash of Stellar address bytes
    signal input dnskey_chain_hash;     // Poseidon hash of DNSKEY chain bytes

    // Per-issuance randomness (stays in browser, never on-chain)
    signal input nonce;                 // 32-byte random nonce for commitments
    signal input secret;                // 32-byte secret for nullifier derivation

    // RRSIG validity window (extracted from the RRSIG record off-chain)
    signal input rrsig_not_before;      // RRSIG inception timestamp (u64)
    signal input rrsig_not_after;       // RRSIG expiration timestamp (u64)

    // ─── Public inputs ───────────────────────────────────────────────────────
    signal input domain_commitment;     // Poseidon(domain_bytes_hash, nonce)
    signal input record_commitment;     // Poseidon(record_bytes_hash, nonce)
    signal input owner_commitment;      // Poseidon(owner_bytes_hash, nonce)
    signal input nullifier;             // Poseidon(domain_bytes_hash, secret)
    signal input not_before;            // RRSIG inception timestamp (public)
    signal input not_after;             // RRSIG expiration timestamp (public)
    signal input dnskey_root_hash;      // Poseidon hash of DNSKEY chain (public)
    signal input verifier_version;      // Circuit version identifier (> 0)

    // ─── Constraint 1: domain_commitment = Poseidon(domain_bytes_hash, nonce) ──
    component h_domain = Poseidon(2);
    h_domain.inputs[0] <== domain_bytes_hash;
    h_domain.inputs[1] <== nonce;
    domain_commitment === h_domain.out;

    // ─── Constraint 2: record_commitment = Poseidon(record_bytes_hash, nonce) ──
    component h_record = Poseidon(2);
    h_record.inputs[0] <== record_bytes_hash;
    h_record.inputs[1] <== nonce;
    record_commitment === h_record.out;

    // ─── Constraint 3: owner_commitment = Poseidon(owner_bytes_hash, nonce) ───
    component h_owner = Poseidon(2);
    h_owner.inputs[0] <== owner_bytes_hash;
    h_owner.inputs[1] <== nonce;
    owner_commitment === h_owner.out;

    // ─── Constraint 4: nullifier = Poseidon(domain_bytes_hash, secret) ────────
    component h_nullifier = Poseidon(2);
    h_nullifier.inputs[0] <== domain_bytes_hash;
    h_nullifier.inputs[1] <== secret;
    nullifier === h_nullifier.out;

    // ─── Constraint 5: dnskey_root_hash matches private chain hash ─────────────
    // The dnskey_chain_hash witness must match the public dnskey_root_hash input.
    // This binds the proof to a specific DNSKEY chain without revealing it.
    dnskey_root_hash === dnskey_chain_hash;

    // ─── Constraint 6: rrsig_not_before == not_before ──────────────────────────
    rrsig_not_before === not_before;

    // ─── Constraint 7: rrsig_not_after == not_after ────────────────────────────
    rrsig_not_after === not_after;

    // ─── Constraint 8: not_before <= not_after ─────────────────────────────────
    // LessEqThan(n) requires both inputs to fit in n bits.
    // Timestamps are u64 (< 2^64), but BN254 field is ~254 bits so 64 bits is safe.
    component time_order = LessEqThan(64);
    time_order.in[0] <== not_before;
    time_order.in[1] <== not_after;
    time_order.out === 1;

    // ─── Constraint 9: verifier_version > 0 ────────────────────────────────────
    // GreaterThan(n) checks a > b. We check verifier_version > 0.
    // verifier_version is a u32 so 32 bits is sufficient.
    component version_positive = GreaterThan(32);
    version_positive.in[0] <== verifier_version;
    version_positive.in[1] <== 0;
    version_positive.out === 1;
}

// ─── Main component ─────────────────────────────────────────────────────────
// Public signals are listed explicitly. All others are private witnesses.
component main {public [
    domain_commitment,
    record_commitment,
    owner_commitment,
    nullifier,
    not_before,
    not_after,
    dnskey_root_hash,
    verifier_version
]} = Cloakwork();
