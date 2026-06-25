import React from 'react';
import { config } from '../config';

const networkColors: Record<string, string> = {
  testnet: '#d69e2e',
  futurenet: '#9f7aea',
  mainnet: '#48bb78',
};

export function NetworkBadge() {
  const network = config.network;
  const color = networkColors[network] ?? '#718096';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '9999px',
        fontSize: '0.7rem',
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        backgroundColor: `${color}22`,
        color,
        border: `1px solid ${color}44`,
      }}
    >
      {network}
    </span>
  );
}
