import { useState, useCallback, useRef } from 'react';
import { deriveCommitment, formatTxtRecord } from '../utils/commitments';
import { fetchDNSSECMaterial, DNSSECMaterial } from '../utils/dnssec';

// ─── State machine types ─────────────────────────────────────────────────────

export type ProofFlowStatus =
  | 'idle'
  | 'challenge_generated'
  | 'dnssec_checking'
  | 'dnssec_found'
  | 'dnssec_error'
  | 'proving'
  | 'proof_error'
  | 'proof_ready'
  | 'submitting'
  | 'submit_error'
  | 'credential_issued';

export interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
}

/**
 * Flat state interface for the proof flow state machine.
 *
 * PRIVACY NOTE: `nonce`, `secret`, and raw DNSSEC bytes are stored
 * in a React ref (`privateRef`) — not in this state object. They are
 * therefore never serialised to sessionStorage or included in any
 * transaction payload.
 */
export interface ProofState {
  status: ProofFlowStatus;
  domain: string | null;
  /** Hex-encoded owner commitment (Poseidon(addr_bytes, nonce)) */
  ownerCommitment: string | null;
  /** Hex-encoded nonce commitment (Poseidon(domain_bytes, nonce)) */
  nonceCommitment: string | null;
  /** DNS name where the TXT challenge record must be published */
  txtRecordName: string | null;
  /** Full TXT record value: clkwk:v1:<owner_hex>:<nonce_hex> */
  txtRecordValue: string | null;
  /**
   * DNSSEC material (notBefore/notAfter timestamps + encoded wire bytes).
   * Stored here so the state machine can display validity windows.
   * The raw rrset/rrsig/dnskey bytes are also held in privateRef to avoid
   * accidental inclusion in serialised state.
   */
  dnssecMaterial: DNSSECMaterial | null;
  /** Groth16 proof returned by the Web Worker */
  proof: Groth16Proof | null;
  /** Public signals returned by the Web Worker (decimal strings) */
  publicSignals: string[] | null;
  /** Byte length of the proof JSON — displayed in the UI */
  proofSizeBytes: number | null;
  /** Human-readable error message, null when no error */
  error: string | null;
}

export interface CloakworkProofActions {
  /**
   * Generate nonce + secret, derive commitments, and transition to
   * `challenge_generated`. Nonce and secret are stored in privateRef only.
   */
  generateChallenge: (domain: string, walletAddress: string) => Promise<void>;
  /**
   * Fetch DNSSEC material for the stored domain via Cloudflare DoH.
   * Transitions: `challenge_generated` → `dnssec_checking` → `dnssec_found`
   * or `dnssec_error`.
   */
  checkDNSSEC: () => Promise<void>;
  /**
   * Dispatch proof generation to the Web Worker.
   * Transitions: `dnssec_found` → `proving` → `proof_ready` or `proof_error`.
   */
  generateProof: () => Promise<void>;
  /** Reset to `idle` and clear all private data and sessionStorage. */
  reset: () => void;
}

export type CloakworkProofHook = ProofState & CloakworkProofActions;

// ─── Private data held in a ref ──────────────────────────────────────────────

interface PrivateData {
  nonce: Uint8Array;
  secret: Uint8Array;
  walletAddress: string;
  dnssecMaterial: DNSSECMaterial | null;
}

// ─── Session storage (public challenge data only) ────────────────────────────

const SESSION_KEY = 'cloakwork_proof_state';

type SerializableSession = Pick<
  ProofState,
  | 'status'
  | 'domain'
  | 'ownerCommitment'
  | 'nonceCommitment'
  | 'txtRecordName'
  | 'txtRecordValue'
>;

function saveToSession(data: SerializableSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    // sessionStorage unavailable — proceed without persistence
  }
}

function loadFromSession(): Partial<SerializableSession> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Partial<SerializableSession>) : {};
  } catch {
    return {};
  }
}

// ─── Initial state ───────────────────────────────────────────────────────────

function buildInitialState(): ProofState {
  const saved = loadFromSession();
  // Only restore challenge-generated state — not proving/proof_ready states,
  // since the private keys are not persisted and cannot be recovered.
  const restorable: ProofFlowStatus[] = ['idle', 'challenge_generated'];
  const status: ProofFlowStatus =
    saved.status && restorable.includes(saved.status as ProofFlowStatus)
      ? (saved.status as ProofFlowStatus)
      : 'idle';

  return {
    status,
    domain: saved.domain ?? null,
    ownerCommitment: saved.ownerCommitment ?? null,
    nonceCommitment: saved.nonceCommitment ?? null,
    txtRecordName: saved.txtRecordName ?? null,
    txtRecordValue: saved.txtRecordValue ?? null,
    dnssecMaterial: null,
    proof: null,
    publicSignals: null,
    proofSizeBytes: null,
    error: null,
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Manages the full Cloakwork proof flow state machine:
 *
 * ```
 * idle
 *   → challenge_generated  (generateChallenge)
 *   → dnssec_checking      (checkDNSSEC starts)
 *   → dnssec_found         (DNSSEC ok)
 *   → dnssec_error         (DNSSEC failure — retry via checkDNSSEC)
 *   → proving              (generateProof starts)
 *   → proof_ready          (Worker finished)
 *   → proof_error          (Worker error — retry via generateProof)
 *   → submitting           (UI-driven, external state transition)
 *   → submit_error         (contract error)
 *   → credential_issued    (success)
 * ```
 *
 * Private data (nonce, secret, raw DNSSEC bytes) is stored in a `useRef`
 * and is NEVER written to sessionStorage, React state, or any network payload.
 * Only public commitment hex strings and the challenge metadata are persisted
 * across page reloads.
 */
export function useCloakworkProof(): CloakworkProofHook {
  const [state, setState] = useState<ProofState>(buildInitialState);

  // Private data ref — nonce and secret must never reach serialised state
  const privateRef = useRef<PrivateData>({
    nonce: new Uint8Array(32),
    secret: new Uint8Array(32),
    walletAddress: '',
    dnssecMaterial: null,
  });

  // ── Internal helpers ─────────────────────────────────────────────────────

  const setStatus = useCallback((
    status: ProofFlowStatus,
    patch: Partial<ProofState> = {}
  ) => {
    setState(prev => {
      const next: ProofState = { ...prev, status, error: null, ...patch };
      // Persist only the public challenge fields to sessionStorage
      saveToSession({
        status: next.status,
        domain: next.domain,
        ownerCommitment: next.ownerCommitment,
        nonceCommitment: next.nonceCommitment,
        txtRecordName: next.txtRecordName,
        txtRecordValue: next.txtRecordValue,
      });
      return next;
    });
  }, []);

  const setError = useCallback((status: ProofFlowStatus, error: string) => {
    setState(prev => ({ ...prev, status, error }));
  }, []);

  // ── generateChallenge ────────────────────────────────────────────────────

  const generateChallenge = useCallback(async (
    domain: string,
    walletAddress: string
  ): Promise<void> => {
    // Generate cryptographically random nonce and secret — stays in ref only
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const secret = crypto.getRandomValues(new Uint8Array(32));

    // Store privately — never goes into state or sessionStorage
    privateRef.current = { nonce, secret, walletAddress, dnssecMaterial: null };

    // Derive commitments using the existing Poseidon-based utilities
    const domainBytes = new TextEncoder().encode(domain);
    const addrBytes = new TextEncoder().encode(walletAddress);

    const ownerCommitmentBytes = await deriveCommitment(addrBytes, nonce);
    const nonceCommitmentBytes = await deriveCommitment(domainBytes, nonce);

    const txtRecordName = `_stellar-cloakwork.${domain}`;
    const txtRecordValue = formatTxtRecord(ownerCommitmentBytes, nonceCommitmentBytes);

    // Convert commitment bytes to hex strings for state/display
    const toHex = (b: Uint8Array) =>
      Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');

    setStatus('challenge_generated', {
      domain,
      ownerCommitment: toHex(ownerCommitmentBytes),
      nonceCommitment: toHex(nonceCommitmentBytes),
      txtRecordName,
      txtRecordValue,
    });
  }, [setStatus]);

  // ── checkDNSSEC ──────────────────────────────────────────────────────────

  const checkDNSSEC = useCallback(async (): Promise<void> => {
    const domain = state.domain;
    if (!domain) {
      setError('dnssec_error', 'No domain set — generate a challenge first');
      return;
    }
    setStatus('dnssec_checking');
    try {
      const material = await fetchDNSSECMaterial(domain);
      // Store the full material (including raw bytes) in the private ref
      privateRef.current = { ...privateRef.current, dnssecMaterial: material };
      // Only expose the timestamps and metadata in state — raw bytes stay private
      setStatus('dnssec_found', {
        dnssecMaterial: {
          rrset: material.rrset,
          rrsig: material.rrsig,
          dnskey: material.dnskey,
          notBefore: material.notBefore,
          notAfter: material.notAfter,
        },
      });
    } catch (err: unknown) {
      setError('dnssec_error', err instanceof Error ? err.message : 'DNSSEC check failed');
    }
  }, [state.domain, setStatus, setError]);

  // ── generateProof ────────────────────────────────────────────────────────

  const generateProof = useCallback(async (): Promise<void> => {
    const { domain, ownerCommitment } = state;
    const { nonce, secret, walletAddress, dnssecMaterial } = privateRef.current;

    if (!domain || !dnssecMaterial) {
      setError('proof_error', 'Missing domain or DNSSEC material — complete previous steps first');
      return;
    }
    if (!nonce.some(b => b !== 0) || !secret.some(b => b !== 0)) {
      // After a page reload the nonce/secret are zeroed — user must regenerate
      setError('proof_error', 'Private keys not available — please generate a new challenge');
      return;
    }
    if (!walletAddress) {
      setError('proof_error', 'Wallet address not available — please generate a new challenge');
      return;
    }

    setStatus('proving');
    try {
      const result = await runProverWorker({
        challenge: {
          domain,
          nonce: Array.from(nonce),
          secret: Array.from(secret),
          walletAddress,
          ownerCommitment: ownerCommitment ?? '',
          verifierVersion: 1,
        },
        dnssecMaterial: {
          rrset: Array.from(dnssecMaterial.rrset),
          dnskey: Array.from(dnssecMaterial.dnskey),
          notBefore: dnssecMaterial.notBefore,
          notAfter: dnssecMaterial.notAfter,
        },
      });

      const proofJson = JSON.stringify(result.proof);
      setStatus('proof_ready', {
        proof: result.proof,
        publicSignals: result.publicSignals,
        proofSizeBytes: new TextEncoder().encode(proofJson).length,
      });
    } catch (err: unknown) {
      setError('proof_error', err instanceof Error ? err.message : 'Proof generation failed');
    }
  // Narrow deps: only domain + ownerCommitment from state; ref reads are stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.domain, state.ownerCommitment, setStatus, setError]);

  // ── reset ────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    // Overwrite private ref before clearing — defensive scrub
    privateRef.current = {
      nonce: new Uint8Array(32),
      secret: new Uint8Array(32),
      walletAddress: '',
      dnssecMaterial: null,
    };
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    setState({
      status: 'idle',
      domain: null,
      ownerCommitment: null,
      nonceCommitment: null,
      txtRecordName: null,
      txtRecordValue: null,
      dnssecMaterial: null,
      proof: null,
      publicSignals: null,
      proofSizeBytes: null,
      error: null,
    });
  }, []);

  return {
    ...state,
    generateChallenge,
    checkDNSSEC,
    generateProof,
    reset,
  };
}

// ─── Web Worker bridge ───────────────────────────────────────────────────────

interface WorkerPayload {
  challenge: {
    domain: string;
    nonce: number[];
    secret: number[];
    walletAddress: string;
    ownerCommitment: string;
    /** Circuit version to use — defaults to 1 */
    verifierVersion: number;
  };
  dnssecMaterial: {
    rrset: number[];
    // rrsig is validated on the frontend (timestamp window) but not consumed by the circuit
    dnskey: number[];
    notBefore: number;
    notAfter: number;
  };
}

interface WorkerResult {
  proof: Groth16Proof;
  publicSignals: string[];
}

function runProverWorker(payload: WorkerPayload): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../workers/prover.worker.js', import.meta.url)
    );

    worker.onmessage = (e: MessageEvent<WorkerResult | { error: string }>) => {
      worker.terminate();
      if ('error' in e.data) {
        reject(new Error(e.data.error));
      } else {
        resolve(e.data);
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message ?? 'Worker error'));
    };

    worker.postMessage(payload);
  });
}
