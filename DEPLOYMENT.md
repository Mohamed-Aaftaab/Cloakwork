# Cloakwork — Testnet Deployment Guide

All three Soroban contracts must be deployed and initialized in order.
No contract IDs, RPC URLs, or secret keys are hardcoded — everything is
read from environment variables or the Stellar CLI keystore.

---

## Prerequisites

- Rust stable ≥ 1.91 + `wasm32v1-none` target (`rustup target add wasm32v1-none`)
- Stellar CLI ≥ 27.0.0 (`stellar --version`)
- A funded Stellar testnet account (`stellar keys generate deployer --network testnet`)
- Fund it: `stellar keys fund deployer --network testnet`

---

## Step 0 — Set up Stellar CLI

```bash
# Verify CLI version
stellar --version

# Confirm deployer key exists
stellar keys address deployer
```

---

## Step 1 — Build all contracts

```bash
stellar contract build
# Optimised Wasm files appear in:
#   target/wasm32v1-none/release/cloakwork_verifier.wasm
#   target/wasm32v1-none/release/cloakwork_registry.wasm
#   target/wasm32v1-none/release/gated_action_demo.wasm
```

---

## Step 2 — Deploy and initialize the Verifier

```bash
VERIFIER_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/cloakwork_verifier.wasm \
  --source deployer \
  --network testnet)
echo "Verifier: $VERIFIER_ID"

stellar contract invoke \
  --id $VERIFIER_ID \
  --source deployer \
  --network testnet \
  -- initialize \
  --admin $(stellar keys address deployer)
```

### Register the Groth16 verifying key

```bash
# Uses scripts/register_key.js with the correct G2 Fp2 encoding (c1||c0)
STELLAR_SECRET_KEY=$(stellar keys show deployer) \
  CLOAKWORK_VERIFIER_ID=$VERIFIER_ID \
  node scripts/register_key.js
```

---

## Step 3 — Deploy and initialize the Registry

```bash
REGISTRY_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/cloakwork_registry.wasm \
  --source deployer \
  --network testnet)
echo "Registry: $REGISTRY_ID"

stellar contract invoke \
  --id $REGISTRY_ID \
  --source deployer \
  --network testnet \
  -- initialize \
  --admin $(stellar keys address deployer) \
  --verifier_contract $VERIFIER_ID
```

---

## Step 4 — Deploy and initialize the GatedAction Demo

```bash
GATED_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/gated_action_demo.wasm \
  --source deployer \
  --network testnet)
echo "GatedAction: $GATED_ID"

stellar contract invoke \
  --id $GATED_ID \
  --source deployer \
  --network testnet \
  -- initialize \
  --registry $REGISTRY_ID
```

---

## Step 5 — Write contract IDs to `.env`

```bash
cat > .env << EOF
REACT_APP_STELLAR_NETWORK=testnet
REACT_APP_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
REACT_APP_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
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

## Currently deployed contract IDs (Stellar testnet — Protocol 27)

| Contract | ID |
|---|---|
| `cloakwork_verifier` | `CAYOV2FM3LEAKY7UKYGOLK5JTHKXJ4DT2RWTKDPP2LBS5VMLKIQFWNI5` |
| `cloakwork_registry` | `CATC4JJXRAV3SSJACS6IPSOUMIFC7EEJNDP47QSNNIZUTKEDM2VCWSV5` |
| `gated_action_demo`  | `CAAUNLRCKYQGC3N3EL2MCXVJU2QHBAPRTMS2H7ZHAN5WJ4HA2UX4E23G` |

View on [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet):
- [Verifier](https://stellar.expert/explorer/testnet/contract/CAYOV2FM3LEAKY7UKYGOLK5JTHKXJ4DT2RWTKDPP2LBS5VMLKIQFWNI5)
- [Registry](https://stellar.expert/explorer/testnet/contract/CATC4JJXRAV3SSJACS6IPSOUMIFC7EEJNDP47QSNNIZUTKEDM2VCWSV5)
- [GatedAction](https://stellar.expert/explorer/testnet/contract/CAAUNLRCKYQGC3N3EL2MCXVJU2QHBAPRTMS2H7ZHAN5WJ4HA2UX4E23G)
