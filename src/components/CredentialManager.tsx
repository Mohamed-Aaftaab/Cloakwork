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
import { config } from '../config';

const EXPLORER = 'https://stellar.expert/explorer/testnet';

interface Props {
  walletAddress: string;
  signTransaction: (xdr: string) => Promise<string>;
}

/**
 * Credential management panel.
 * Loads credentials, supports Revoke and Renew actions.
 */
export function CredentialManager({ walletAddress, signTransaction }: Props) {
  const [credentials, setCredentials] = useState<CredentialData[]>([]);
  const [loading, setLoading] = useState(true); // start as true — show skeleton immediately
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null); // nullifier of in-progress action

  useEffect(() => {
    if (walletAddress && config.registryContractId) {
      loadCredentials();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  async function loadCredentials() {
    if (!walletAddress || !config.registryContractId) return;
    setLoading(true);
    setError(null);
    try {
      const server = new StellarRpc.Server(config.rpcUrl);
      const contract = new Contract(config.registryContractId);
      const simAccount = await server.getAccount(walletAddress);

      const listTx = new TransactionBuilder(simAccount, {
        fee: '100', networkPassphrase: Networks.TESTNET,
      })
        .addOperation(contract.call('get_credentials_by_owner', nativeToScVal(walletAddress, { type: 'address' })))
        .setTimeout(30).build();

      const listSim = await server.simulateTransaction(listTx);
      if (StellarRpc.Api.isSimulationError(listSim)) { setError('Failed to load credentials.'); return; }

      const retval = listSim.result?.retval;
      if (!retval) { setCredentials([]); return; }
      const nullifiers = scValToNative(retval) as Uint8Array[];
      if (!Array.isArray(nullifiers) || nullifiers.length === 0) { setCredentials([]); return; }

      const loaded: CredentialData[] = [];
      for (const nullifier of nullifiers) {
        try {
          const credTx = new TransactionBuilder(simAccount, { fee: '100', networkPassphrase: Networks.TESTNET })
            .addOperation(contract.call('get_credential', xdr.ScVal.scvBytes(Buffer.from(nullifier))))
            .setTimeout(30).build();
          const credSim = await server.simulateTransaction(credTx);
          if (StellarRpc.Api.isSimulationError(credSim)) continue;
          const credRetval = credSim.result?.retval;
          if (!credRetval) continue;
          const native = scValToNative(credRetval);
          if (!native || typeof native !== 'object') continue;

          const nullifierHex = Buffer.from(nullifier).toString('hex');
          const commitmentHex = native.commitment ? Buffer.from(native.commitment as Uint8Array).toString('hex') : '';
          const now = Math.floor(Date.now() / 1000);
          let status: 'Active' | 'Revoked' | 'Expired' = 'Active';
          if (native.status && typeof native.status === 'object' && 'Revoked' in native.status) status = 'Revoked';
          else if (Number(native.expires_at ?? 0) < now) status = 'Expired';

          loaded.push({
            commitment: commitmentHex,
            nullifier: nullifierHex,
            issuedAt: Number(native.issued_at ?? 0),
            expiresAt: Number(native.expires_at ?? 0),
            verifierVersion: Number(native.verifier_version ?? 1),
            status,
            owner: walletAddress,
            registryContractId: config.registryContractId,
            txHash: '',
          });
        } catch { /* skip */ }
      }
      setCredentials(loaded);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load credentials');
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke(nullifierHex: string) {
    if (!walletAddress || !config.registryContractId) return;
    setActionError(null);
    setActionPending(nullifierHex);
    try {
      const server = new StellarRpc.Server(config.rpcUrl);
      const contract = new Contract(config.registryContractId);
      const account = await server.getAccount(walletAddress);

      const nullifierBytes = Buffer.from(nullifierHex, 'hex');
      const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET })
        .addOperation(contract.call(
          'revoke',
          nativeToScVal(walletAddress, { type: 'address' }),
          xdr.ScVal.scvBytes(nullifierBytes)
        ))
        .setTimeout(60).build();

      const simResult = await server.simulateTransaction(tx);
      if (StellarRpc.Api.isSimulationError(simResult)) throw new Error(`Simulation failed: ${simResult.error}`);
      const preparedTx = StellarRpc.assembleTransaction(tx, simResult).build();
      const signedXdr = await signTransaction(preparedTx.toXDR());
      const submitResult = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET));
      if (submitResult.status === 'ERROR') throw new Error('Transaction rejected');

      // Poll for confirmation
      let getResult = await server.getTransaction(submitResult.hash);
      let attempts = 0;
      while (getResult.status === StellarRpc.Api.GetTransactionStatus.NOT_FOUND && attempts < 20) {
        await new Promise(r => setTimeout(r, 3000));
        getResult = await server.getTransaction(submitResult.hash);
        attempts++;
      }
      if (getResult.status === StellarRpc.Api.GetTransactionStatus.FAILED) throw new Error('Transaction failed on-chain');

      // Refresh the list
      await loadCredentials();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Revoke failed';
      if (!msg.includes('cancel') && !msg.includes('User declined')) setActionError(msg);
    } finally {
      setActionPending(null);
    }
  }

  async function handleRenew(nullifierHex: string) {
    if (!walletAddress || !config.registryContractId) return;
    setActionError(null);
    setActionPending(nullifierHex);
    try {
      const server = new StellarRpc.Server(config.rpcUrl);
      const contract = new Contract(config.registryContractId);
      const account = await server.getAccount(walletAddress);

      // Extend by 30 days from now
      const newExpiry = Math.floor(Date.now() / 1000) + 2_592_000;
      const nullifierBytes = Buffer.from(nullifierHex, 'hex');
      const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET })
        .addOperation(contract.call(
          'renew',
          xdr.ScVal.scvBytes(nullifierBytes),
          xdr.ScVal.scvU64(xdr.Uint64.fromString(newExpiry.toString()))
        ))
        .setTimeout(60).build();

      const simResult = await server.simulateTransaction(tx);
      if (StellarRpc.Api.isSimulationError(simResult)) throw new Error(`Simulation failed: ${simResult.error}`);
      const preparedTx = StellarRpc.assembleTransaction(tx, simResult).build();
      const signedXdr = await signTransaction(preparedTx.toXDR());
      const submitResult = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET));
      if (submitResult.status === 'ERROR') throw new Error('Transaction rejected');

      let getResult = await server.getTransaction(submitResult.hash);
      let attempts = 0;
      while (getResult.status === StellarRpc.Api.GetTransactionStatus.NOT_FOUND && attempts < 20) {
        await new Promise(r => setTimeout(r, 3000));
        getResult = await server.getTransaction(submitResult.hash);
        attempts++;
      }
      if (getResult.status === StellarRpc.Api.GetTransactionStatus.FAILED) throw new Error('Transaction failed on-chain');

      await loadCredentials();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Renew failed';
      if (!msg.includes('cancel') && !msg.includes('User declined')) setActionError(msg);
    } finally {
      setActionPending(null);
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

      {actionError && (
        <div role="alert" style={{ color: '#fc8181', fontSize: '0.875rem', marginBottom: '1rem', padding: '0.75rem', background: '#fc818111', border: '1px solid #fc818133', borderRadius: '6px' }}>
          {actionError}
        </div>
      )}

      {error && (
        <div role="alert" style={{ color: '#fc8181', fontSize: '0.875rem', marginBottom: '1rem', padding: '0.75rem', background: '#fc818111', border: '1px solid #fc818133', borderRadius: '6px' }}>
          {error}
        </div>
      )}

      {/* Skeleton loading state — shows immediately when tab opens */}
      {loading && credentials.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {[0, 1].map(i => (
            <div key={i} style={{ border: '1px solid #2d3748', borderRadius: '12px', overflow: 'hidden', maxWidth: '600px' }}>
              <div style={{ background: '#1a202c', padding: '0.875rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ width: '120px', height: '14px', background: '#2d3748', borderRadius: '4px' }} />
                <div style={{ width: '50px', height: '20px', background: '#2d3748', borderRadius: '9999px' }} />
              </div>
              <div style={{ padding: '0.875rem 1rem', background: '#0f0f1a', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {[0,1,2,3].map(j => (
                  <div key={j} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ width: '70px', height: '12px', background: '#1a202c', borderRadius: '4px' }} />
                    <div style={{ width: '140px', height: '12px', background: '#1a202c', borderRadius: '4px' }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p style={{ color: '#4a5568', fontSize: '0.78rem', margin: 0 }}>Loading credentials from registry…</p>
        </div>
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
          <CredentialCard
            credential={cred}
            networkExplorerBase={EXPLORER}
            onRevoke={cred.status === 'Active' ? () => handleRevoke(cred.nullifier) : undefined}
            onRenew={cred.status === 'Active' ? () => handleRenew(cred.nullifier) : undefined}
          />
          {actionPending === cred.nullifier && (
            <p style={{ color: '#f6ad55', fontSize: '0.8rem', marginTop: '0.25rem' }}>
              ⏳ Submitting transaction…
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
