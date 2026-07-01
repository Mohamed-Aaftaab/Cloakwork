import React, { useState } from 'react';

/**
 * "What is public vs private" informational panel.
 * Lists on-chain data vs data that never leaves the browser.
 * Required by requirements 12.6 and 23.6.
 */
export function PrivacyPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ marginBottom: '1.5rem', border: '1px solid #2d3748', borderRadius: '10px', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.06)', border: 'none', cursor: 'pointer',
          color: '#a0aec0', fontSize: '0.875rem', fontWeight: 600,
        }}
      >
        <span>🔒 What is public vs private?</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '1rem', background: '#090909', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <div style={{ color: '#fc8181', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              On-chain (visible to all)
            </div>
            {[
              'domain_commitment  (Poseidon hash)',
              'record_commitment  (Poseidon hash)',
              'owner_commitment   (Poseidon hash)',
              'nullifier           (Poseidon hash)',
              'not_before  (RRSIG inception timestamp)',
              'not_after   (RRSIG expiry timestamp)',
              'verifier_version   (circuit version)',
              'Groth16 proof bytes (256 bytes)',
            ].map(item => (
              <div key={item} style={{ color: '#a0aec0', fontSize: '0.78rem', marginBottom: '0.25rem', display: 'flex', gap: '0.4rem' }}>
                <span style={{ color: 'rgba(247,249,250,0.28)' }}>•</span>{item}
              </div>
            ))}
          </div>

          <div>
            <div style={{ color: '#68d391', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Never leaves your browser
            </div>
            {[
              'Domain name string',
              'DNS TXT record value',
              'DNSSEC RRset bytes',
              'RRSIG bytes',
              'DNSKEY chain bytes',
              'nonce  (32 random bytes)',
              'secret  (32 random bytes)',
            ].map(item => (
              <div key={item} style={{ color: '#a0aec0', fontSize: '0.78rem', marginBottom: '0.25rem', display: 'flex', gap: '0.4rem' }}>
                <span style={{ color: 'rgba(247,249,250,0.28)' }}>•</span>{item}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
