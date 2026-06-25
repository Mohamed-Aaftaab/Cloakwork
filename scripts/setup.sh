#!/usr/bin/env bash
# Cloakwork — Groth16 Trusted Setup
#
# Runs the full snarkjs powers-of-tau ceremony and produces:
#   proofs/circom/build/pot18_final.ptau       (phase 1 — circuit-independent)
#   proofs/circom/build/cloakwork_final.zkey   (phase 2 — circuit-specific)
#   proofs/circom/build/verification_key.json  (verifying key for on-chain deployment)
#
# Prerequisites:
#   - circom installed (npm install -g circom or cargo install circom)
#   - snarkjs installed (npm install -g snarkjs)
#   - node_modules installed (npm install in repo root)
#
# Usage: bash scripts/setup.sh

set -euo pipefail

CIRCOM_DIR="proofs/circom"
BUILD_DIR="$CIRCOM_DIR/build"
mkdir -p "$BUILD_DIR"

echo "=== Step 1: Compile Circom circuit ==="
circom "$CIRCOM_DIR/cloakwork.circom" \
  --r1cs --wasm --sym \
  --O2 \
  -o "$BUILD_DIR"
echo "  ✓ Generated: $BUILD_DIR/cloakwork.r1cs"
echo "  ✓ Generated: $BUILD_DIR/cloakwork_js/cloakwork.wasm"

echo ""
echo "=== Step 2: Powers of tau (phase 1) ==="
# 2^18 = 262,144 constraint capacity — sufficient for Cloakwork circuit
snarkjs powersoftau new bn128 18 "$BUILD_DIR/pot18_0000.ptau" -v
snarkjs powersoftau contribute "$BUILD_DIR/pot18_0000.ptau" "$BUILD_DIR/pot18_0001.ptau" \
  --name="Cloakwork phase 1 contribution" -e="$(date +%s%N)cloakwork_entropy"
snarkjs powersoftau beacon "$BUILD_DIR/pot18_0001.ptau" "$BUILD_DIR/pot18_beacon.ptau" \
  0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10 -n="Final beacon"
snarkjs powersoftau prepare phase2 "$BUILD_DIR/pot18_beacon.ptau" "$BUILD_DIR/pot18_final.ptau" -v
echo "  ✓ Powers of tau complete: $BUILD_DIR/pot18_final.ptau"

echo ""
echo "=== Step 3: Groth16 setup (phase 2) ==="
snarkjs groth16 setup "$BUILD_DIR/cloakwork.r1cs" "$BUILD_DIR/pot18_final.ptau" \
  "$BUILD_DIR/cloakwork_0000.zkey"
snarkjs zkey contribute "$BUILD_DIR/cloakwork_0000.zkey" "$BUILD_DIR/cloakwork_final.zkey" \
  --name="Cloakwork final contribution" -e="$(date +%s%N)cloakwork_zkey_entropy"
echo "  ✓ Proving key: $BUILD_DIR/cloakwork_final.zkey"

echo ""
echo "=== Step 4: Export verification key ==="
snarkjs zkey export verificationkey \
  "$BUILD_DIR/cloakwork_final.zkey" \
  "$BUILD_DIR/verification_key.json"
echo "  ✓ Verifying key: $BUILD_DIR/verification_key.json"

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Deploy contracts: bash scripts/deploy.sh"
echo "  2. Register verifying key in Verifier contract using stellar contract invoke"
echo "  3. Generate a proof: node proofs/circom/scripts/prove.js --witness proofs/circom/input.example.json"
