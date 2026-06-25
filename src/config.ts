/**
 * Application configuration loaded from environment variables.
 * All values default to Stellar testnet when env vars are not set.
 * No literal contract IDs, RPC URLs, or passphrases are hardcoded here.
 */

export interface AppConfig {
  network: string;
  rpcUrl: string;
  horizonUrl: string;
  registryContractId: string;
  verifierContractId: string;
  gatedActionContractId: string;
}

export const config: AppConfig = {
  network: process.env.REACT_APP_STELLAR_NETWORK ?? 'testnet',
  rpcUrl:
    process.env.REACT_APP_STELLAR_RPC_URL ??
    'https://soroban-testnet.stellar.org',
  horizonUrl:
    process.env.REACT_APP_STELLAR_HORIZON_URL ??
    'https://horizon-testnet.stellar.org',
  registryContractId:
    process.env.REACT_APP_CLOAKWORK_REGISTRY_CONTRACT_ID ?? '',
  verifierContractId:
    process.env.REACT_APP_CLOAKWORK_VERIFIER_CONTRACT_ID ?? '',
  gatedActionContractId: process.env.REACT_APP_GATED_ACTION_CONTRACT_ID ?? '',
};
