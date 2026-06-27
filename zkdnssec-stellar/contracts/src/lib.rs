//! zkDNSSEC verifier wrapper for Soroban.
//!
//! Plays the same role as `ZKDNSSEC.sol` did against `ISP1VerifierGateway` on EVM:
//! this contract stores a pointer to a deployed RISC0 Groth16 verifier contract
//! plus the zkDNSSEC guest program's image ID, and exposes a single entrypoint
//! that verifies a proof and decodes its public output.
//!
//! The actual Groth16 pairing/Poseidon verification is delegated to a deployed
//! instance of the RISC0 verifier from
//! https://github.com/NethermindEth/stellar-risc0-verifier — this contract does
//! not reimplement pairing checks, it only wires the proof through and decodes
//! the result, matching `bytes32ToBool` from the original Solidity contract.
#![no_std]

#[cfg(test)]
mod test;


use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, Env,
    IntoVal,
};

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,
    /// Address of the deployed RISC0 Groth16 verifier contract on this network.
    pub verifier: Address,
    /// 32-byte RISC0 image ID of the zkdnssec-program guest binary.
    pub image_id: Bytes,
}

#[contracttype]
pub enum DataKey {
    Config,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    InvalidPublicValues = 3,
}

#[contract]
pub struct ZkDnssec;

#[contractimpl]
impl ZkDnssec {
    /// One-time setup. Mirrors the Solidity constructor
    /// `constructor(address _verifier, bytes32 _zkDNSSECProgramVKey)`.
    pub fn init(env: Env, admin: Address, verifier: Address, image_id: Bytes) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                admin,
                verifier,
                image_id,
            },
        );
        Ok(())
    }

    pub fn get_config(env: Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }

    /// Admin-only: rotate the verifier address or image ID (e.g. after a guest
    /// program upgrade). Not present in the original (immutable in Solidity);
    /// added since Soroban storage makes this cheap and upgrades are otherwise
    /// painful for a hackathon-stage project.
    pub fn set_config(env: Env, verifier: Address, image_id: Bytes) -> Result<(), Error> {
        let mut config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        config.admin.require_auth();
        config.verifier = verifier;
        config.image_id = image_id;
        env.storage().instance().set(&DataKey::Config, &config);
        Ok(())
    }

    /// Decode the guest's committed public output. The journal is the ABI
    /// encoding of `PublicValuesStruct { is_valid: bool }` from
    /// `zkdnssec-lib` — a single byte (0 or non-zero) is enough to recover it,
    /// same as `bytes32ToBool` did for the EVM contract's public-values word.
    pub fn decode_is_valid(_env: Env, public_values: Bytes) -> Result<bool, Error> {
        if public_values.is_empty() {
            return Err(Error::InvalidPublicValues);
        }
        Ok(public_values.get(public_values.len() - 1).unwrap_or(0) != 0)
    }

    /// The entrypoint for verifying the proof of a record. Mirrors
    /// `verifyDNSSECRecord(bytes calldata _publicValues, bytes calldata _proofBytes)`.
    ///
    /// `proof_seal` is the Groth16 seal bytes produced by the host prover
    /// (`scripts/`); `public_values` is the ABI-encoded journal. Verification
    /// of the seal itself is delegated to the configured RISC0 verifier
    /// contract via cross-contract call.
    pub fn verify_dnssec_record(
        env: Env,
        public_values: Bytes,
        proof_seal: Bytes,
    ) -> Result<bool, Error> {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;

        // Cross-contract call into the deployed RISC0 Groth16 verifier.
        // The exact function name/signature comes from
        // https://github.com/NethermindEth/stellar-risc0-verifier — wired here
        // as `verify_groth16(image_id, journal, seal) -> bool` pending that
        // crate's published client bindings; swap this call for the generated
        // client once the verifier contract is vendored.
        let args = (config.image_id.clone(), public_values.clone(), proof_seal);
        let verified: bool =
            env.invoke_contract(&config.verifier, &symbol_short!("verify"), args.into_val(&env));

        if !verified {
            return Ok(false);
        }

        Self::decode_is_valid(env, public_values)
    }
}
