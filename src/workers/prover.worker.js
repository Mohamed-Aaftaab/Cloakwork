/* eslint-disable no-restricted-globals */
/**
 * Cloakwork proof generation Web Worker.
 *
 * Receives challenge data and DNSSEC material from the main thread, builds
 * the snarkjs witness inputs, runs `groth16.fullProve`, then posts back ONLY
 * the proof and public signals — no private witnesses are ever returned.
 *
 * Loading snarkjs inside the worker via dynamic `import()` keeps it out of
 * the main bundle and avoids blocking the UI thread during the heavy WASM
 * initialisation and proof computation.
 */

/**
 * Convert a number[] (serialised Uint8Array) to a BigInt.
 * @param {number[]} bytes
 * @returns {bigint}
 */
function bytesToBigInt(bytes) {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

/**
 * Build the snarkjs witness input object from the payload sent by the main thread.
 *
 * The circuit expects:
 *   Private: domain_bytes_hash, record_bytes_hash, dnskey_chain_hash,
 *            nonce, secret, rrsig_not_before, rrsig_not_after
 *   Public:  domain_commitment, record_commitment, owner_commitment,
 *            nullifier, not_before, not_after, dnskey_root_hash, verifier_version
 *
 * @param {{ challenge: object, dnssecMaterial: object }} payload
 * @returns {Record<string, string>}
 */
function buildWitnessInputs(payload) {
  const { challenge, dnssecMaterial } = payload;

  const domainBytes = new TextEncoder().encode(challenge.domain);
  const nonce = new Uint8Array(challenge.nonce);
  const secret = new Uint8Array(challenge.secret);
  const rrset = new Uint8Array(dnssecMaterial.rrset);
  const rrsig = new Uint8Array(dnssecMaterial.rrsig);
  const dnskey = new Uint8Array(dnssecMaterial.dnskey);

  const domainBigInt = bytesToBigInt(domainBytes);
  const nonceBigInt = bytesToBigInt(nonce);
  const secretBigInt = bytesToBigInt(secret);
  const rrsetBigInt = bytesToBigInt(rrset);
  const rrsigBigInt = bytesToBigInt(rrsig);
  const dnskeyBigInt = bytesToBigInt(dnskey);

  return {
    // Private witnesses
    domain_bytes_hash: domainBigInt.toString(),
    record_bytes_hash: rrsetBigInt.toString(),
    rrsig_bytes_hash: rrsigBigInt.toString(),
    dnskey_chain_hash: dnskeyBigInt.toString(),
    nonce: nonceBigInt.toString(),
    secret: secretBigInt.toString(),
    rrsig_not_before: dnssecMaterial.notBefore.toString(),
    rrsig_not_after: dnssecMaterial.notAfter.toString(),
    // Public inputs — will be verified against circuit constraints
    domain_commitment: challenge.ownerCommitment || '0',
    record_commitment: rrsetBigInt.toString(),
    owner_commitment: challenge.ownerCommitment || '0',
    nullifier: secretBigInt.toString(),
    not_before: dnssecMaterial.notBefore.toString(),
    not_after: dnssecMaterial.notAfter.toString(),
    dnskey_root_hash: dnskeyBigInt.toString(),
    verifier_version: '1',
  };
}

self.onmessage = async function (event) {
  const payload = event.data;

  try {
    // Dynamic import to avoid including snarkjs in the main bundle.
    // snarkjs is a large WASM-backed library — loading it here keeps the
    // UI thread unblocked during initialisation and proof generation.
    const snarkjs = await import('snarkjs');

    // Circuit artifacts served from the /public/circuits/ directory.
    // These must be generated via `scripts/setup.sh` and placed there.
    const wasmPath = '/circuits/cloakwork_js/cloakwork.wasm';
    const zkeyPath = '/circuits/cloakwork_final.zkey';

    const inputs = buildWitnessInputs(payload);

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      inputs,
      wasmPath,
      zkeyPath
    );

    // Post ONLY the proof and public signals — no private witness data.
    // The nonce, secret, domain bytes, and DNSSEC bytes are discarded here.
    self.postMessage({ proof, publicSignals });
  } catch (err) {
    self.postMessage({
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
