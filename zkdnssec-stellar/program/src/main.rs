#![no_main]
risc0_zkvm::guest::entry!(main);

use alloy_sol_types::SolType;
use zkdnssec_lib::{
    rr::{dns_class::DNSClass, dnssec::rdata::sig::SIG, domain::name::Name, resource::Record},
    verify_rrsig, PublicValuesStruct,
};

/// Guest entrypoint for the zkDNSSEC RISC0 program.
///
/// Reads the DNSSEC record set, its RRSIG, and the zone's public key from the
/// host, runs the same canonicalization + signature check used by the rest of
/// `zkdnssec-lib`, and commits only `is_valid` as a public output. None of the
/// inputs (record contents, signature bytes, signer name) ever leave the guest.
pub fn main() {
    let public_key: Vec<u8> = risc0_zkvm::guest::env::read();
    let name: Name = risc0_zkvm::guest::env::read();
    let dns_class: DNSClass = risc0_zkvm::guest::env::read();
    let sig: SIG = risc0_zkvm::guest::env::read();
    let record: Record = risc0_zkvm::guest::env::read();
    let signature: Vec<u8> = risc0_zkvm::guest::env::read();

    let is_valid = verify_rrsig(public_key, &name, dns_class, &sig, &[record], signature);

    let bytes = PublicValuesStruct::abi_encode(&PublicValuesStruct { is_valid });

    risc0_zkvm::guest::env::commit_slice(&bytes);
}
