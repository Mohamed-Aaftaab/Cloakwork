import React from 'react';
import { useCloakworkProof } from '../hooks/useCloakworkProof';
import { useStellarWallet } from '../hooks/useStellarWallet';
import { DNSChallengeGuide } from './DNSChallengeGuide';
import { DNSSECCheck } from './DNSSECCheck';
import { ProofGenerator } from './ProofGenerator';
import { VerificationPanel } from './VerificationPanel';
import { PrivacyPanel } from './PrivacyPanel';

/**
 * Main proof generation workspace — full 4-step flow:
 * 1. Generate DNS challenge
 * 2. Verify DNSSEC record
 * 3. Generate ZK proof (Web Worker)
 * 4. Submit to Soroban and receive credential
 */
export function ProofWorkspace() {
  const proof = useCloakworkProof();
  const wallet = useStellarWallet();

  return (
    <div style={{ padding: '1.5rem 0', maxWidth: '680px' }}>
      <div style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ color: '#e2e8f0', fontSize: '1.25rem', margin: 0 }}>
          Create Private Domain Proof
        </h2>
        <p style={{ color: '#718096', fontSize: '0.875rem', marginTop: '0.5rem' }}>
          Prove you control a real DNS domain — without revealing the domain publicly.
        </p>
      </div>

      <PrivacyPanel />
      <DNSChallengeGuide proof={proof} />
      <DNSSECCheck proof={proof} />
      <ProofGenerator proof={proof} onSubmitClick={proof.generateProof} />
      <VerificationPanel
        proof={proof}
        walletAddress={wallet.address ?? ''}
      />
    </div>
  );
}
