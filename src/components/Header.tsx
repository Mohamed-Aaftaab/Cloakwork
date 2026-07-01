import React from 'react';
import { NetworkBadge } from './NetworkBadge';
import { truncateAddress } from '../utils/formatAddress';

interface HeaderProps {
  /** Connected Stellar wallet address, or null when disconnected */
  walletAddress: string | null;
  /** Called when the user clicks the connect button */
  onConnectClick: () => void;
  /** Called when the user clicks the disconnect button */
  onDisconnectClick: () => void;
}

/**
 * Application header showing the Cloakwork brand, active network badge,
 * and wallet connection status.
 */
export function Header({ walletAddress, onConnectClick, onDisconnectClick }: HeaderProps) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1.5rem',
        borderBottom: '1px solid #2d3748',
        backgroundColor: '#090909',
      }}
    >
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#f7f9fa' }}>
          Cloakwork
        </h1>
        <NetworkBadge />
      </div>

      {/* Wallet status */}
      <div>
        {walletAddress ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                fontSize: '0.8rem',
                color: '#a0aec0',
                fontFamily: 'monospace',
              }}
            >
              {truncateAddress(walletAddress)}
            </span>
            <button
              onClick={onDisconnectClick}
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                border: '1px solid #4a5568',
                borderRadius: '6px',
                background: 'transparent',
                color: '#a0aec0',
                cursor: 'pointer',
              }}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={onConnectClick}
            style={{
              padding: '6px 14px',
              fontSize: '0.85rem',
              border: '1px solid #af50ff',
              borderRadius: '6px',
              background: '#af50ff22',
              color: '#af50ff',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
}
