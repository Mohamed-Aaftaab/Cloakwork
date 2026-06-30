import React, { useEffect, useState } from 'react';
import {
  rpc as StellarRpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { GatedActionDemo } from './GatedActionDemo';
import { CredentialData } from './CredentialCard';
import { useStellarWallet } from '../hooks/useStellarWallet';
import { config } from '../config';

/**
 * Gated action section — loads real credentials from the registry and
 * passes them to the GatedActionDemo component for the on-chain demo.
 */
export function GatedActionSection() {
  const wallet = useStellarWallet();
  const [credentials, setCredentials] = useState<CredentialData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!wallet.address || !config.registryContractId) return;
    loadCredentials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address]);

  async function loadCredentials() {
    if (!wallet.address || !config.registryContractId) return;
    setLoading(true);
    try {
      const server = new StellarRpc.Server(config.rpcUrl);

      // Call get_credentials_by_owner to get nullifiers for this wallet
      const nullifiersResult = await server.simulateTransaction(
        buildReadCall(wallet.address, 'get_credentials_by_owner', [
          addressToScVal(wallet.address),
        ])
      );

      if (StellarRpc.Api.isSimulationError(nullifiersResult)) return;

      const nullifiersNative = nullifiersResult.result?.retval
        ? scValToNative(nullifiersResult.result.retval)
        : [];

      const nullifiers: Buffer[] = Array.isArray(nullifiersNative) ? nullifiersNative : [];

      // Load each credential
      const loaded: CredentialData[] = [];
      for (const nullifier of nullifiers) {
        try {
          const credResult = await server.simulateTransaction(
            buildReadCall(wallet.address, 'get_credential', [
              xdr.ScVal.scvBytes(nullifier),
            ])
          );
          if (StellarRpc.Api.isSimulationError(credResult)) continue;
          const retval = credResult.result?.retval;
          if (!retval) continue;
          const native = scValToNative(retval);
          if (!native) continue;

          // Map on-chain DomainCredential to CredentialData
          const nullifierHex = Buffer.from(nullifier).toString('hex');
          const commitmentHex = native.commitment
            ? Buffer.from(native.commitment).toString('hex')
            : '';

          let status: 'Active' | 'Revoked' | 'Expired' = 'Active';
          const now = Math.floor(Date.now() / 1000);
          if (native.status && typeof native.status === 'object' && 'Revoked' in native.status) {
            status = 'Revoked';
          } else if (Number(native.expires_at) < now) {
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
    } catch {
      // Silently fail — user sees empty state
    } finally {
      setLoading(false);
    }
  }

  function buildReadCall(caller: string, method: string, args: xdr.ScVal[]) {
    const { Contract, TransactionBuilder, Networks } = require('@stellar/stellar-sdk');
    const contract = new Contract(config.registryContractId);
    // Use a dummy account for simulation read calls (no signing needed)
    const dummyAccount = {
      accountId: () => caller,
      sequenceNumber: () => '0',
      incrementSequenceNumber: () => {},
    };
    return new TransactionBuilder(dummyAccount as any, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();
  }

  function addressToScVal(address: string): xdr.ScVal {
    const { nativeToScVal } = require('@stellar/stellar-sdk');
    return nativeToScVal(address, { type: 'address' });
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
          walletAddress={wallet.address ?? ''}
          signTransaction={wallet.signTransaction}
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
