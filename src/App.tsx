import React, { useState } from 'react';
import { Header } from './components/Header';
import { ConnectPrompt } from './components/ConnectPrompt';
import { ProofWorkspace } from './components/ProofWorkspace';
import { CredentialManager } from './components/CredentialManager';
import { GatedActionSection } from './components/GatedActionSection';
import { useStellarWallet } from './hooks/useStellarWallet';

type ActiveTab = 'proof' | 'credentials' | 'gated';

function App() {
  const wallet = useStellarWallet();
  const [activeTab, setActiveTab] = useState<ActiveTab>('proof');

  const tabs: { id: ActiveTab; label: string }[] = [
    { id: 'proof', label: 'Create Proof' },
    { id: 'credentials', label: 'My Credentials' },
    { id: 'gated', label: 'Gated Action' },
  ];

  return (
    <div className="App">
      <Header
        walletAddress={wallet.address}
        onConnectClick={wallet.connect}
        onDisconnectClick={wallet.disconnect}
      />

      {/* Tab navigation */}
      <nav
        style={{
          display: 'flex',
          gap: '0',
          borderBottom: '1px solid #2d3748',
          backgroundColor: '#0f0f1a',
          padding: '0 1.5rem',
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              if (!wallet.address) {
                wallet.connect();
              } else {
                setActiveTab(tab.id);
              }
            }}
            style={{
              padding: '0.75rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: activeTab === tab.id ? 600 : 400,
              border: 'none',
              borderBottom:
                activeTab === tab.id
                  ? '2px solid #667eea'
                  : '2px solid transparent',
              background: 'transparent',
              color: activeTab === tab.id ? '#667eea' : '#718096',
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Main content — protected behind wallet connection */}
      <main style={{ padding: '1.5rem', maxWidth: '900px', margin: '0 auto' }}>
        {wallet.error && (
          <div
            role="alert"
            style={{
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              borderRadius: '6px',
              backgroundColor: '#fc818133',
              border: '1px solid #fc8181',
              color: '#fc8181',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <span>{wallet.error}</span>
            <button
              onClick={wallet.connect}
              style={{
                marginLeft: 'auto',
                fontWeight: 600,
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                color: '#fc8181',
                textDecoration: 'underline',
                fontSize: '0.875rem',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {!wallet.address ? (
          // Show connect prompts for each section — clicking opens wallet modal
          <>
            {activeTab === 'proof' && (
              <ConnectPrompt
                sectionName="proof generation"
                onConnectClick={wallet.connect}
              />
            )}
            {activeTab === 'credentials' && (
              <ConnectPrompt
                sectionName="credential management"
                onConnectClick={wallet.connect}
              />
            )}
            {activeTab === 'gated' && (
              <ConnectPrompt
                sectionName="gated action demo"
                onConnectClick={wallet.connect}
              />
            )}
          </>
        ) : (
          // Wallet connected — show the active section
          <>
            {activeTab === 'proof' && <ProofWorkspace wallet={wallet} />}
            {activeTab === 'credentials' && <CredentialManager walletAddress={wallet.address ?? ''} />}
            {activeTab === 'gated' && <GatedActionSection walletAddress={wallet.address ?? ''} signTransaction={wallet.signTransaction} />}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
