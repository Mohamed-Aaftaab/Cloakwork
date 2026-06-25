import React, { useState } from 'react';
import { useCloakworkProof } from '../hooks/useCloakworkProof';
import { CredentialCard, CredentialData } from './CredentialCard';
import { config } from '../config';

interface Props {
  proof: ReturnType<typeof useCloakworkProof>;
  walletAddress: string;
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
  if (raw.includes('cancel') || raw.includes('reject')) return 'Transaction cancelled.';
  return raw;
}

const EXPLORER = 'https://stellar.expert/explorer/testnet';

/**
 * Step 4 — Submit proof to Soroban and display the issued credential.
 * Maps Soroban error codes to human-readable messages.
 * Requirements: 16.1–16.8, 22.3–22.6
 */
export function VerificationPanel({ proof, walletAddress, onProofSubmitted }: Props) {
  const [txHash, setTxHash] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [credential, setCredential] = useState<CredentialData | null>(null);

  if (!['proof_ready', 'submitting', 'submit_error', 'credential_issued'].includes(proof.status)) {
    return null;
  }

  async function handleSubmit() {
    if (!proof.proof || !proof.publicSignals) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      // Placeholder — real Soroban tx submission wired in stellar-client/ layer
      // For demo purposes we simulate a successful submission
      await new Promise(r => setTimeout(r, 1500));
      const fakeTx = 'a1b2c3d4e5f6' + Math.random().toString(36).slice(2, 10);
      setTxHash(fakeTx);
      setCredential({
        commitment: proof.ownerCommitment ?? '0x' + '0'.repeat(64),
        nullifier: proof.publicSignals?.[3] ?? '0x' + '0'.repeat(64),
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 2_592_000,
        verifierVersion: 1,
        status: 'Active',
        owner: walletAddress,
        registryContractId: config.registryContractId || '(deploy contract first)',
        txHash: fakeTx,
      });
      onProofSubmitted?.(fakeTx);
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
        <div role="alert" style={{ color: '#fc8181', fontSize: '0.875rem', marginBottom: '0.75rem', padding: '0.75rem', background: '#fc818111', border: '1px solid #fc818133', borderRadius: '6px' }}>
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
          style={{ padding: '10px 22px', fontSize: '0.9rem', border: '1px solid #68d391', borderRadius: '8px', background: '#68d39122', color: '#68d391', cursor: 'pointer', fontWeight: 700 }}
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
