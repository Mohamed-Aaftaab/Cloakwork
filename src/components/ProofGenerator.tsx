import React, { useEffect, useState } from 'react';
import { useCloakworkProof, ProofFlowStatus } from '../hooks/useCloakworkProof';

// Inject the spin keyframe once at module load — no CSS file needed
(function injectSpinKeyframe() {
  if (typeof document === 'undefined') return;
  const id = 'cloakwork-spin-keyframe';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}());

interface Props {
  proof: ReturnType<typeof useCloakworkProof>;
}

type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface Step {
  id: string;
  label: string;
  activeOn: ProofFlowStatus[];
  doneOn: ProofFlowStatus[];
  errorOn: ProofFlowStatus[];
  estimatedSeconds: number;
}

const STEPS: Step[] = [
  { id: 'witness',  label: 'Preparing witness inputs',   activeOn: ['proving'], doneOn: ['proof_ready','submitting','submit_error','credential_issued'], errorOn: ['proof_error'], estimatedSeconds: 3  },
  { id: 'wasm',     label: 'Loading Circom WASM prover', activeOn: ['proving'], doneOn: ['proof_ready','submitting','submit_error','credential_issued'], errorOn: ['proof_error'], estimatedSeconds: 8  },
  { id: 'circuit',  label: 'Executing circuit',          activeOn: ['proving'], doneOn: ['proof_ready','submitting','submit_error','credential_issued'], errorOn: ['proof_error'], estimatedSeconds: 15 },
  { id: 'groth16',  label: 'Generating Groth16 proof',   activeOn: ['proving'], doneOn: ['proof_ready','submitting','submit_error','credential_issued'], errorOn: ['proof_error'], estimatedSeconds: 20 },
  { id: 'done',     label: 'Proof ready',                activeOn: [],          doneOn: ['proof_ready','submitting','submit_error','credential_issued'], errorOn: [],              estimatedSeconds: 0  },
];

const TOTAL_ESTIMATED = STEPS.reduce((s, step) => s + step.estimatedSeconds, 0);

// Returns the sequential step status based on elapsed time while proving.
// Steps progress one-at-a-time: once accumulated time passes a step's budget, it's "done"
// and the next one becomes "active". All previous steps are "done", future ones are "pending".
function stepStatusForElapsed(
  step: Step,
  index: number,
  status: ProofFlowStatus,
  elapsed: number
): StepStatus {
  // Terminal states — all non-"done" steps show done/error uniformly
  if (step.doneOn.includes(status)) return 'done';
  if (step.errorOn.includes(status)) return 'error';

  // Not currently proving — pending
  if (!step.activeOn.includes(status)) return 'pending';

  // Currently proving — derive sequential step from elapsed time
  let budget = 0;
  for (let i = 0; i < STEPS.length; i++) {
    budget += STEPS[i].estimatedSeconds;
    if (elapsed < budget) {
      // This step's budget hasn't been consumed yet
      if (i === index) return 'active';   // this is the current step
      if (i > index) return 'pending';    // future step
      return 'done';                       // past step
    }
  }
  // All budgets consumed but still proving — last real step is still active
  return index === STEPS.length - 2 ? 'active' : 'done';
}

const DOT: Record<StepStatus, { symbol: string; color: string }> = {
  pending: { symbol: '○', color: 'rgba(247,249,250,0.28)' },
  active:  { symbol: '◌', color: '#f6ad55' },
  done:    { symbol: '●', color: '#68d391' },
  error:   { symbol: '✗', color: '#fc8181' },
};

/** Step 3 — Proof generation timeline with time estimate and submit button. */
export function ProofGenerator({ proof }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);

  // Start timer when proving begins
  useEffect(() => {
    if (proof.status === 'proving') {
      setStartTime(Date.now());
      setElapsed(0);
    } else {
      setStartTime(null);
    }
  }, [proof.status]);

  // Tick every second while proving
  useEffect(() => {
    if (proof.status !== 'proving' || startTime === null) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [proof.status, startTime]);

  const visible = ['dnssec_found','proving','proof_error','proof_ready','submitting','submit_error','credential_issued'].includes(proof.status);
  if (!visible) return null;

  const remaining = Math.max(0, TOTAL_ESTIMATED - elapsed);

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ color: '#f7f9fa', fontSize: '1rem', marginBottom: '0.75rem' }}>
        Step 3 — Generate ZK Proof
      </h3>

      {proof.status === 'proving' && (
        <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.9rem', background: 'rgba(255,255,255,0.06)', borderRadius: '8px', border: '1px solid #2d3748', fontSize: '0.8rem', color: '#a0aec0', display: 'flex', justifyContent: 'space-between' }}>
          <span>⏱ Generating proof in your browser…</span>
          <span style={{ color: '#f6ad55' }}>
            {elapsed}s elapsed · ~{remaining}s remaining
          </span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.75rem' }}>
        {STEPS.map((step, index) => {
          const s = stepStatusForElapsed(step, index, proof.status, elapsed);
          const { symbol, color } = DOT[s];
          return (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color, fontFamily: 'monospace', fontSize: '1rem', width: '16px', textAlign: 'center' }}>
                {s === 'active' ? <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>{symbol}</span> : symbol}
              </span>
              <span style={{ color: s === 'pending' ? 'rgba(247,249,250,0.28)' : s === 'error' ? '#fc8181' : '#f7f9fa', fontSize: '0.875rem' }}>
                {step.label}
              </span>
              {s === 'active' && step.estimatedSeconds > 0 && (
                <span style={{ color: 'rgba(247,249,250,0.28)', fontSize: '0.75rem' }}>~{step.estimatedSeconds}s</span>
              )}
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
          style={{ padding: '8px 18px', fontSize: '0.875rem', border: '1px solid #af50ff', borderRadius: '6px', background: '#af50ff22', color: '#af50ff', cursor: 'pointer', fontWeight: 600 }}
        >
          Generate ZK Proof (~{TOTAL_ESTIMATED}s)
        </button>
      )}

      {proof.status === 'proof_ready' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '500px' }}>
          <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid #2d3748', borderRadius: '8px', padding: '0.75rem', fontSize: '0.8rem' }}>
            <div style={{ color: '#68d391', marginBottom: '0.25rem' }}>✓ Proof generated — ready to submit</div>
            {proof.proofSizeBytes && <div style={{ color: 'rgba(247,249,250,0.58)' }}>Size: {proof.proofSizeBytes} bytes</div>}
            {proof.publicSignals && <div style={{ color: 'rgba(247,249,250,0.58)' }}>{proof.publicSignals.length} public signals</div>}
            <div style={{ color: 'rgba(247,249,250,0.28)', fontSize: '0.73rem', marginTop: '0.4rem' }}>
              Use the "Submit to Soroban" button below to issue your credential.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
