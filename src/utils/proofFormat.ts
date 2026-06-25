/**
 * Proof serialization utilities for Soroban contract submission.
 *
 * Converts snarkjs Groth16 proof output into the byte formats
 * expected by the cloakwork_verifier Soroban contract.
 *
 * PRIVACY NOTE: These functions only operate on the proof bytes and
 * public signals — never on the private witnesses (domain, DNSSEC,
 * nonce, secret). Those never leave the browser.
 */

/**
 * Encode a snarkjs Groth16 proof into 256 bytes for Soroban submission.
 *
 * Layout: pi_a (G1, 64 bytes) ‖ pi_b (G2, 128 bytes) ‖ pi_c (G1, 64 bytes)
 *
 * @param proof - Groth16 proof object from snarkjs
 * @returns 256-byte Uint8Array containing the serialized proof
 */
export function encodeProofForSoroban(proof: {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}): Uint8Array {
  const buf = new Uint8Array(256);

  // Encode G1 point (64 bytes): x (32 bytes) + y (32 bytes)
  function encodeG1(point: string[], offset: number): void {
    const x = hexTo32Bytes(point[0]);
    const y = hexTo32Bytes(point[1]);
    buf.set(x, offset);
    buf.set(y, offset + 32);
  }

  // Encode G2 point (128 bytes): x0 (32) + x1 (32) + y0 (32) + y1 (32)
  function encodeG2(point: string[][], offset: number): void {
    const x0 = hexTo32Bytes(point[0][0]);
    const x1 = hexTo32Bytes(point[0][1]);
    const y0 = hexTo32Bytes(point[1][0]);
    const y1 = hexTo32Bytes(point[1][1]);
    buf.set(x0, offset);
    buf.set(x1, offset + 32);
    buf.set(y0, offset + 64);
    buf.set(y1, offset + 96);
  }

  encodeG1(proof.pi_a, 0);   // bytes 0..64
  encodeG2(proof.pi_b, 64);  // bytes 64..192
  encodeG1(proof.pi_c, 192); // bytes 192..256

  return buf;
}

/**
 * Encode public signals as an array of 32-byte field elements.
 *
 * @param publicSignals - Array of decimal string field elements from snarkjs
 * @returns Array of 32-byte Uint8Arrays, one per public signal
 */
export function encodePublicInputs(publicSignals: string[]): Uint8Array[] {
  return publicSignals.map((sig) => {
    const bigIntVal = BigInt(sig);
    return bigIntTo32Bytes(bigIntVal);
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function hexTo32Bytes(hexOrDecimal: string): Uint8Array {
  let hex: string;
  if (hexOrDecimal.startsWith('0x') || hexOrDecimal.startsWith('0X')) {
    hex = hexOrDecimal.slice(2).padStart(64, '0');
  } else {
    // Decimal string
    const n = BigInt(hexOrDecimal);
    hex = n.toString(16).padStart(64, '0');
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bigIntTo32Bytes(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
