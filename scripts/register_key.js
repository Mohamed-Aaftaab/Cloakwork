#!/usr/bin/env node
/**
 * Register the Groth16 verifying key with the deployed cloakwork_verifier contract.
 *
 * Usage:
 *   STELLAR_SECRET_KEY=S... node scripts/register_key.js
 */

const {
  Keypair,
  Contract,
  Networks,
  rpc: StellarRpc,
  TransactionBuilder,
  xdr,
} = require('@stellar/stellar-sdk');

const VK = require('../proofs/circom/build/verification_key.json');

const VERIFIER_ID = process.env.CLOAKWORK_VERIFIER_ID || 'CAYOV2FM3LEAKY7UKYGOLK5JTHKXJ4DT2RWTKDPP2LBS5VMLKIQFWNI5';
const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const SECRET_KEY = process.env.STELLAR_SECRET_KEY;

if (!SECRET_KEY) {
  console.error('ERROR: Set STELLAR_SECRET_KEY environment variable');
  process.exit(1);
}

// Convert a decimal string field element to 32-byte big-endian buffer
function fieldToBytes32(decStr) {
  const n = BigInt(decStr);
  const hex = n.toString(16).padStart(64, '0');
  return Buffer.from(hex, 'hex');
}

// G1 point: [x, y, "1"] -> 64 bytes (x: 32 + y: 32)
function g1ToBytes(point) {
  const x = fieldToBytes32(point[0]);
  const y = fieldToBytes32(point[1]);
  return Buffer.concat([x, y]); // 64 bytes
}

// G2 point: [[x0, x1], [y0, y1], ["1","0"]] -> 128 bytes
function g2ToBytes(point) {
  const x0 = fieldToBytes32(point[0][0]);
  const x1 = fieldToBytes32(point[0][1]);
  const y0 = fieldToBytes32(point[1][0]);
  const y1 = fieldToBytes32(point[1][1]);
  return Buffer.concat([x0, x1, y0, y1]); // 128 bytes
}

async function main() {
  const keypair = Keypair.fromSecret(SECRET_KEY);
  const server = new StellarRpc.Server(RPC_URL);
  const account = await server.getAccount(keypair.publicKey());

  // Encode the verifying key as the VerifyingKeyData struct
  const alpha_g1 = xdr.ScVal.scvBytes(g1ToBytes(VK.vk_alpha_1));
  const beta_g2  = xdr.ScVal.scvBytes(g2ToBytes(VK.vk_beta_2));
  const gamma_g2 = xdr.ScVal.scvBytes(g2ToBytes(VK.vk_gamma_2));
  const delta_g2 = xdr.ScVal.scvBytes(g2ToBytes(VK.vk_delta_2));

  // gamma_abc_g1: concatenated IC points (each 64 bytes)
  const gamma_abc_bytes = Buffer.concat(VK.IC.map(g1ToBytes));
  const gamma_abc = xdr.ScVal.scvBytes(gamma_abc_bytes);

  // VerifyingKeyData struct — keys must be alphabetically sorted
  const vk_struct = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('alpha_g1'), val: alpha_g1 }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('beta_g2'),  val: beta_g2  }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('delta_g2'), val: delta_g2 }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('gamma_abc_g1'), val: gamma_abc }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('gamma_g2'), val: gamma_g2 }),
  ]);

  const contract = new Contract(VERIFIER_ID);
  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('register_key', xdr.ScVal.scvU32(1), vk_struct))
    .setTimeout(60)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (StellarRpc.Api.isSimulationError(simResult)) {
    console.error('Simulation failed:', simResult.error);
    process.exit(1);
  }

  const preparedTx = StellarRpc.assembleTransaction(tx, simResult).build();
  preparedTx.sign(keypair);

  const result = await server.sendTransaction(preparedTx);
  console.log('Transaction submitted:', result.hash);
  console.log('Status:', result.status);

  // Poll for result
  let getResult = await server.getTransaction(result.hash);
  let attempts = 0;
  while (getResult.status === StellarRpc.Api.GetTransactionStatus.NOT_FOUND && attempts < 20) {
    await new Promise(r => setTimeout(r, 3000));
    getResult = await server.getTransaction(result.hash);
    attempts++;
  }

  console.log('Final status:', getResult.status);
  if (getResult.status === StellarRpc.Api.GetTransactionStatus.SUCCESS) {
    console.log('✓ Verifying key registered successfully for version 1');
  } else {
    console.error('✗ Failed:', JSON.stringify(getResult));
  }
}

main().catch(console.error);

