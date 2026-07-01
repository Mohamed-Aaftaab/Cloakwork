import React from 'react';

export interface CredentialData {
  commitment: string;
  nullifier: string;
  issuedAt: number;
  expiresAt: number;
  verifierVersion: number;
  status: 'Active' | 'Revoked' | 'Expired';
  owner: string;
  registryContractId?: string;
  txHash?: string;
}

interface Props {
  credential: CredentialData;
  onRevoke?: () => void;
  onRenew?: () => void;
  networkExplorerBase?: string;
}

function statusBadge(status: CredentialData['status']) {
  const map = {
    Active:  { color: '#68d391', bg: '#68d39122', label: 'Active' },
    Revoked: { color: '#fc8181', bg: '#fc818122', label: 'Revoked' },
    Expired: { color: '#f6ad55', bg: '#f6ad5522', label: 'Expired' },
  };
  const { color, bg, label } = map[status];
  return (
    <span style={{ padding: '2px 10px', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 700, color, background: bg, border: `1px solid ${color}44` }}>
      {label}
    </span>
  );
}

function truncate(s: string, head = 8, tail = 8) {
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function formatTs(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

/**
 * Displays an issued DomainCredential with lifecycle action buttons.
 * Never shows the domain name or TXT record value.
 * Requirements: 17.1–17.8
 */
export function CredentialCard({ credential, onRevoke, onRenew, networkExplorerBase }: Props) {
  const explorerBase = networkExplorerBase ?? 'https://stellar.expert/explorer/testnet';

  return (
    <div style={{ border: '1px solid #2d3748', borderRadius: '12px', overflow: 'hidden', maxWidth: '600px' }}>
      <div style={{ background: '#1a202c', padding: '0.875rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '0.9rem' }}>Domain Credential</span>
        {statusBadge(credential.status)}
      </div>

      <div style={{ padding: '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', background: '#0f0f1a' }}>
        {([
          ['Owner', truncate(credential.owner)],
          // commitment = Poseidon(domain_bytes) — hides domain while proving ownership
          ['Domain commitment', truncate(credential.commitment, 12, 12)],
          // nullifier = unique one-time tag — prevents double-issuance
          ['Nullifier', truncate(credential.nullifier, 12, 12)],
          ['Issued', formatTs(credential.issuedAt)],
          ['Expires', formatTs(credential.expiresAt)],
          ['Circuit version', `v${credential.verifierVersion}`],
          credential.registryContractId ? ['Registry contract', truncate(credential.registryContractId, 8, 8)] : null,
        ] as ([string, string] | null)[]).filter((x): x is [string, string] => x !== null).map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
            <span style={{ color: '#718096' }}>{label}</span>
            <span style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{value}</span>
          </div>
        ))}

        {credential.txHash && (
          <a
            href={`${explorerBase}/tx/${credential.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#90cdf4', fontSize: '0.78rem', textDecoration: 'none', marginTop: '0.25rem' }}
          >
            View on Stellar Explorer ↗
          </a>
        )}

        {/* Commitment legend — clarifies privacy-preserving fields */}
        <p style={{ color: '#4a5568', fontSize: '0.7rem', margin: '0.5rem 0 0', lineHeight: 1.5 }}>
          Domain commitment = Poseidon(domain bytes) — proves ownership without revealing the domain.
          Nullifier = unique one-time tag — prevents double-issuance of the same credential.
        </p>
      </div>

      {(credential.status === 'Active' || credential.status === 'Expired') && (onRevoke || onRenew) && (
        <div style={{ background: '#1a202c', padding: '0.75rem 1rem', display: 'flex', gap: '0.5rem' }}>
          {onRevoke && credential.status === 'Active' && (
            <button
              onClick={onRevoke}
              style={{ padding: '5px 12px', fontSize: '0.78rem', border: '1px solid #fc8181', borderRadius: '5px', background: 'transparent', color: '#fc8181', cursor: 'pointer' }}
            >
              Revoke
            </button>
          )}
          {onRenew && (
            <button
              onClick={onRenew}
              style={{ padding: '5px 12px', fontSize: '0.78rem', border: '1px solid #667eea', borderRadius: '5px', background: 'transparent', color: '#667eea', cursor: 'pointer' }}
            >
              Renew
            </button>
          )}
        </div>
      )}
    </div>
  );
}
