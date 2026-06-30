import React, { useState, useEffect } from 'react';
import {
  Contract,
  Networks,
  rpc as StellarRpc,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import { CredentialData } from './CredentialCard';
import { config } from '../config';

interface Props {
  credentials: CredentialData[];
  walletAddress: string;
  signTransaction: (xdr: string) => Promise<string>;
}

const EXPLORER = 'https://stellar.expert/explorer/testnet';

/**
 * Gated action demo — "Verified Merchant Payment Intent".
 *
 * Calls execute_with_credential on the gated_action_demo Soroban contract.
 * Uses the cloakwork-sdk on-chain: one line of Rust gates the action behind
 * a valid DomainCredential without revealing the domain.
 *
 * No mocks, no bypasses — real Soroban transaction submitted.
 */
export function GatedActionDemo({ credentials, walletAddress, signTransaction }: Props) {
  const activeCredentials = credentials.filter(c => c.status === 'Active');
  const [selected, setSelected] = useState<CredentialData | null>(activeCredentials[0] ?? null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Sync selected when credentials load asynchronously — initialState captures
  // the first render's empty array, so we need to update when credentials arrive.
  useEffect(() => {
    setSelected(prev => {
      // If we already have a valid selection that's still in the active list, keep it
      if (prev && activeCredentials.some(c => c.nullifier === prev.nullifier)) return prev;
      // Otherwise default to the first active credential
      return activeCredentials[0] ?? null;
    });
  }, [credentials]); // eslint-disable-line react-hooks/exhaustive-deps

  if (activeCredentials.length === 0) return null;

  async function handleExecute() {
    if (!selected || !walletAddress) return;

    const gatedContractId = config.gatedActionContractId;
    if (!gatedContractId) {
      setError('Gated action contract ID not configured.');
      return;
    }

    setIsRunning(true);
    setError(null);
    setTxHash(null);

    try {
      const server = new StellarRpc.Server(config.rpcUrl);
      const account = await server.getAccount(walletAddress);

      // Encode nullifier as BytesN<32>
      const nullifierHex = selected.nullifier.replace(/^0x/, '').padStart(64, '0');
      const nullifierBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        nullifierBytes[i] = parseInt(nullifierHex.slice(i * 2, i * 2 + 2), 16);
      }

      // Action payload — "payment:demo" as bytes
      const payloadBytes = new TextEncoder().encode('payment:demo');

      const contract = new Contract(gatedContractId);
      const tx = new TransactionBuilder(account, {
        fee: '1000000',
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          contract.call(
            'execute_with_credential',
            nativeToScVal(walletAddress, { type: 'address' }),
            nativeToScVal(nullifierBytes, { type: 'bytes' }),
            nativeToScVal(payloadBytes, { type: 'bytes' }),
          )
        )
        .setTimeout(60)
        .build();

      // Simulate
      const simResult = await server.simulateTransaction(tx);
      if (StellarRpc.Api.isSimulationError(simResult)) {
        throw new Error(`Simulation failed: ${simResult.error}`);
      }

      // Assemble, sign, submit
      const preparedTx = StellarRpc.assembleTransaction(tx, simResult).build();
      const signedXdr = await signTransaction(preparedTx.toXDR());

      const submitResult = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET)
      );
      if (submitResult.status === 'ERROR') {
        throw new Error(`Transaction rejected: ${JSON.stringify(submitResult.errorResult)}`);
      }

      const hash = submitResult.hash;
      setTxHash(hash);

      // Poll for confirmation — 20 attempts × 3s = 60s max
      let getResult = await server.getTransaction(hash);
      let attempts = 0;
      while (getResult.status === StellarRpc.Api.GetTransactionStatus.NOT_FOUND && attempts < 20) {
        await new Promise(r => setTimeout(r, 3000));
        getResult = await server.getTransaction(hash);
        attempts++;
      }

      if (getResult.status === StellarRpc.Api.GetTransactionStatus.NOT_FOUND) {
        throw new Error(`Transaction not confirmed after 60s. It may still process. Check: ${EXPLORER}/tx/${hash}`);
      }

      if (getResult.status === StellarRpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`Transaction failed on-chain. Check: ${EXPLORER}/tx/${hash}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gated action failed';
      if (msg.includes('Revoked') || msg.includes('CredentialRevoked')) {
        setError('Credential revoked — this action requires an active credential.');
      } else if (msg.includes('Expired') || msg.includes('CredentialExpired')) {
        setError('Credential expired — please renew your credential.');
      } else if (msg.includes('cancel') || msg.includes('User declined')) {
        setError('Transaction cancelled by user.');
      } else {
        setError(msg);
      }
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div style={{ maxWidth: '600px' }}>
      <h2 style={{ color: '#e2e8f0', fontSize: '1.25rem', margin: '0 0 0.5rem 0' }}>
        Gated Action Demo
      </h2>
      <p style={{ color: '#718096', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
        This demo calls the <code style={{ color: '#90cdf4' }}>gated_action_demo</code> Soroban
        contract using the Cloakwork SDK. The contract verifies your credential without knowing
        your domain — one line of Rust is all it takes.
      </p>

      <div style={{ background: '#1a202c', border: '1px solid #2d3748', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ color: '#718096', fontSize: '0.75rem', marginBottom: '0.5rem' }}>How it works on-chain</div>
        <code style={{ color: '#90cdf4', fontSize: '0.78rem', lineHeight: 1.6, display: 'block' }}>
          {`CloakworkClient::require_valid_credential(\n  &env, registry_addr, owner, nullifier\n);\n// → emits ActionExecuted event`}
        </code>
      </div>

      {activeCredentials.length > 1 && (
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ color: '#a0aec0', fontSize: '0.8rem', display: 'block', marginBottom: '0.3rem' }}>
            Select credential:
          </label>
          <select
            value={selected?.nullifier ?? ''}
            onChange={e => setSelected(activeCredentials.find(c => c.nullifier === e.target.value) ?? null)}
            style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid #4a5568', background: '#1a202c', color: '#e2e8f0', fontSize: '0.875rem' }}
          >
            {activeCredentials.map(c => (
              <option key={c.nullifier} value={c.nullifier}>
                {c.nullifier.slice(0, 12)}… (v{c.verifierVersion})
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div role="alert" style={{ color: '#fc8181', fontSize: '0.875rem', marginBottom: '0.75rem', padding: '0.75rem', background: '#fc818111', border: '1px solid #fc818133', borderRadius: '6px' }}>
          {error}
        </div>
      )}

      {txHash && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#68d39111', border: '1px solid #68d39133', borderRadius: '6px' }}>
          <div style={{ color: '#68d391', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
            ✓ Verified Merchant Payment Intent created on Stellar testnet
          </div>
          <div style={{ color: '#718096', fontSize: '0.78rem', marginBottom: '0.25rem' }}>
            Event emitted: <code style={{ color: '#90cdf4' }}>ActionExecuted</code>
          </div>
          <div style={{ color: '#718096', fontSize: '0.78rem', marginBottom: '0.25rem' }}>
            Owner: <code style={{ color: '#a0aec0' }}>{walletAddress.slice(0, 12)}…</code>
          </div>
          <div style={{ color: '#718096', fontSize: '0.78rem', marginBottom: '0.4rem' }}>
            Commitment: <code style={{ color: '#a0aec0' }}>{selected?.commitment?.slice(0, 16)}…</code>
          </div>
          <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
             style={{ color: '#90cdf4', fontSize: '0.78rem', textDecoration: 'none' }}>
            View on Stellar Explorer ↗
          </a>
        </div>
      )}

      <button
        onClick={handleExecute}
        disabled={isRunning || !selected}
        style={{
          padding: '10px 22px', fontSize: '0.9rem',
          border: '1px solid #667eea', borderRadius: '8px',
          background: '#667eea22', color: '#667eea',
          cursor: isRunning ? 'not-allowed' : 'pointer',
          fontWeight: 700, opacity: isRunning ? 0.6 : 1,
        }}
      >
        {isRunning ? 'Executing…' : 'Create Verified Merchant Payment Intent'}
      </button>

      {config.gatedActionContractId && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#4a5568' }}>
          Contract: <code>{config.gatedActionContractId.slice(0, 12)}…</code>
        </div>
      )}
    </div>
  );
}
