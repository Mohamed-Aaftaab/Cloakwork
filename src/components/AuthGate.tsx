import React from 'react';

interface AuthGateProps {
  /** Whether the wallet is currently connected */
  isConnected: boolean;
  /** Called when the user clicks the connect prompt inside a gated section */
  onConnectClick: () => void;
  /** The protected content to render when connected */
  children: React.ReactNode;
  /** Label describing what requires connection, e.g. "Proof Generation" */
  sectionLabel: string;
}

/**
 * Wraps a protected section and renders children only when the wallet is connected.
 * When disconnected, renders a connection-required message instead.
 * Clicking the message opens the wallet connection modal.
 */
export function AuthGate({ isConnected, onConnectClick, children, sectionLabel }: AuthGateProps) {
  if (isConnected) {
    return <>{children}</>;
  }

  return (
    <div
      role="region"
      aria-label={`${sectionLabel} — wallet connection required`}
      style={{
        padding: '2rem',
        textAlign: 'center',
        border: '1px dashed #4a5568',
        borderRadius: '8px',
        color: '#718096',
      }}
    >
      <p style={{ margin: '0 0 1rem' }}>
        Connect your wallet to access <strong style={{ color: '#a0aec0' }}>{sectionLabel}</strong>.
      </p>
      <button
        onClick={onConnectClick}
        style={{
          padding: '8px 18px',
          fontSize: '0.875rem',
          border: '1px solid #667eea',
          borderRadius: '6px',
          background: '#667eea22',
          color: '#667eea',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        Connect Wallet
      </button>
    </div>
  );
}
