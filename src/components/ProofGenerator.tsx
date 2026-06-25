import React from 'react';
import { useCloakworkProof, ProofFlowStatus } from '../hooks/useCloakworkProof';

interface Props {
  proof: ReturnType<typeof useCloakworkProof>;
  onSubmitClick: () => void;
}

type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface Step {
  id: string;
  label: string;
  activeOn: ProofFlowStatus[];
  doneOn: ProofFlowStatus[];
  errorOn: ProofFlowStatus[];
}

const STEPS: Step[] = [
  { id: 'witness', label: 'Preparing witness inputs', activeOn: ['proving'], doneOn: ['proof_ready', 'submitting', 'submit_error', 'credential_issued'], errorOn: ['proof_error'] },
  { id: 'wasm', label: 'Loading Circom WASM prover', activeOn: ['proving'], doneOn: ['proof_ready', 'submitting', 'submit_error', 'credential_issued'], errorOn: ['proof_error'] },
  { id: 'circuit', label: 'Executing circuit', activeOn: ['proving'], doneOn: ['proof_ready', 'submitting', 'submit_error', 'credential_issued'], errorOn: ['proof_error'] },
  { id: 'groth16', label: 'Generating Groth16 proof', activeOn: ['proving'], doneOn: ['proof_ready', 'submitting', 'submit_error', 'credential_issued'], errorOn: ['proof_error'] },
  { id: 'done', label: 'Proof ready', activeOn: [], doneOn: ['proof_ready', 'submitting', 'submit_error', 'credential_issued'], errorOn: [] },
];

function stepStatus(step: Step, status: ProofFlowStatus): StepStatus {
  if (step.doneOn.includes(status)) return 'done';
  if (step.errorOn.includes(status)) return 'error';
  if (step.activeOn.includes(status)) return 'active';
  return 'pending';
}

const DOT: Record<StepStatus, { symbol: string; color: string }> = {
  pending: { symbol: '○', color: '#4a5568' },
  active:  { symbol: '◌', color: '#f6ad55' },
  done:    { symbol: '●', color: '#68d391' },
  error:   { symbol: '✗', color: '#fc8181' },
};

/** Step 3 — Proof generation timeline and submit button. */
export function ProofGenerator({ proof, onSubmitClick }: Props) {
  const visible = ['dnssec_found', 'proving', 'proof_error', 'proof_ready', 'submitting', 'submit_error', 'credential_issued'].includes(proof.status);
  if (!visible) return null;

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ color: '#e2e8f0', fontSize: '1rem', marginBottom: '0.75rem' }}>
        Step 3 — Generate ZK Proof
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.75rem' }}>
        {STEPS.map(step => {
          const s = stepStatus(step, proof.status);
          const { symbol, color } = DOT[s];
          return (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color, fontFamily: 'monospace', fontSize: '1rem', width: '16px', textAlign: 'center' }}>{symbol}</span>
              <span style={{ color: s === 'pending' ? '#4a5568' : s === 'error' ? '#fc8181' : '#e2e8f0', fontSize: '0.875rem' }}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {proof.status === 'proof_error' && proof.error && (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ color: '#fc8181', fontSize: '0.875rem', marginBottom: '0.4rem' }}>
            Circuit error: {proof.error}
          </div>
          <button
            onClick={proof.generateProof}
            style={{ padding: '6px 14px', fontSize: '0.8rem', border: '1px solid #fc8181', borderRadius: '6px', background: 'transparent', color: '#fc8181', cursor: 'pointer' }}
          >
            Regenerate proof
          </button>
        </div>
      )}

      {proof.status === 'dnssec_found' && (
        <button
          onClick={proof.generateProof}
          style={{ padding: '8px 18px', fontSize: '0.875rem', border: '1px solid #667eea', borderRadius: '6px', background: '#667eea22', color: '#667eea', cursor: 'pointer', fontWeight: 600 }}
        >
          Generate ZK Proof
        </button>
      )}

      {proof.status === 'proof_ready' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '500px' }}>
          <div style={{ background: '#1a202c', border: '1px solid #2d3748', borderRadius: '8px', padding: '0.75rem', fontSize: '0.8rem' }}>
            <div style={{ color: '#68d391', marginBottom: '0.25rem' }}>Proof generated</div>
            {proof.proofSizeBytes && <div style={{ color: '#718096' }}>Size: {proof.proofSizeBytes} bytes</div>}
            {proof.publicSignals && <div style={{ color: '#718096' }}>{proof.publicSignals.length} public signals</div>}
          </div>
          <button
            onClick={onSubmitClick}
            style={{ padding: '10px 22px', fontSize: '0.9rem', border: '1px solid #68d391', borderRadius: '8px', background: '#68d39122', color: '#68d391', cursor: 'pointer', fontWeight: 700, alignSelf: 'flex-start' }}
          >
            Submit to Soroban →
          </button>
        </div>
      )}
    </div>
  );
}
