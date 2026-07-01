import React from 'react';
import { config } from '../config';

export function NetworkBadge() {
  const network = config.network;
  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 10px',
      borderRadius: '9999px',
      fontSize: '10px',
      fontWeight: 700,
      fontFamily: 'var(--font-mono)',
      letterSpacing: '0.12em',
      textTransform: 'uppercase' as const,
      backgroundColor: 'rgba(175,80,255,0.12)',
      color: 'rgba(225,189,255,0.9)',
      border: '1px solid rgba(175,80,255,0.28)',
    }}>
      {network}
    </span>
  );
}
