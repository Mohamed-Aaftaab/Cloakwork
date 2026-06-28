#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl, symbol_short, testutils::Address as _, Address, Bytes, Env, Vec,
};

use crate::{ZkDnssecUltraHonk, ZkDnssecUltraHonkClient};

#[contract]
pub struct MockUltraHonkVerifier;

#[contractimpl]
impl MockUltraHonkVerifier {
    pub fn set_result(env: Env, result: bool) {
        env.storage().instance().set(&symbol_short!("result"), &result);
    }

    pub fn verify(env: Env, _vk: Bytes, _public_inputs: Vec<Bytes>, _proof: Bytes) -> bool {
        env.storage()
            .instance()
            .get(&symbol_short!("result"))
            .unwrap_or(false)
    }
}

fn setup(env: &Env) -> (Address, Address, ZkDnssecUltraHonkClient) {
    let admin = Address::generate(env);
    let verifier_id = env.register(MockUltraHonkVerifier, ());
    let contract_id = env.register(ZkDnssecUltraHonk, ());
    let client = ZkDnssecUltraHonkClient::new(env, &contract_id);
    (admin, verifier_id, client)
}

#[test]
fn init_then_get_config_round_trips() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, verifier_id, client) = setup(&env);
    let vk = Bytes::from_array(&env, &[3u8; 16]);

    client.init(&admin, &verifier_id, &vk);
    let config = client.get_config();

    assert_eq!(config.admin, admin);
    assert_eq!(config.verifier, verifier_id);
    assert_eq!(config.vk, vk);
}

#[test]
fn verify_dnssec_record_passes_through_verifier_result_true() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, verifier_id, client) = setup(&env);
    let verifier_client = MockUltraHonkVerifierClient::new(&env, &verifier_id);
    verifier_client.set_result(&true);

    let vk = Bytes::from_array(&env, &[3u8; 16]);
    client.init(&admin, &verifier_id, &vk);

    let public_inputs = Vec::from_array(&env, [Bytes::from_array(&env, &[1u8; 32])]);
    let proof = Bytes::from_array(&env, &[2u8; 64]);

    assert_eq!(client.verify_dnssec_record(&public_inputs, &proof), true);
}

#[test]
fn verify_dnssec_record_passes_through_verifier_result_false() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, verifier_id, client) = setup(&env);
    let verifier_client = MockUltraHonkVerifierClient::new(&env, &verifier_id);
    verifier_client.set_result(&false);

    let vk = Bytes::from_array(&env, &[3u8; 16]);
    client.init(&admin, &verifier_id, &vk);

    let public_inputs = Vec::from_array(&env, [Bytes::from_array(&env, &[1u8; 32])]);
    let proof = Bytes::from_array(&env, &[2u8; 64]);

    assert_eq!(client.verify_dnssec_record(&public_inputs, &proof), false);
}
