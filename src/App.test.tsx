import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the wallet hook module-wide so Jest never loads the ESM wallet-kit
// package, which is not supported by the CRA Jest transform config.
const mockConnect = jest.fn();
const mockDisconnect = jest.fn();
const mockSignTransaction = jest.fn();

// Default mock — disconnected
let mockAddress: string | null = null;
let mockError: string | null = null;

jest.mock('./hooks/useStellarWallet', () => ({
  useStellarWallet: () => ({
    address: mockAddress,
    isConnecting: false,
    error: mockError,
    connect: mockConnect,
    disconnect: mockDisconnect,
    signTransaction: mockSignTransaction,
  }),
}));

// Import App AFTER the mock is registered
import App from './App';

beforeEach(() => {
  jest.clearAllMocks();
  mockAddress = null;
  mockError = null;
});

describe('Auth-gate UI - disconnected state', () => {
  it('shows ConnectPrompt when wallet is disconnected on proof tab', () => {
    render(<App />);
    expect(screen.getByText(/connect your wallet to access proof generation/i)).toBeInTheDocument();
    expect(screen.queryByText(/create private domain proof/i)).not.toBeInTheDocument();
  });

  it('clicking a tab while disconnected calls wallet.connect()', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /my credentials/i }));
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('clicking ConnectPrompt button calls wallet.connect()', () => {
    render(<App />);
    // Two "Connect Wallet" buttons: one in Header, one in ConnectPrompt
    const connectButtons = screen.getAllByRole('button', { name: /connect wallet/i });
    expect(connectButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(connectButtons[connectButtons.length - 1]);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('does not render CredentialManager content when disconnected', () => {
    render(<App />);
    // CredentialManager heading only renders when connected
    expect(screen.queryByText(/^my credentials$/i)).not.toBeInTheDocument();
  });

  it('does not render GatedActionSection when disconnected', () => {
    render(<App />);
    // GatedActionSection only renders when connected
    expect(screen.queryByText(/gated action demo/i)).not.toBeInTheDocument();
  });
});

describe('Auth-gate UI - connected state', () => {
  beforeEach(() => {
    mockAddress = 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890';
  });

  it('renders ProofWorkspace when wallet is connected', () => {
    render(<App />);
    expect(screen.getByText(/create private domain proof/i)).toBeInTheDocument();
    expect(screen.queryByText(/connect your wallet to access/i)).not.toBeInTheDocument();
  });

  it('switching to My Credentials tab renders CredentialManager', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /my credentials/i }));
    // CredentialManager renders heading "My Credentials"
    const headings = screen.getAllByText(/my credentials/i);
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it('switching to Gated Action tab renders GatedActionSection', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /gated action/i }));
    // Tab label "Gated Action" is in the nav
    const gatedButtons = screen.getAllByText(/gated action/i);
    expect(gatedButtons.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Auth-gate UI - error state', () => {
  it('shows error banner with retry button when wallet.error is set', () => {
    mockError = 'No wallet extension found';
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('No wallet extension found');
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('clicking Retry in the error banner calls wallet.connect()', () => {
    mockError = 'Connection refused';
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });
});
