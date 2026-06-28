# Cloakwork — Testnet Deployment Guide

All three Soroban contracts must be deployed and initialized in order.
No contract IDs, RPC URLs, or secret keys are hardcoded — everything is
read from environment variables.

---

## Prerequisites

- Rust + `wasm32-unknown-unknown` target
- Stellar CLI ≥ 22.0.0 (`stellar --version`)
- A funded Stellar testnet account (`stellar keys generate --network testnet deployer`)

---

## Step 0 — Set environment variables

```bash
export STELLAR_SECRET_KEY="S..."              # Deployer secret key
export STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
export STELLAR_RPC_URL="https://soroban-testnet.stellar.org"
export STELLAR_HORIZON_URL="https://horizon-testnet.stellar.org"
export STELLAR_NETWORK="testnet"
```

---

## Step 1 — Build all contracts

```bash
stellar contract build
# Optimised Wasm files appear in:
#   target/wasm32-unknown-unknown/release/cloakwork_verifier.wasm
#   target/wasm32-unknown-unknown/release/cloakwork_registry.wasm
#   target/wasm32-unknown-unknown/release/gated_action_demo.wasm
```

---

## Step 2 — Deploy and initialize the Verifier

```bash
VERIFIER_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/cloakwork_verifier.wasm \
  --source-account $STELLAR_SECRET_KEY \
  --network testnet)
echo "Verifier: $VERIFIER_ID"

stellar contract invoke \
  --id $VERIFIER_ID \
  --source-account $STELLAR_SECRET_KEY \
  --network testnet \
  -- initialize \
  --admin $(stellar keys address deployer --network testnet)
```

### Register the Groth16 verifying key (after running trusted setup)

```bash
# After running scripts/setup.sh, register version 1
stellar contract invoke \
  --id $VERIFIER_ID \
  --source-account $STELLAR_SECRET_KEY \
  --network testnet \
  -- register_key \
  --version 1 \
  --vk "$(cat proofs/circom/build/vk_soroban.json)"
```

---

## Step 3 — Deploy and initialize the Registry

```bash
REGISTRY_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/cloakwork_registry.wasm \
  --source-account $STELLAR_SECRET_KEY \
  --network testnet)
echo "Registry: $REGISTRY_ID"

stellar contract invoke \
  --id $REGISTRY_ID \
  --source-account $STELLAR_SECRET_KEY \
  --network testnet \
  -- initialize \
  --admin $(stellar keys address deployer --network testnet) \
  --verifier_contract $VERIFIER_ID
```

---

## Step 4 — Deploy and initialize the GatedAction Demo

```bash
GATED_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/gated_action_demo.wasm \
  --source-account $STELLAR_SECRET_KEY \
  --network testnet)
echo "GatedAction: $GATED_ID"

stellar contract invoke \
  --id $GATED_ID \
  --source-account $STELLAR_SECRET_KEY \
  --network testnet \
  -- initialize \
  --registry $REGISTRY_ID
```

---

## Step 5 — Write contract IDs to `.env`

```bash
cat >> .env <<EOF
REACT_APP_CLOAKWORK_VERIFIER_CONTRACT_ID=$VERIFIER_ID
REACT_APP_CLOAKWORK_REGISTRY_CONTRACT_ID=$REGISTRY_ID
REACT_APP_GATED_ACTION_CONTRACT_ID=$GATED_ID
EOF
```

---

## TTL Maintenance

Soroban persistent storage entries expire. Renew Wasm TTLs monthly:

```bash
stellar contract extend --id $VERIFIER_ID  --durability persistent --ledgers-to-extend 535679 --network testnet
stellar contract extend --id $REGISTRY_ID  --durability persistent --ledgers-to-extend 535679 --network testnet
stellar contract extend --id $GATED_ID     --durability persistent --ledgers-to-extend 535679 --network testnet
```

Data entry TTLs (credentials, verifying keys, nullifier set) are automatically
extended on every read/write inside the contracts.

TTL values used:
- Threshold: **100,000 ledgers** (~5.8 days at 5 s/ledger)
- Target: **535,680 ledgers** (~30 days at 5 s/ledger)

---

## Deployed contract IDs (Stellar testnet)

| Contract | ID |
|---|---|
| `cloakwork_verifier` | `CAWS5HXLKELNROV2G23IWS4QY5DU5NSNLPD7WN4NAZKTN53D55IYTN6E` |
| `cloakwork_registry` | `CBIACVGBZHTQLUGFEL52GUI6B4FYE7TVR2GOV4G6UO45X6FSFGO6IYB3` |
| `gated_action_demo` | `CCJ3EVUUWQINTVKRTD6LSBL7IKMUYAHIJ4X3SATV2MKRLVS67J6KUQFP` |

View on [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet):
- [Verifier](https://stellar.expert/explorer/testnet/contract/CAWS5HXLKELNROV2G23IWS4QY5DU5NSNLPD7WN4NAZKTN53D55IYTN6E)
- [Registry](https://stellar.expert/explorer/testnet/contract/CBIACVGBZHTQLUGFEL52GUI6B4FYE7TVR2GOV4G6UO45X6FSFGO6IYB3)
- [GatedAction](https://stellar.expert/explorer/testnet/contract/CCJ3EVUUWQINTVKRTD6LSBL7IKMUYAHIJ4X3SATV2MKRLVS67J6KUQFP)
