import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ConnectPrompt } from './ConnectPrompt';

describe('ConnectPrompt', () => {
  it('renders the section name in the prompt message', () => {
    render(<ConnectPrompt sectionName="proof generation" onConnectClick={() => {}} />);
    expect(screen.getByText(/proof generation/i)).toBeInTheDocument();
  });

  it('renders a connect wallet button', () => {
    render(<ConnectPrompt sectionName="credential management" onConnectClick={() => {}} />);
    expect(screen.getByRole('button', { name: /connect wallet/i })).toBeInTheDocument();
  });

  it('calls onConnectClick when the button is clicked', () => {
    const handleConnect = jest.fn();
    render(<ConnectPrompt sectionName="gated action demo" onConnectClick={handleConnect} />);
    fireEvent.click(screen.getByRole('button', { name: /connect wallet/i }));
    expect(handleConnect).toHaveBeenCalledTimes(1);
  });
});
