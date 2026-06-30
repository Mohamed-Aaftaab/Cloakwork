import React from 'react';
import { useCloakworkProof } from '../hooks/useCloakworkProof';
import { StellarWalletState } from '../hooks/useStellarWallet';
import { DNSChallengeGuide } from './DNSChallengeGuide';
import { DNSSECCheck } from './DNSSECCheck';
import { ProofGenerator } from './ProofGenerator';
import { VerificationPanel } from './VerificationPanel';
import { PrivacyPanel } from './PrivacyPanel';

interface Props {
  wallet: StellarWalletState;
}

export function ProofWorkspace({ wallet }: Props) {
  const proof = useCloakworkProof();

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
      <DNSChallengeGuide proof={proof} walletAddress={wallet.address ?? ''} />
      <DNSSECCheck proof={proof} />
      <ProofGenerator proof={proof} onSubmitClick={proof.generateProof} />
      <VerificationPanel
        proof={proof}
        walletAddress={wallet.address ?? ''}
        signTransaction={wallet.signTransaction}
      />
    </div>
  );
}
