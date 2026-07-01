/**
 * Poseidon commitment and nullifier derivation utilities.
 *
 * Uses circomlibjs for Poseidon hashing — the same hash function used
 * in the Circom circuit and natively supported by Stellar Protocol 25.
 *
 * ALL computation is local — no data leaves the browser.
 */

type PoseidonFn = (inputs: bigint[]) => bigint;

let _poseidon: PoseidonFn | null = null;

async function getPoseidon(): Promise<PoseidonFn> {
  if (_poseidon) return _poseidon;
  const { buildPoseidon } = await import('circomlibjs');
  const poseidon = await buildPoseidon();
  _poseidon = (inputs: bigint[]) => poseidon.F.toObject(poseidon(inputs)) as bigint;
  return _poseidon;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

function bigIntToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Compute `Poseidon(preimage, nonce)` — binds a private value to a nonce.
 *
 * Used for: domain_commitment, record_commitment, owner_commitment
 *
 * @param preimage - Raw bytes of the private value (domain name, TXT record, address)
 * @param nonce - 32-byte random nonce (stays in browser)
 * @returns 32-byte commitment suitable for on-chain submission
 */
export async function deriveCommitment(
  preimage: Uint8Array,
  nonce: Uint8Array
): Promise<Uint8Array> {
  const poseidon = await getPoseidon();
  const preimageInt = bytesToBigInt(preimage);
  const nonceInt = bytesToBigInt(nonce);
  const result = poseidon([preimageInt, nonceInt]);
  return bigIntToBytes32(result);
}

/**
 * Format a TXT record value in the Cloakwork challenge format.
 *
 * Format: `clkwk:v1:<owner_commitment_hex>:<nonce_commitment_hex>`
 *
 * @param ownerCommitment - 32-byte owner commitment
 * @param nonceCommitment - 32-byte nonce commitment
 * @returns TXT record value string
 */
export function formatTxtRecord(
  ownerCommitment: Uint8Array,
  nonceCommitment: Uint8Array
): string {
  const toHex = (b: Uint8Array) =>
    Array.from(b)
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
  return `clkwk:v1:${toHex(ownerCommitment)}:${toHex(nonceCommitment)}`;
}
