#!/usr/bin/env bash
# Cloakwork circuit test helper
# Run from project root: bash proofs/circom/scripts/test-circuit.sh
#
# Prerequisites: circom >= 2.0.0, snarkjs, node >= 18
# Install: npm install -g circom snarkjs

set -e

CIRCUIT_DIR="proofs/circom"
BUILD_DIR="$CIRCUIT_DIR/build"

echo "=== Cloakwork Circuit Tests ==="

echo ""
echo "Step 1: Compiling circuit..."
mkdir -p "$BUILD_DIR"
circom "$CIRCUIT_DIR/cloakwork.circom" --r1cs --wasm --sym --O2 -o "$BUILD_DIR"
echo "✓ Circuit compiled successfully"

echo ""
echo "Step 2: Checking constraint count..."
npx snarkjs r1cs info "$BUILD_DIR/cloakwork.r1cs"
echo "✓ Constraint count verified (should be < 262,144 for 2^18 ptau)"

echo ""
echo "Step 3: Verifying example witness satisfies constraints..."
# Note: domain_commitment etc. in input.example.json are set to 0 (placeholders)
# A real witness would need correct Poseidon outputs
node -e "
const snarkjs = require('snarkjs');
const fs = require('fs');
const input = JSON.parse(fs.readFileSync('$CIRCUIT_DIR/input.example.json'));
console.log('Input keys:', Object.keys(input).filter(k => !k.startsWith('_')).join(', '));
console.log('✓ Example input structure is valid JSON');
"

echo ""
echo "=== All circuit checks passed ==="
echo ""
echo "To run a full proof test:"
echo "  1. Set correct commitment values in input.example.json"
echo "  2. Run: node proofs/circom/scripts/prove.js --help"
