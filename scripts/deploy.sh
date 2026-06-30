#!/usr/bin/env bash
# Cloakwork — Deploy all three contracts to Stellar testnet
# Usage: bash scripts/deploy.sh
#
# Required environment variables:
#   STELLAR_SECRET_KEY         Deployer secret key (S...)
#   STELLAR_RPC_URL            Soroban RPC endpoint
#   STELLAR_NETWORK_PASSPHRASE Network passphrase
#
# Writes deployed contract IDs to .env

set -euo pipefail

: "${STELLAR_SECRET_KEY:?STELLAR_SECRET_KEY must be set}"
: "${STELLAR_RPC_URL:?STELLAR_RPC_URL must be set}"
: "${STELLAR_NETWORK_PASSPHRASE:?STELLAR_NETWORK_PASSPHRASE must be set}"

NETWORK="${STELLAR_NETWORK:-testnet}"
ADMIN_ADDRESS=$(stellar keys address deployer --network "$NETWORK" 2>/dev/null || \
  stellar keys address "$STELLAR_SECRET_KEY" --network "$NETWORK")

echo "Building contracts..."
stellar contract build

WASM_DIR="target/wasm32v1-none/release"

echo ""
echo "Deploying cloakwork_verifier..."
VERIFIER_ID=$(stellar contract deploy \
  --wasm "$WASM_DIR/cloakwork_verifier.wasm" \
  --source deployer \
  --network "$NETWORK")
echo "  Verifier: $VERIFIER_ID"

stellar contract invoke \
  --id "$VERIFIER_ID" \
  --source deployer \
  --network "$NETWORK" \
  -- initialize \
  --admin "$ADMIN_ADDRESS"
echo "  Verifier initialized."

echo ""
echo "Deploying cloakwork_registry..."
REGISTRY_ID=$(stellar contract deploy \
  --wasm "$WASM_DIR/cloakwork_registry.wasm" \
  --source deployer \
  --network "$NETWORK")
echo "  Registry: $REGISTRY_ID"

stellar contract invoke \
  --id "$REGISTRY_ID" \
  --source deployer \
  --network "$NETWORK" \
  -- initialize \
  --admin "$ADMIN_ADDRESS" \
  --verifier_contract "$VERIFIER_ID"
echo "  Registry initialized."

echo ""
echo "Deploying gated_action_demo..."
GATED_ID=$(stellar contract deploy \
  --wasm "$WASM_DIR/gated_action_demo.wasm" \
  --source deployer \
  --network "$NETWORK")
echo "  GatedAction: $GATED_ID"

stellar contract invoke \
  --id "$GATED_ID" \
  --source deployer \
  --network "$NETWORK" \
  -- initialize \
  --registry "$REGISTRY_ID"
echo "  GatedAction initialized."

echo ""
echo "Writing contract IDs to .env..."
{
  echo "REACT_APP_CLOAKWORK_VERIFIER_CONTRACT_ID=$VERIFIER_ID"
  echo "REACT_APP_CLOAKWORK_REGISTRY_CONTRACT_ID=$REGISTRY_ID"
  echo "REACT_APP_GATED_ACTION_CONTRACT_ID=$GATED_ID"
} >> .env

echo ""
echo "All contracts deployed:"
echo "  Verifier : $VERIFIER_ID"
echo "  Registry : $REGISTRY_ID"
echo "  GatedAction: $GATED_ID"
echo ""
echo "View on Stellar Expert: https://stellar.expert/explorer/$NETWORK"
