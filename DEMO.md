# Cloakwork — 3-Minute Demo Script

This walkthrough covers the full proof-to-credential-to-gated-action flow.
All three contracts must be deployed on Stellar testnet before running this demo
(see [DEPLOYMENT.md](./DEPLOYMENT.md)).

---

## Before you start

1. Have Freighter wallet installed and funded with testnet XLM
2. Have a domain with DNSSEC enabled (e.g. Cloudflare-managed domain)
3. Contracts deployed and `.env` configured

---

## Step 1 — Connect wallet (15 seconds)

1. Open the app (`npm start` → `http://localhost:3000`)
2. Click **Connect Wallet**
3. Select Freighter in the modal
4. Approve the connection
5. ✓ Your truncated address appears in the header (e.g. `GABC12...X7Z9`)

---

## Step 2 — Generate DNS challenge (30 seconds)

1. Click the **Create Proof** tab
2. The "What is public vs private?" panel shows what stays off-chain
3. Enter your domain name in the input (e.g. `acme.com`)
4. Click **Generate Challenge**
5. ✓ Two values appear:
   - Record name: `_stellar-cloakwork.acme.com`
   - Record value: `clkwk:v1:<hex>:<hex>`
6. Copy both values — add this TXT record to your DNS provider

**What judges should note:** The domain name `acme.com` never gets sent anywhere.
Only Poseidon hashes appear in the challenge.

---

## Step 3 — Verify DNSSEC record (30 seconds)

1. After publishing the TXT record, click **Check DNSSEC Record**
2. App queries Cloudflare DoH with `do=1` flag
3. ✓ "DNSSEC material found" — RRSIG validity window displayed
4. If error: check the record was published correctly; DNS propagation can take up to 5 minutes

---

## Step 4 — Generate ZK proof (45 seconds)

1. Click **Generate ZK Proof**
2. Status timeline appears: Preparing → Loading WASM → Executing circuit → Groth16 → Ready
3. Proof runs in a Web Worker — UI stays responsive
4. ✓ "Proof ready" — proof size and 8 public signals displayed

**What judges should note:** The domain name, DNSSEC material, nonce, and secret
stayed in the Web Worker. Only the 8 public signal values are visible.

---

## Step 5 — Submit to Soroban (30 seconds)

1. Click **Submit to Soroban →**
2. Freighter opens — review and approve the transaction
3. Transaction submits to Stellar testnet
4. ✓ Credential card appears:
   - Status: **Active** (green)
   - Owner: your Stellar address
   - Commitment: `0x1a2b…` (Poseidon hash of domain)
   - Nullifier: `0x3c4d…`
   - Expires: 30 days from now
   - Explorer link to the `verify_and_issue` transaction

---

## Step 6 — Use the credential (30 seconds)

1. Click **Gated Action** tab
2. Your Active credential is shown
3. Click **Create Verified Merchant Payment Intent**
4. Approve the Freighter transaction
5. ✓ Success — Soroban event emitted:
   - `action_executed` event with `owner`, `domain_commitment`, `payload`
6. Explorer link to the transaction shows the event data

**What judges should note:**
- The `gated_action_demo` contract never learned the domain name
- It only called `CloakworkClient::require_valid_credential` — one line of Rust
- Any Stellar contract can do the same by importing `cloakwork-sdk`

---

## Total time: ~3 minutes

---

## What this demonstrates

| Claim | Proof |
|---|---|
| ZK is load-bearing | No credential without valid Groth16 proof |
| Domain never on-chain | Check any transaction — no domain string anywhere |
| Real Soroban verification | `cloakwork_verifier` uses BN254 `pairing_check` |
| Nullifier prevents replay | Submit same proof twice → `NullifierAlreadyUsed` |
| SDK composability | `gated_action_demo` uses `cloakwork-sdk` in 1 line |
| Full credential lifecycle | Active → Revoke → Rejected by gated action |
