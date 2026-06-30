import React, { useEffect, useState } from 'react';
import {
  Contract,
  rpc as StellarRpc,
  TransactionBuilder,
  Networks,
  xdr,
  scValToNative,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import { CredentialCard, CredentialData } from './CredentialCard';
import { useStellarWallet } from '../hooks/useStellarWallet';
import { config } from '../config';

const EXPLORER = 'https://stellar.expert/explorer/testnet';

/**
 * Credential management panel.
 *
 * Loads all DomainCredentials for the connected wallet from the
 * cloakwork_registry contract via simulation read calls.
 * No signing required for reads.
 */
export function CredentialManager() {
  const wallet = useStellarWallet();
  const [credentials, setCredentials] = useState<CredentialData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wallet.address && config.registryContractId) {
      loadCredentials();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address]);

  async function loadCredentials() {
    if (!wallet.address || !config.registryContractId) return;
    setLoading(true);
    setError(null);
    try {
      const server = new StellarRpc.Server(config.rpcUrl);
      const contract = new Contract(config.registryContractId);

      // Build a simulation-only account (real sequence number from RPC)
      const simAccount = await server.getAccount(wallet.address);

      // 1. Fetch the list of nullifiers owned by this wallet
      const listTx = new TransactionBuilder(simAccount, {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(contract.call(
          'get_credentials_by_owner',
          nativeToScVal(wallet.address, { type: 'address' })
        ))
        .setTimeout(30)
        .build();

      const listSim = await server.simulateTransaction(listTx);
      if (StellarRpc.Api.isSimulationError(listSim)) {
        setError('Failed to load credentials from registry.');
        return;
      }

      const retval = listSim.result?.retval;
      if (!retval) { setCredentials([]); return; }
      const nullifiers = scValToNative(retval) as Uint8Array[];
      if (!Array.isArray(nullifiers) || nullifiers.length === 0) {
        setCredentials([]);
        return;
      }

      // 2. Fetch each credential by nullifier (reuse same account object)
      const loaded: CredentialData[] = [];
      for (const nullifier of nullifiers) {
        try {
          const credTx = new TransactionBuilder(simAccount, {
            fee: '100',
            networkPassphrase: Networks.TESTNET,
          })
            .addOperation(contract.call(
              'get_credential',
              xdr.ScVal.scvBytes(Buffer.from(nullifier))
            ))
            .setTimeout(30)
            .build();

          const credSim = await server.simulateTransaction(credTx);
          if (StellarRpc.Api.isSimulationError(credSim)) continue;
          const credRetval = credSim.result?.retval;
          if (!credRetval) continue;
          const native = scValToNative(credRetval);
          if (!native || typeof native !== 'object') continue;

          const nullifierHex = Buffer.from(nullifier).toString('hex');
          const commitmentHex = native.commitment
            ? Buffer.from(native.commitment as Uint8Array).toString('hex')
            : '';

          const now = Math.floor(Date.now() / 1000);
          let status: 'Active' | 'Revoked' | 'Expired' = 'Active';
          if (native.status && typeof native.status === 'object' && 'Revoked' in native.status) {
            status = 'Revoked';
          } else if (Number(native.expires_at ?? 0) < now) {
            status = 'Expired';
          }

          loaded.push({
            commitment: commitmentHex,
            nullifier: nullifierHex,
            issuedAt: Number(native.issued_at ?? 0),
            expiresAt: Number(native.expires_at ?? 0),
            verifierVersion: Number(native.verifier_version ?? 1),
            status,
            owner: wallet.address!,
            registryContractId: config.registryContractId,
            txHash: '',
          });
        } catch {
          // Skip credentials that fail to load
        }
      }
      setCredentials(loaded);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '1.5rem 0', maxWidth: '680px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ color: '#e2e8f0', fontSize: '1.1rem', margin: 0 }}>My Credentials</h2>
        <button
          onClick={loadCredentials}
          disabled={loading}
          style={{ fontSize: '0.8rem', padding: '4px 12px', border: '1px solid #4a5568', borderRadius: '6px', background: 'transparent', color: '#a0aec0', cursor: 'pointer' }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div role="alert" style={{ color: '#fc8181', fontSize: '0.875rem', marginBottom: '1rem', padding: '0.75rem', background: '#fc818111', border: '1px solid #fc818133', borderRadius: '6px' }}>
          {error}
        </div>
      )}

      {loading && (
        <p style={{ color: '#718096', fontSize: '0.875rem' }}>Loading credentials from registry…</p>
      )}

      {!loading && credentials.length === 0 && !error && (
        <div style={{ padding: '1.25rem', background: '#1a202c', borderRadius: '8px', border: '1px solid #2d3748' }}>
          <p style={{ color: '#718096', fontSize: '0.875rem', margin: 0 }}>
            No credentials found for this wallet on testnet. Complete the "Create Proof" flow to issue one.
          </p>
        </div>
      )}

      {credentials.map(cred => (
        <div key={cred.nullifier} style={{ marginBottom: '1rem' }}>
          <CredentialCard credential={cred} networkExplorerBase={EXPLORER} />
        </div>
      ))}
    </div>
  );
}
