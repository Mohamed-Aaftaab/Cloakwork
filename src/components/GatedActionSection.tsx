import React from 'react';
import { GatedActionDemo } from './GatedActionDemo';
import { useStellarWallet } from '../hooks/useStellarWallet';

/**
 * Gated action section — wraps the GatedActionDemo component.
 * Rendered in the "Gated Action" tab when wallet is connected.
 */
export function GatedActionSection() {
  const wallet = useStellarWallet();
  // In a full integration, credentials would be loaded from the Registry.
  // For the demo, we pass an empty array — the GatedActionDemo handles the empty state.
  return (
    <div style={{ padding: '1.5rem 0' }}>
      <GatedActionDemo
        credentials={[]}
        walletAddress={wallet.address ?? ''}
      />
      {/* Show info when no credentials yet */}
      <div style={{ marginTop: '1rem', padding: '1rem', background: '#1a202c', borderRadius: '8px', border: '1px solid #2d3748' }}>
        <p style={{ color: '#718096', fontSize: '0.875rem', margin: 0 }}>
          Complete the proof flow in the "Create Proof" tab to issue a credential,
          then return here to use it.
        </p>
      </div>
    </div>
  );
}
