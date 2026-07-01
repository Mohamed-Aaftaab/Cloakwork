/* eslint-disable no-restricted-globals */
/* global BigInt */
/**
 * Cloakwork proof generation Web Worker.
 *
 * Builds witness inputs using circomlibjs Poseidon so all constraints
 * are satisfied, then calls snarkjs.groth16.fullProve.
 * Posts back ONLY proof + publicSignals — no private data returned.
 */

function bytesToBigInt(bytes) {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

async function buildWitnessInputs(payload) {
  const { buildPoseidon } = await import('circomlibjs');
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  const { challenge, dnssecMaterial } = payload;

  const domainBytes = new TextEncoder().encode(challenge.domain);
  const nonce   = new Uint8Array(challenge.nonce);
  const secret  = new Uint8Array(challenge.secret);
  const rrset   = new Uint8Array(dnssecMaterial.rrset);
  const dnskey  = new Uint8Array(dnssecMaterial.dnskey);
  // rrsig is validated on the frontend (timestamp window) but the circuit does not consume it
  // Use the actual wallet address bytes for owner_bytes_hash
  const ownerBytes  = new TextEncoder().encode(challenge.walletAddress);

  // Convert bytes to field elements — circomlibjs Poseidon automatically
  // reduces inputs modulo the BN254 scalar field order r (~254 bits), so inputs
  // larger than r (e.g. a long rrset JSON string → big BigInt) are handled correctly.
  // The pre-reduction value is used as the private witness signal; the circuit
  // constraint checks Poseidon(record_bytes_hash, nonce) == record_commitment,
  // and snarkjs performs the field reduction when building the witness.
  const domainBigInt = bytesToBigInt(domainBytes);
  const nonceBigInt  = bytesToBigInt(nonce);
  const secretBigInt = bytesToBigInt(secret);
  const rrsetBigInt  = bytesToBigInt(rrset);
  const dnskeyBigInt = bytesToBigInt(dnskey);
  const ownerBigInt  = bytesToBigInt(ownerBytes);

  // Compute public outputs using Poseidon — must exactly satisfy circuit constraints:
  //   domain_commitment = Poseidon(domain_bytes_hash, nonce)
  //   record_commitment = Poseidon(record_bytes_hash, nonce)
  //   owner_commitment  = Poseidon(owner_bytes_hash, nonce)
  //   nullifier         = Poseidon(domain_bytes_hash, secret)
  //   dnskey_root_hash  = dnskey_chain_hash  (direct equality, not Poseidon)
  const domainCommitment = F.toObject(poseidon([domainBigInt, nonceBigInt]));
  const recordCommitment = F.toObject(poseidon([rrsetBigInt,  nonceBigInt]));
  const ownerCommitment  = F.toObject(poseidon([ownerBigInt,  nonceBigInt]));
  const nullifier        = F.toObject(poseidon([domainBigInt, secretBigInt]));
  // dnskey_root_hash must equal dnskey_chain_hash exactly (circuit constraint 5)
  const dnskeyRootHash   = dnskeyBigInt;

  return {
    // Private witnesses (exact signal names from cloakwork.circom)
    domain_bytes_hash: domainBigInt.toString(),
    record_bytes_hash: rrsetBigInt.toString(),
    owner_bytes_hash:  ownerBigInt.toString(),
    dnskey_chain_hash: dnskeyBigInt.toString(),
    nonce:             nonceBigInt.toString(),
    secret:            secretBigInt.toString(),
    rrsig_not_before:  dnssecMaterial.notBefore.toString(),
    rrsig_not_after:   dnssecMaterial.notAfter.toString(),
    // Public inputs — Poseidon-computed to satisfy constraints
    domain_commitment: domainCommitment.toString(),
    record_commitment: recordCommitment.toString(),
    owner_commitment:  ownerCommitment.toString(),
    nullifier:         nullifier.toString(),
    not_before:        dnssecMaterial.notBefore.toString(),
    not_after:         dnssecMaterial.notAfter.toString(),
    dnskey_root_hash:  dnskeyRootHash.toString(),
    // Read version from payload — defaults to 1 if not provided
    verifier_version:  String(challenge.verifierVersion ?? 1),
  };
}

self.onmessage = async function (event) {
  const payload = event.data;
  try {
    const snarkjs = await import('snarkjs');
    const inputs  = await buildWitnessInputs(payload);

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      inputs,
      '/circuits/cloakwork_js/cloakwork.wasm',
      '/circuits/cloakwork_final.zkey'
    );

    // Return only proof + public signals — private witnesses discarded here
    self.postMessage({ proof, publicSignals });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
