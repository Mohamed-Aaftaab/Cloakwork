import React from 'react';

interface ConnectPromptProps {
  sectionName: string;
  onConnectClick: () => void;
}

/**
 * Displayed in place of a protected section when no wallet is connected.
 * Clicking the button opens the wallet connection modal.
 */
export function ConnectPrompt({ sectionName, onConnectClick }: ConnectPromptProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '3rem 2rem',
        border: '1px dashed #2d3748',
        borderRadius: '12px',
        textAlign: 'center',
        gap: '1rem',
      }}
    >
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#4a5568"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <p style={{ margin: 0, color: '#718096', fontSize: '0.9rem' }}>
        Connect your wallet to access {sectionName}
      </p>
      <button
        onClick={onConnectClick}
        style={{
          padding: '8px 20px',
          fontSize: '0.875rem',
          border: '1px solid #667eea',
          borderRadius: '8px',
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
