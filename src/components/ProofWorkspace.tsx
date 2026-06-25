import React from 'react';

/**
 * Main proof generation workspace.
 * Contains DNS challenge guide, DNSSEC check, proof generator,
 * verification panel, and credential card.
 * Populated in M3 tasks.
 */
export function ProofWorkspace() {
  return (
    <div style={{ padding: '1.5rem 0' }}>
      <h2 style={{ color: '#e2e8f0', fontSize: '1.1rem', marginBottom: '1rem' }}>
        Proof Workspace
      </h2>
      <p style={{ color: '#718096', fontSize: '0.875rem' }}>
        Step-by-step domain proof flow — coming in M3.
      </p>
    </div>
  );
}
