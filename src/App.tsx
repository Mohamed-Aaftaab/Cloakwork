import React, { useState } from 'react';
import { ConnectPrompt } from './components/ConnectPrompt';
import { ProofWorkspace } from './components/ProofWorkspace';
import { CredentialManager } from './components/CredentialManager';
import { GatedActionSection } from './components/GatedActionSection';
import { useStellarWallet } from './hooks/useStellarWallet';
import { truncateAddress } from './utils/formatAddress';

type ActiveTab = 'proof' | 'credentials' | 'gated';

function App() {
  const wallet = useStellarWallet();
  const [activeTab, setActiveTab] = useState<ActiveTab>('proof');

  const tabs: { id: ActiveTab; label: string }[] = [
    { id: 'proof',       label: 'CREATE PROOF' },
    { id: 'credentials', label: 'MY CREDENTIALS' },
    { id: 'gated',       label: 'GATED ACTION' },
  ];

  return (
    <div className="App">

      {/* ── Nav bar — matches landing page pill style ── */}
      <header className="app-nav" aria-label="App navigation">
        {/* Wordmark */}
        <a className="app-nav-wordmark" href="/" aria-label="Back to home">
          <span className="app-nav-mark" aria-hidden="true" />
          CLOAKWORK
        </a>

        {/* Tab pills */}
        <nav className="app-nav-tabs" aria-label="App sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`app-nav-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => {
                if (!wallet.address) {
                  wallet.connect();
                } else {
                  setActiveTab(tab.id);
                }
              }}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Wallet actions */}
        <div className="app-nav-actions">
          {wallet.address ? (
            <>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'rgba(247,249,250,0.72)',
                letterSpacing: '0.04em',
              }}>
                {truncateAddress(wallet.address)}
              </span>
              <button
                className="cw-btn"
                onClick={wallet.disconnect}
                style={{ minHeight: '38px', fontSize: '11px' }}
              >
                DISCONNECT
              </button>
            </>
          ) : (
            <button className="cw-btn cw-btn-filled" onClick={wallet.connect}>
              CONNECT WALLET
            </button>
          )}
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="app-main">

        {/* Wallet error banner */}
        {wallet.error && (
          <div className="cw-alert" role="alert">
            <span>{wallet.error}</span>
            <button onClick={wallet.connect}>Retry</button>
          </div>
        )}

        {/* Sections */}
        {!wallet.address ? (
          <>
            {activeTab === 'proof' && (
              <ConnectPrompt sectionName="proof generation" onConnectClick={wallet.connect} />
            )}
            {activeTab === 'credentials' && (
              <ConnectPrompt sectionName="credential management" onConnectClick={wallet.connect} />
            )}
            {activeTab === 'gated' && (
              <ConnectPrompt sectionName="gated action demo" onConnectClick={wallet.connect} />
            )}
          </>
        ) : (
          <>
            {activeTab === 'proof'       && <ProofWorkspace wallet={wallet} />}
            {activeTab === 'credentials' && <CredentialManager walletAddress={wallet.address ?? ''} signTransaction={wallet.signTransaction} />}
            {activeTab === 'gated'       && <GatedActionSection walletAddress={wallet.address ?? ''} signTransaction={wallet.signTransaction} />}
          </>
        )}
      </main>

      {/* ── Coordinate footer bar (matches landing page) ── */}
      <footer className="cw-coordinate-bar" aria-label="Build info">
        <span>+ Cloakwork Real-World ZK / App</span>
        <span>STELLAR TESTNET · DNSSEC · GROTH16 · BN254</span>
      </footer>

    </div>
  );
}

export default App;
