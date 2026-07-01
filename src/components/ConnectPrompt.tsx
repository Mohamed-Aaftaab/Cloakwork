import React from 'react';

interface ConnectPromptProps {
  sectionName: string;
  onConnectClick: () => void;
}

/**
 * Displayed when no wallet is connected.
 * Styled to match the landing page design system.
 */
export function ConnectPrompt({ sectionName, onConnectClick }: ConnectPromptProps) {
  return (
    <div className="cw-connect-prompt">
      {/* Lock icon — matches landing page boarding-pass aesthetic */}
      <div className="cw-connect-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke="rgba(175,80,255,0.85)" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>

      <p style={{ fontSize: '1rem', color: 'rgba(247,249,250,0.68)' }}>
        Connect your wallet to access {sectionName}
      </p>

      <button className="cw-btn cw-btn-filled" onClick={onConnectClick}>
        CONNECT WALLET →
      </button>
    </div>
  );
}
