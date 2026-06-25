import React from 'react';
import { useCloakworkProof } from '../hooks/useCloakworkProof';

interface Props {
  proof: ReturnType<typeof useCloakworkProof>;
}

/**
 * Step 2 — Check that the DNSSEC-signed TXT record is visible.
 * Calls Cloudflare DoH and validates the authenticated answer.
 * Only enabled after challenge has been generated.
 */
export function DNSSECCheck({ proof }: Props) {
  const canCheck = proof.status === 'challenge_generated' || proof.status === 'dnssec_error';
  const isChecking = proof.status === 'dnssec_checking';
  const isFound = ['dnssec_found', 'proving', 'proof_error', 'proof_ready', 'submitting', 'submit_error', 'credential_issued'].includes(proof.status);
  const isError = proof.status === 'dnssec_error';

  if (proof.status === 'idle') return null;

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ color: '#e2e8f0', fontSize: '1rem', marginBottom: '0.75rem' }}>
        Step 2 — Verify DNSSEC Record
      </h3>

      {isFound && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <span style={{ color: '#68d391', fontSize: '0.875rem' }}>✓ DNSSEC material found</span>
          {proof.dnssecMaterial && (
            <span style={{ color: '#718096', fontSize: '0.75rem' }}>
              (valid {new Date(proof.dnssecMaterial.notBefore * 1000).toLocaleDateString()} – {new Date(proof.dnssecMaterial.notAfter * 1000).toLocaleDateString()})
            </span>
          )}
        </div>
      )}

      {isError && proof.error && (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ color: '#fc8181', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
            ✗ {proof.error}
          </div>
          {proof.error.includes('not found') && (
            <p style={{ color: '#718096', fontSize: '0.8rem', margin: 0 }}>
              Make sure the TXT record from Step 1 is published at your DNS provider. DNS changes can take up to 10 minutes to propagate.
            </p>
          )}
          {proof.error.includes('DNSSEC') && (
            <p style={{ color: '#718096', fontSize: '0.8rem', margin: 0 }}>
              Your domain zone is not DNSSEC-signed. Enable DNSSEC at your registrar before continuing.
            </p>
          )}
          {proof.error.includes('expired') && (
            <p style={{ color: '#718096', fontSize: '0.8rem', margin: 0 }}>
              The DNSSEC RRSIG signature has expired. Wait for DNS TTL to expire and republish the record.
            </p>
          )}
        </div>
      )}

      {(canCheck || isError) && (
        <button
          onClick={proof.checkDNSSEC}
          disabled={isChecking}
          style={{
            padding: '8px 18px', fontSize: '0.875rem',
            border: '1px solid #667eea', borderRadius: '6px',
            background: '#667eea22', color: '#667eea',
            cursor: isChecking ? 'not-allowed' : 'pointer',
            fontWeight: 600, opacity: isChecking ? 0.6 : 1,
          }}
        >
          {isChecking ? 'Checking…' : isError ? 'Retry DNSSEC Check' : 'Check DNSSEC Record'}
        </button>
      )}

      {isChecking && (
        <p style={{ color: '#718096', fontSize: '0.8rem', marginTop: '0.5rem' }}>
          Querying Cloudflare DoH for _stellar-cloakwork.{proof.domain}…
        </p>
      )}
    </div>
  );
}
