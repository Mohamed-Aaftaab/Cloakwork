import React, { useEffect, useState } from 'react';
import {
  Contract,
  Networks,
  rpc as StellarRpc,
  TransactionBuilder,
  xdr,
  scValToNative,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import { GatedActionDemo } from './GatedActionDemo';
import { CredentialData } from './CredentialCard';
import { config } from '../config';

interface Props {
  walletAddress: string;
  signTransaction: (xdr: string) => Promise<string>;
}

/**
 * Gated action section — loads real credentials from the registry and
 * passes them to the GatedActionDemo component for the on-chain demo.
 * walletAddress + signTransaction are passed as props from App.tsx to avoid
 * duplicate useStellarWallet() hook state.
 */
export function GatedActionSection({ walletAddress, signTransaction }: Props) {
  const [credentials, setCredentials] = useState<CredentialData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (walletAddress && config.registryContractId) {
      loadCredentials();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  async function loadCredentials() {
    if (!walletAddress || !config.registryContractId) return;
    setLoading(true);
    try {
      const server = new StellarRpc.Server(config.rpcUrl);
      const contract = new Contract(config.registryContractId);

      // Fetch real account for sequence number
      const account = await server.getAccount(walletAddress);

      // 1. Get nullifiers for this wallet
      const listTx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(contract.call(
          'get_credentials_by_owner',
          nativeToScVal(walletAddress, { type: 'address' })
        ))
        .setTimeout(30)
        .build();

      const listSim = await server.simulateTransaction(listTx);
      if (StellarRpc.Api.isSimulationError(listSim)) return;

      const retval = listSim.result?.retval;
      if (!retval) { setCredentials([]); return; }
      const nullifiersNative = scValToNative(retval);
      if (!Array.isArray(nullifiersNative) || nullifiersNative.length === 0) {
        setCredentials([]);
        return;
      }

      // 2. Load each credential (reuse same account to avoid repeated getAccount calls)
      const loaded: CredentialData[] = [];
      for (const nullifier of nullifiersNative as Uint8Array[]) {
        try {
          const credTx = new TransactionBuilder(account, {
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
            owner: walletAddress!,
            registryContractId: config.registryContractId,
            txHash: '',
          });
        } catch {
          // Skip credentials that fail to load
        }
      }
      setCredentials(loaded);
    } catch {
      // Silently fail — user sees empty state
    } finally {
      setLoading(false);
    }
  }

  const activeCount = credentials.filter(c => c.status === 'Active').length;

  return (
    <div style={{ padding: '1.5rem 0' }}>
      {loading && (
        <p style={{ color: '#718096', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Loading credentials from registry…
        </p>
      )}

      {!loading && credentials.length === 0 && (
        <div style={{ padding: '1rem', background: '#1a202c', borderRadius: '8px', border: '1px solid #2d3748', marginBottom: '1rem' }}>
          <p style={{ color: '#718096', fontSize: '0.875rem', margin: 0 }}>
            No credentials found for this wallet. Complete the proof flow in the "Create Proof" tab
            to issue a DomainCredential, then return here.
          </p>
        </div>
      )}

      {activeCount > 0 && (
        <GatedActionDemo
          credentials={credentials}
          walletAddress={walletAddress ?? ''}
          signTransaction={signTransaction}
        />
      )}

      {!loading && credentials.length > 0 && activeCount === 0 && (
        <div style={{ padding: '1rem', background: '#1a202c', borderRadius: '8px', border: '1px solid #2d3748' }}>
          <p style={{ color: '#718096', fontSize: '0.875rem', margin: 0 }}>
            All credentials are revoked or expired. Issue a new credential to use the gated action.
          </p>
        </div>
      )}
    </div>
  );
}
