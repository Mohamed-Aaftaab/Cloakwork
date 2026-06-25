/**
 * Type declarations for circomlibjs — the JavaScript companion to circomlib.
 * Provides Poseidon hash, Pedersen hash, and other circuit primitives.
 */
declare module 'circomlibjs' {
  interface PoseidonInstance {
    (inputs: bigint[]): Uint8Array;
    F: {
      toObject(element: Uint8Array): bigint;
    };
  }

  export function buildPoseidon(): Promise<PoseidonInstance>;
  export function buildEddsa(): Promise<unknown>;
  export function buildBabyjub(): Promise<unknown>;
  export function buildMimc7(): Promise<unknown>;
  export function buildMimcSponge(): Promise<unknown>;
}
