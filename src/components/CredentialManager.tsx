import React from 'react';

/**
 * Credential management panel.
 * Lists active, revoked, and expired DomainCredentials for the connected wallet.
 * Populated in M3 tasks.
 */
export function CredentialManager() {
  return (
    <div style={{ padding: '1.5rem 0' }}>
      <h2 style={{ color: '#e2e8f0', fontSize: '1.1rem', marginBottom: '1rem' }}>
        My Credentials
      </h2>
      <p style={{ color: '#718096', fontSize: '0.875rem' }}>
        Credential list — coming in M3.
      </p>
    </div>
  );
}
