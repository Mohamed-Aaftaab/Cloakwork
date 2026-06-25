#!/usr/bin/env node
/**
 * Cloakwork — Off-chain Groth16 prover CLI
 *
 * Generates a Groth16 proof from a witness JSON file.
 *
 * Usage:
 *   node prove.js \
 *     --witness input.json \
 *     --wasm    build/cloakwork_js/cloakwork.wasm \
 *     --zkey    build/cloakwork_final.zkey \
 *     --out     build/proof.json
 *
 * Or via environment variables:
 *   CLOAKWORK_WASM=... CLOAKWORK_ZKEY=... node prove.js --witness input.json
 *
 * Output JSON: { proof: { pi_a, pi_b, pi_c, protocol }, publicInputs: [...] }
 */

const snarkjs = require('snarkjs');
const fs = require('fs');
const path = require('path');

// ── Argument parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag, envKey, defaultVal) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  if (envKey && process.env[envKey]) return process.env[envKey];
  if (defaultVal !== undefined) return defaultVal;
  return null;
}

const witnessFile = getArg('--witness', null, null);
const wasmFile    = getArg('--wasm',    'CLOAKWORK_WASM', path.join(__dirname, '../build/cloakwork_js/cloakwork.wasm'));
const zkeyFile    = getArg('--zkey',    'CLOAKWORK_ZKEY', path.join(__dirname, '../build/cloakwork_final.zkey'));
const outFile     = getArg('--out',     'CLOAKWORK_OUT',  path.join(__dirname, '../build/proof.json'));

if (!witnessFile) {
  console.error('Usage: node prove.js --witness <input.json> [--wasm <path>] [--zkey <path>] [--out <path>]');
  console.error('');
  console.error('See input.example.json for the expected witness format.');
  process.exit(1);
}

if (!fs.existsSync(witnessFile)) {
  console.error(`ERROR: Witness file not found: ${witnessFile}`);
  process.exit(1);
}

if (!fs.existsSync(wasmFile)) {
  console.error(`ERROR: WASM file not found: ${wasmFile}`);
  console.error('Run the trusted setup first: bash scripts/setup.sh');
  process.exit(1);
}

if (!fs.existsSync(zkeyFile)) {
  console.error(`ERROR: zkey file not found: ${zkeyFile}`);
  console.error('Run the trusted setup first: bash scripts/setup.sh');
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Reading witness from: ${witnessFile}`);
  const input = JSON.parse(fs.readFileSync(witnessFile, 'utf8'));

  console.log('Generating Groth16 proof...');
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmFile,
    zkeyFile
  );

  const output = { proof, publicInputs: publicSignals };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));

  console.log(`Proof written to: ${outFile}`);
  console.log(`Public inputs (${publicSignals.length}):`);
  publicSignals.forEach((s, i) => console.log(`  [${i}] ${s}`));
  console.log('');
  console.log('Done. Submit to Soroban via the frontend or stellar contract invoke.');
}

main().catch(err => {
  console.error('Proof generation failed:', err.message ?? err);
  process.exit(1);
});
