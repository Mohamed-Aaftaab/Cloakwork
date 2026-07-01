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
        <div className="cw-section-kicker">DNSSEC → ZK PROOF → STELLAR</div>
        <h2 style={{
          color: 'var(--color-ash)',
          fontSize: 'clamp(24px, 3vw, 36px)',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          margin: '8px 0 0',
          lineHeight: 1.1,
        }}>
          Create Private Domain Proof
        </h2>
        <p style={{ color: 'rgba(247,249,250,0.6)', fontSize: '0.9rem', marginTop: '0.5rem', marginBottom: 0 }}>
          Prove you control a real DNS domain — without revealing the domain publicly.
        </p>
      </div>

      <PrivacyPanel />
      <DNSChallengeGuide proof={proof} walletAddress={wallet.address ?? ''} />
      <DNSSECCheck proof={proof} />
      <ProofGenerator proof={proof} />
      <VerificationPanel
        proof={proof}
        walletAddress={wallet.address ?? ''}
        signTransaction={wallet.signTransaction}
      />
    </div>
  );
}
