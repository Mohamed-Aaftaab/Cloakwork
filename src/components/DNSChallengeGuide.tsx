import React, { useState } from 'react';
import { useCloakworkProof } from '../hooks/useCloakworkProof';

interface Props {
  proof: ReturnType<typeof useCloakworkProof>;
  walletAddress: string;
}

/**
 * Step 1 of the proof flow.
 * User enters a domain — the app generates nonce/secret locally,
 * derives Poseidon commitments, and displays the TXT record to publish.
 * The domain name and nonce/secret never leave the browser.
 */
export function DNSChallengeGuide({ proof, walletAddress }: Props) {
  const [domain, setDomain] = useState('');
  const [domainError, setDomainError] = useState<string | null>(null);

  function validateDomain(d: string): boolean {
    const re = /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.[a-zA-Z]{2,})+$/;
    return re.test(d);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateDomain(domain)) {
      setDomainError('Enter a valid domain name (e.g. acme.com)');
      return;
    }
    setDomainError(null);
    await proof.generateChallenge(domain, walletAddress);
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  const isGenerated = proof.status !== 'idle';

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ color: '#e2e8f0', fontSize: '1rem', marginBottom: '0.75rem' }}>
        Step 1 — Generate DNS Challenge
      </h3>

      {!isGenerated && (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '420px' }}>
          <label style={{ color: '#a0aec0', fontSize: '0.85rem' }}>
            Domain name
          </label>
          <input
            type="text"
            value={domain}
            onChange={e => setDomain(e.target.value)}
            placeholder="acme.com"
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: domainError ? '1px solid #fc8181' : '1px solid #4a5568',
              background: '#1a202c',
              color: '#e2e8f0',
              fontSize: '0.9rem',
            }}
          />
          {domainError && <span style={{ color: '#fc8181', fontSize: '0.8rem' }}>{domainError}</span>}
          <p style={{ margin: 0, color: '#718096', fontSize: '0.78rem' }}>
            Your domain name is only used locally to compute commitments — it never touches the blockchain.
          </p>
          <button
            type="submit"
            style={{
              padding: '8px 18px', fontSize: '0.875rem',
              border: '1px solid #667eea', borderRadius: '6px',
              background: '#667eea22', color: '#667eea',
              cursor: 'pointer', fontWeight: 600, alignSelf: 'flex-start',
            }}
          >
            Generate Challenge
          </button>
        </form>
      )}

      {isGenerated && proof.txtRecordName && proof.txtRecordValue && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '600px' }}>
          <p style={{ margin: 0, color: '#68d391', fontSize: '0.875rem' }}>
            ✓ Challenge generated. Add this TXT record to your DNS provider:
          </p>

          <div style={{ background: '#1a202c', border: '1px solid #2d3748', borderRadius: '8px', padding: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ color: '#718096', fontSize: '0.75rem' }}>Record Name</span>
              <button onClick={() => copyToClipboard(proof.txtRecordName!)}
                style={{ fontSize: '0.7rem', padding: '2px 8px', border: '1px solid #4a5568', borderRadius: '4px', background: 'transparent', color: '#a0aec0', cursor: 'pointer' }}>
                Copy
              </button>
            </div>
            <code style={{ color: '#90cdf4', fontSize: '0.8rem', wordBreak: 'break-all' }}>
              {proof.txtRecordName}
            </code>
          </div>

          <div style={{ background: '#1a202c', border: '1px solid #2d3748', borderRadius: '8px', padding: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ color: '#718096', fontSize: '0.75rem' }}>Record Value</span>
              <button onClick={() => copyToClipboard(proof.txtRecordValue!)}
                style={{ fontSize: '0.7rem', padding: '2px 8px', border: '1px solid #4a5568', borderRadius: '4px', background: 'transparent', color: '#a0aec0', cursor: 'pointer' }}>
                Copy
              </button>
            </div>
            <code style={{ color: '#90cdf4', fontSize: '0.75rem', wordBreak: 'break-all' }}>
              {proof.txtRecordValue}
            </code>
          </div>

          <button
            onClick={proof.reset}
            style={{ fontSize: '0.75rem', padding: '4px 10px', border: '1px solid #4a5568', borderRadius: '4px', background: 'transparent', color: '#718096', cursor: 'pointer', alignSelf: 'flex-start' }}
          >
            Start over
          </button>
        </div>
      )}
    </div>
  );
}
