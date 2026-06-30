import React, { useState } from 'react';
import {
  Contract,
  Networks,
  rpc as StellarRpc,
  TransactionBuilder,
  xdr,
  nativeToScVal,
  scValToNative,
} from '@stellar/stellar-sdk';
import { useCloakworkProof } from '../hooks/useCloakworkProof';
import { CredentialCard, CredentialData } from './CredentialCard';
import { config } from '../config';
import { encodeProofForSoroban, encodePublicInputs } from '../utils/proofFormat';

interface Props {
  proof: ReturnType<typeof useCloakworkProof>;
  walletAddress: string;
  signTransaction: (xdr: string) => Promise<string>;
  onProofSubmitted?: (txHash: string) => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  NullifierAlreadyUsed:    'Duplicate credential — this domain proof has already been used.',
  ProofVerificationFailed: 'Proof verification failed — the ZK proof was rejected by the verifier.',
  ProofWindowExpired:      'Proof window expired — please regenerate the DNS proof.',
  ProofWindowNotYetActive: 'Proof window not yet active — wait a moment and retry.',
  VersionNotActive:        'Verifier version not active — contact support.',
};

function mapError(raw: string): string {
  for (const [key, msg] of Object.entries(ERROR_MESSAGES)) {
    if (raw.includes(key)) return msg;
  }
  if (raw.includes('cancel') || raw.includes('reject') || raw.includes('User declined')) {
    return 'Transaction cancelled by user.';
  }
  return raw;
}

const EXPLORER = 'https://stellar.expert/explorer/testnet';

/**
 * Step 4 — Submit the ZK proof to the cloakwork_registry Soroban contract
 * and display the issued DomainCredential.
 *
 * Uses @stellar/stellar-sdk to build and submit a real Soroban transaction.
 * No mocks, no bypasses — private data never leaves the browser.
 */
export function VerificationPanel({ proof, walletAddress, signTransaction, onProofSubmitted }: Props) {
  const [txHash, setTxHash] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [credential, setCredential] = useState<CredentialData | null>(null);

  if (!['proof_ready', 'submitting', 'submit_error', 'credential_issued'].includes(proof.status)) {
    return null;
  }

  async function handleSubmit() {
    if (!proof.proof || !proof.publicSignals) {
      setSubmitError('Proof not ready. Please generate the ZK proof first.');
      return;
    }
    if (!walletAddress || walletAddress.length < 10) {
      setSubmitError('Wallet not connected. Please connect your Stellar wallet first.');
      return;
    }

    const registryId = config.registryContractId;
    if (!registryId) {
      setSubmitError('Registry contract ID not configured. Set REACT_APP_CLOAKWORK_REGISTRY_CONTRACT_ID in .env');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const server = new StellarRpc.Server(config.rpcUrl);
      const account = await server.getAccount(walletAddress);

      // Encode the Groth16 proof as 256 bytes
      const proofBytes = encodeProofForSoroban(proof.proof);
      const proofScVal = xdr.ScVal.scvBytes(Buffer.from(proofBytes));

      // Encode the 8 public signals as BytesN<32> each — used in the PublicInputs struct below
      const publicInputArrays = encodePublicInputs(proof.publicSignals);

      // Build PublicInputs struct — keys MUST be alphabetically sorted for Soroban
      const publicInputsStruct = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('dnskey_root_hash'),
          val: xdr.ScVal.scvBytes(Buffer.from(publicInputArrays[6])),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('domain_commitment'),
          val: xdr.ScVal.scvBytes(Buffer.from(publicInputArrays[0])),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('not_after'),
          val: xdr.ScVal.scvU64(xdr.Uint64.fromString(proof.publicSignals[5])),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('not_before'),
          val: xdr.ScVal.scvU64(xdr.Uint64.fromString(proof.publicSignals[4])),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('nullifier'),
          val: xdr.ScVal.scvBytes(Buffer.from(publicInputArrays[3])),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('owner_commitment'),
          val: xdr.ScVal.scvBytes(Buffer.from(publicInputArrays[2])),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('record_commitment'),
          val: xdr.ScVal.scvBytes(Buffer.from(publicInputArrays[1])),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('verifier_version'),
          val: xdr.ScVal.scvU32(Number(proof.publicSignals[7] ?? 1)),
        }),
      ]);

      const contract = new Contract(registryId);

      // Build the transaction calling verify_and_issue(owner, public_inputs, proof)
      const tx = new TransactionBuilder(account, {
        fee: '1000000',
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          contract.call(
            'verify_and_issue',
            nativeToScVal(walletAddress, { type: 'address' }),
            publicInputsStruct,
            proofScVal
          )
        )
        .setTimeout(60)
        .build();

      // Simulate to get resource footprint
      const simResult = await server.simulateTransaction(tx);
      if (StellarRpc.Api.isSimulationError(simResult)) {
        throw new Error(`Simulation failed: ${simResult.error}`);
      }

      // Assemble the transaction with simulation data
      const preparedTx = StellarRpc.assembleTransaction(tx, simResult).build();
      const preparedXdr = preparedTx.toXDR();

      // Sign with the wallet from the parent component
      const signedXdr = await signTransaction(preparedXdr);

      // Submit to the Stellar testnet
      const submitResult = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET)
      );

      if (submitResult.status === 'ERROR') {
        throw new Error(`Transaction rejected: ${JSON.stringify(submitResult.errorResult)}`);
      }

      const hash = submitResult.hash;
      setTxHash(hash);

      // Poll for confirmation — 20 attempts × 3s = 60s max
      let getResult = await server.getTransaction(hash);
      let attempts = 0;
      while (getResult.status === StellarRpc.Api.GetTransactionStatus.NOT_FOUND && attempts < 20) {
        await new Promise(r => setTimeout(r, 3000));
        getResult = await server.getTransaction(hash);
        attempts++;
      }

      if (getResult.status === StellarRpc.Api.GetTransactionStatus.NOT_FOUND) {
        throw new Error(`Transaction not confirmed after 60s. It may still process. Check: ${EXPLORER}/tx/${hash}`);
      }

      if (getResult.status === StellarRpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`Transaction failed on-chain. Check: ${EXPLORER}/tx/${hash}`);
      }

      // Parse the DomainCredential from the return value
      const now = Math.floor(Date.now() / 1000);
      // Derive expiry fallback from not_after public signal (index 5)
      const notAfterFallback = Number(proof.publicSignals[5] ?? now + 2_592_000);
      const expiryFallback = Math.min(notAfterFallback, now + 2_592_000);

      // Convert public signal decimal strings to hex for consistent display
      function decimalToHex(dec: string): string {
        const n = BigInt(dec);
        return n.toString(16).padStart(64, '0');
      }

      let issuedCredential: CredentialData = {
        commitment: decimalToHex(proof.publicSignals[0] ?? '0'),
        nullifier: decimalToHex(proof.publicSignals[3] ?? '0'),
        issuedAt: now,
        expiresAt: expiryFallback,
        verifierVersion: Number(proof.publicSignals[7] ?? 1),
        status: 'Active',
        owner: walletAddress,
        registryContractId: registryId,
        txHash: hash,
      };

      // Try to extract credential fields from the return value if available
      if (getResult.status === StellarRpc.Api.GetTransactionStatus.SUCCESS && getResult.returnValue) {
        try {
          const native = scValToNative(getResult.returnValue);
          if (native && typeof native === 'object') {
            issuedCredential = {
              ...issuedCredential,
              issuedAt: Number(native.issued_at ?? now),
              expiresAt: Number(native.expires_at ?? now + 2_592_000),
            };
          }
        } catch {
          // Use defaults if parsing fails
        }
      }

      setCredential(issuedCredential);
      onProofSubmitted?.(hash);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Submission failed';
      setSubmitError(mapError(msg));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ color: '#e2e8f0', fontSize: '1rem', marginBottom: '0.75rem' }}>
        Step 4 — Verify on Stellar
      </h3>

      {submitError && (
        <div role="alert" style={{
          color: '#fc8181', fontSize: '0.875rem', marginBottom: '0.75rem',
          padding: '0.75rem', background: '#fc818111', border: '1px solid #fc818133', borderRadius: '6px',
        }}>
          {submitError}
        </div>
      )}

      {isSubmitting && (
        <div style={{ color: '#718096', fontSize: '0.875rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>⏳ Submitting to Soroban…</span>
          {txHash && (
            <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
               style={{ color: '#90cdf4', fontSize: '0.8rem', textDecoration: 'none' }}>
              View transaction ↗
            </a>
          )}
        </div>
      )}

      {!credential && !isSubmitting && proof.status === 'proof_ready' && (
        <button
          onClick={handleSubmit}
          style={{
            padding: '10px 22px', fontSize: '0.9rem',
            border: '1px solid #68d391', borderRadius: '8px',
            background: '#68d39122', color: '#68d391',
            cursor: 'pointer', fontWeight: 700,
          }}
        >
          Submit to Soroban
        </button>
      )}

      {credential && (
        <div>
          <p style={{ color: '#68d391', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
            ✓ Credential issued on Stellar testnet
          </p>
          <CredentialCard credential={credential} networkExplorerBase={EXPLORER} />
        </div>
      )}
    </div>
  );
}

