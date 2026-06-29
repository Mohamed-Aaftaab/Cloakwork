import { useState, useCallback } from 'react';
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
  allowAllModules,
} from '@creit.tech/stellar-wallets-kit';
import { config } from '../config';

/** State exposed by the useStellarWallet hook */
export interface StellarWalletState {
  /** Connected Stellar G-address, or null when disconnected */
  address: string | null;
  /** Whether a connection attempt is in progress */
  isConnecting: boolean;
  /** Error message from the last failed connection attempt, or null */
  error: string | null;
  /** Open the Stellar Wallets Kit connection modal */
  connect: () => Promise<void>;
  /** Sign a Stellar transaction XDR string */
  signTransaction: (xdr: string) => Promise<string>;
  /** Disconnect the current wallet */
  disconnect: () => void;
}

// Lazily initialised kit instance (singleton per app lifetime)
let _kit: StellarWalletsKit | null = null;

function getKit(): StellarWalletsKit {
  if (!_kit) {
    const network =
      config.network === 'mainnet'
        ? WalletNetwork.PUBLIC
        : WalletNetwork.TESTNET;
    _kit = new StellarWalletsKit({
      network,
      selectedWalletId: FREIGHTER_ID,
      modules: allowAllModules(),
    });
  }
  return _kit;
}

/**
 * Hook for managing Stellar wallet connection via Stellar Wallets Kit.
 *
 * Supports Freighter and any other wallet registered in the kit.
 * All private key material stays inside the wallet extension — this hook
 * only handles address state and transaction signing requests.
 */
export function useStellarWallet(): StellarWalletState {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const kit = getKit();
      await kit.openModal({
        onWalletSelected: async (option) => {
          kit.setWallet(option.id);
          const { address: addr } = await kit.getAddress();
          setAddress(addr);
        },
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Wallet connection failed';
      setError(message);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const signTransaction = useCallback(
    async (xdrStr: string): Promise<string> => {
      const freighter = await import('@stellar/freighter-api');
      // Ensure Freighter has access before signing
      const accessResult = await freighter.requestAccess();
      if (accessResult.error) throw new Error(`Freighter access denied: ${accessResult.error}`);

      const networkPassphrase =
        config.network === 'mainnet'
          ? 'Public Global Stellar Network ; September 2015'
          : 'Test SDF Network ; September 2015';
      const result = await freighter.signTransaction(xdrStr, { networkPassphrase });
      if (result.error) throw new Error(result.error);
      return result.signedTxXdr;
    },
    []
  );

  const disconnect = useCallback(() => {
    _kit = null;
    setAddress(null);
    setError(null);
  }, []);

  return { address, isConnecting, error, connect, signTransaction, disconnect };
}
