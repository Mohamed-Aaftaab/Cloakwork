//! Stretch-goal alternative to `contracts/` (PRD §9): wraps a deployed
//! UltraHonk verifier instead of the RISC0 Groth16 verifier, for proofs
//! produced by the Noir circuit in `../noir-circuit`. Same shape as
//! `zkdnssec-contract::ZkDnssec` — kept as a separate crate since it targets
//! a different verifier contract
//! (https://github.com/yugocabrio/rs-soroban-ultrahonk or
//! https://github.com/indextree/ultrahonk_soroban_contract) and a different
//! public-input encoding (Noir's flat field-element array rather than an
//! ABI-encoded journal).
#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, Env, IntoVal, Vec};

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,
    /// Address of the deployed UltraHonk verifier contract.
    pub verifier: Address,
    /// Noir circuit's verification key bytes.
    pub vk: Bytes,
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
}

#[contract]
pub struct ZkDnssecUltraHonk;

#[contractimpl]
impl ZkDnssecUltraHonk {
    pub fn init(env: Env, admin: Address, verifier: Address, vk: Bytes) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Config, &Config { admin, verifier, vk });
        Ok(())
    }

    pub fn get_config(env: Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }

    /// `public_inputs` is the single `bool`-as-field-element output of the
    /// Noir circuit in `../noir-circuit` (the ECDSA check result);
    /// `proof` is the UltraHonk proof bytes.
    pub fn verify_dnssec_record(
        env: Env,
        public_inputs: Vec<Bytes>,
        proof: Bytes,
    ) -> Result<bool, Error> {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;

        let args = (config.vk.clone(), public_inputs, proof);
        let verified: bool =
            env.invoke_contract(&config.verifier, &symbol_short!("verify"), args.into_val(&env));

        Ok(verified)
    }
}
