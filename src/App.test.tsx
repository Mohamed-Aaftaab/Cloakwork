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

describe('Auth-gate UI — disconnected state', () => {
  it('shows ConnectPrompt and NOT ProofWorkspace when wallet is disconnected (proof tab)', () => {
    render(<App />);
    expect(screen.getByText(/connect your wallet to access proof generation/i)).toBeInTheDocument();
    expect(screen.queryByText(/step-by-step domain proof flow/i)).not.toBeInTheDocument();
  });

  it('clicking a tab while disconnected calls wallet.connect()', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /my credentials/i }));
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('clicking ConnectPrompt button calls wallet.connect()', () => {
    render(<App />);
    // Two "Connect Wallet" buttons exist when disconnected: one in Header, one in ConnectPrompt.
    // Either triggers wallet.connect — verify at least one was found and fires the mock.
    const connectButtons = screen.getAllByRole('button', { name: /connect wallet/i });
    expect(connectButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(connectButtons[connectButtons.length - 1]); // click the ConnectPrompt button
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('does not render CredentialManager when disconnected', () => {
    render(<App />);
    expect(screen.queryByText(/credential list/i)).not.toBeInTheDocument();
  });

  it('does not render GatedActionSection when disconnected', () => {
    render(<App />);
    expect(screen.queryByText(/sdk-gated action demo/i)).not.toBeInTheDocument();
  });
});

describe('Auth-gate UI — connected state', () => {
  beforeEach(() => {
    mockAddress = 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890';
  });

  it('renders ProofWorkspace (not ConnectPrompt) when wallet is connected', () => {
    render(<App />);
    expect(screen.getByText(/step-by-step domain proof flow/i)).toBeInTheDocument();
    expect(screen.queryByText(/connect your wallet to access/i)).not.toBeInTheDocument();
  });

  it('switching to My Credentials tab renders CredentialManager', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /my credentials/i }));
    expect(screen.getByText(/credential list/i)).toBeInTheDocument();
  });

  it('switching to Gated Action tab renders GatedActionSection', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /gated action/i }));
    expect(screen.getByText(/sdk-gated action demo/i)).toBeInTheDocument();
  });
});

describe('Auth-gate UI — error state', () => {
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
