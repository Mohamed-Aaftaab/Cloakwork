#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl, symbol_short, testutils::Address as _, Address, Bytes, Env, IntoVal,
    Val, Vec as SVec,
};

use crate::{Config, DataKey, Error, ZkDnssec, ZkDnssecClient};

/// A mock RISC0 verifier contract standing in for
/// https://github.com/NethermindEth/stellar-risc0-verifier in tests — it just
/// returns whatever boolean it's configured to return, so the wrapper
/// contract's logic can be tested without a real Groth16 proof.
#[contract]
pub struct MockRisc0Verifier;

#[contractimpl]
impl MockRisc0Verifier {
    pub fn set_result(env: Env, result: bool) {
        env.storage().instance().set(&symbol_short!("result"), &result);
    }

    pub fn verify(env: Env, _image_id: Bytes, _journal: Bytes, _seal: Bytes) -> bool {
        env.storage()
            .instance()
            .get(&symbol_short!("result"))
            .unwrap_or(false)
    }
}

fn setup(env: &Env) -> (Address, Address, ZkDnssecClient) {
    let admin = Address::generate(env);
    let verifier_id = env.register(MockRisc0Verifier, ());
    let contract_id = env.register(ZkDnssec, ());
    let client = ZkDnssecClient::new(env, &contract_id);
    (admin, verifier_id, client)
}

fn encode_journal(env: &Env, is_valid: bool) -> Bytes {
    // Mirrors alloy's ABI encoding of `PublicValuesStruct { is_valid: bool }`:
    // a single non-zero/zero trailing byte is all `decode_is_valid` inspects.
    let mut bytes = Bytes::new(env);
    for _ in 0..31 {
        bytes.push_back(0);
    }
    bytes.push_back(if is_valid { 1 } else { 0 });
    bytes
}

#[test]
fn init_then_get_config_round_trips() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, verifier_id, client) = setup(&env);
    let image_id = Bytes::from_array(&env, &[7u8; 32]);

    client.init(&admin, &verifier_id, &image_id);
    let config = client.get_config();

    assert_eq!(config.admin, admin);
    assert_eq!(config.verifier, verifier_id);
    assert_eq!(config.image_id, image_id);
}

#[test]
fn init_twice_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, verifier_id, client) = setup(&env);
    let image_id = Bytes::from_array(&env, &[7u8; 32]);

    client.init(&admin, &verifier_id, &image_id);
    let result = client.try_init(&admin, &verifier_id, &image_id);
    assert!(result.is_err());
}

#[test]
fn decode_is_valid_true() {
    let env = Env::default();
    let (admin, verifier_id, client) = setup(&env);
    env.mock_all_auths();
    let image_id = Bytes::from_array(&env, &[7u8; 32]);
    client.init(&admin, &verifier_id, &image_id);

    let journal = encode_journal(&env, true);
    assert_eq!(client.decode_is_valid(&journal), true);
}

#[test]
fn decode_is_valid_false() {
    let env = Env::default();
    let (admin, verifier_id, client) = setup(&env);
    env.mock_all_auths();
    let image_id = Bytes::from_array(&env, &[7u8; 32]);
    client.init(&admin, &verifier_id, &image_id);

    let journal = encode_journal(&env, false);
    assert_eq!(client.decode_is_valid(&journal), false);
}

#[test]
fn verify_dnssec_record_true_when_verifier_accepts_and_journal_is_valid() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, verifier_id, client) = setup(&env);
    let verifier_client = MockRisc0VerifierClient::new(&env, &verifier_id);
    verifier_client.set_result(&true);

    let image_id = Bytes::from_array(&env, &[7u8; 32]);
    client.init(&admin, &verifier_id, &image_id);

    let journal = encode_journal(&env, true);
    let seal = Bytes::from_array(&env, &[9u8; 32]);

    assert_eq!(client.verify_dnssec_record(&journal, &seal), true);
}

#[test]
fn verify_dnssec_record_false_when_verifier_rejects() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, verifier_id, client) = setup(&env);
    let verifier_client = MockRisc0VerifierClient::new(&env, &verifier_id);
    verifier_client.set_result(&false);

    let image_id = Bytes::from_array(&env, &[7u8; 32]);
    client.init(&admin, &verifier_id, &image_id);

    let journal = encode_journal(&env, true);
    let seal = Bytes::from_array(&env, &[9u8; 32]);

    assert_eq!(client.verify_dnssec_record(&journal, &seal), false);
}

#[test]
fn set_config_requires_admin_auth() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, verifier_id, client) = setup(&env);
    let image_id = Bytes::from_array(&env, &[7u8; 32]);
    client.init(&admin, &verifier_id, &image_id);

    let new_verifier = Address::generate(&env);
    let new_image_id = Bytes::from_array(&env, &[8u8; 32]);
    client.set_config(&new_verifier, &new_image_id);

    let config = client.get_config();
    assert_eq!(config.verifier, new_verifier);
    assert_eq!(config.image_id, new_image_id);
}
