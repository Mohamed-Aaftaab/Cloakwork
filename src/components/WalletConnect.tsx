import React from 'react';
import { truncateAddress } from '../utils/formatAddress';

interface WalletConnectProps {
  address?: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

/**
 * Wallet connect/disconnect button.
 * Shows truncated address when connected.
 */
export function WalletConnect({
  address,
  onConnect,
  onDisconnect,
}: WalletConnectProps): React.ReactElement {
  if (address) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          style={{
            padding: '4px 12px',
            borderRadius: '6px',
            background: '#1a202c',
            border: '1px solid #2d3748',
            fontSize: '0.85rem',
            fontFamily: 'monospace',
          }}
        >
          {truncateAddress(address)}
        </span>
        <button
          onClick={onDisconnect}
          style={{
            padding: '4px 12px',
            borderRadius: '6px',
            background: 'transparent',
            border: '1px solid #4a5568',
            color: '#a0aec0',
            cursor: 'pointer',
            fontSize: '0.8rem',
          }}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onConnect}
      style={{
        padding: '6px 16px',
        borderRadius: '6px',
        background: '#553c9a',
        border: 'none',
        color: '#e9d8fd',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: '0.9rem',
      }}
    >
      Connect Wallet
    </button>
  );
}
