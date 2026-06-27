// M2: --execute path wired up
use std::path::PathBuf;

use alloy_sol_types::SolType;
use clap::{Parser, ValueEnum};

pub mod helpers;
pub mod table;

use risc0_zkvm::{default_prover, ExecutorEnv, ProverOpts, Receipt};
use serde::{Deserialize, Serialize};
use table::Report;
use zkdnssec_lib::PublicValuesStruct;

use helpers::generate_inputs;

/// Image ID + ELF embedded by `risc0_build::embed_methods()` at build time —
/// the RISC0 analogue of SP1's `include_elf!("zkdnssec-program")`.
pub mod methods {
    include!(concat!(env!("OUT_DIR"), "/methods.rs"));
}
use methods::ZKDNSSEC_PROGRAM_ELF;

#[derive(Clone, Debug, ValueEnum, PartialEq, Eq)]
pub enum ProofType {
    /// Non-chain-verifiable STARK receipt — analogue of SP1 "Core".
    Succinct,
    /// Chain-verifiable Groth16-wrapped receipt — the only mode the Soroban
    /// verifier consumes. Analogue of SP1 "Groth16". (RISC0 has no PLONK mode.)
    Groth16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ZkDnssecProofFixture {
    is_valid: bool,
    image_id: String,
    public_values: String,
    proof: String,
}

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// String argument for domain
    #[arg(long, default_value = "example.com")]
    domain: String,

    /// String for name to search for
    #[arg(long, default_value = "example.com")]
    name: String,

    /// Flag to execute
    #[arg(long)]
    execute: bool,

    /// Flag to prove
    #[arg(long)]
    prove: bool,

    /// Proof mode (enum)
    #[arg(value_enum, default_value_t = ProofType::Succinct)]
    mode: ProofType,

    /// Flag to print report
    #[arg(long)]
    print_report: bool,

    /// Flag to verify
    #[arg(long, default_value_t = false)]
    verify: bool,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv::dotenv().ok();
    let args = Args::parse();
    let inputs = generate_inputs(&args.domain, &args.name)?;

    if args.execute == args.prove {
        eprintln!("Error: You must specify either --execute or --prove");
        std::process::exit(1);
    }

    // Build the guest's input frame.
    // 1. Public Key  2. Name  3. DNSClass  4. RRSIG  5. Records  6. Signature
    let env = ExecutorEnv::builder()
        .write(&inputs.pub_key)?
        .write(&inputs.name)?
        .write(&inputs.dns_class)?
        .write(&inputs.rrsig)?
        .write(&inputs.record)?
        .write(&inputs.signature)?
        .build()?;

    let prover = default_prover();

    if args.execute {
        let info = prover.execute(env, ZKDNSSEC_PROGRAM_ELF)?;
        let decoded = PublicValuesStruct::abi_decode(info.journal.as_slice(), true)?;

        println!("RRSIG Verified: {:#?}", decoded.is_valid);
        println!("executed program with {} cycles", info.cycles);

        if args.print_report {
            let report = Report::from_execution_report(info);
            report.print_table();
        }
    }

    if args.prove {
        let opts = match args.mode {
            ProofType::Succinct => ProverOpts::succinct(),
            ProofType::Groth16 => ProverOpts::groth16(),
        };

        let prove_info = prover.prove_with_opts(env, ZKDNSSEC_PROGRAM_ELF, &opts)?;
        let receipt: Receipt = prove_info.receipt;

        let proof_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("./proofs");
        std::fs::create_dir_all(&proof_path).expect("failed to create proof path");

        let mode_name = format!("{:?}", args.mode).to_lowercase();
        std::fs::write(
            proof_path.join(format!("{mode_name}-proof.bin")),
            bincode::serialize(&receipt)?,
        )
        .expect("Failed to save proof");

        if args.mode == ProofType::Groth16 {
            let bytes = receipt.journal.bytes.as_slice();
            let pub_values = PublicValuesStruct::abi_decode(bytes, false)?;

            // Create the testing fixture so we can test things end-to-end against
            // the Soroban verifier, mirroring the original repo's Groth16/PLONK fixtures.
            let fixture = ZkDnssecProofFixture {
                is_valid: pub_values.is_valid,
                image_id: hex::encode(
                    risc0_zkvm::compute_image_id(ZKDNSSEC_PROGRAM_ELF)?.as_bytes(),
                ),
                public_values: format!("0x{}", hex::encode(bytes)),
                proof: format!("0x{}", hex::encode(receipt.inner.groth16()?.seal.clone())),
            };

            let fixture_path =
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures");
            std::fs::create_dir_all(&fixture_path).expect("failed to create fixture path");
            std::fs::write(
                fixture_path.join("groth16-fixture.json"),
                serde_json::to_string_pretty(&fixture)?,
            )
            .expect("failed to write fixture");
        }

        println!("Successfully generated proof!");
        if args.verify {
            receipt.verify(risc0_zkvm::compute_image_id(ZKDNSSEC_PROGRAM_ELF)?)?;
            println!("Successfully verified proof!");
        }
    }

    Ok(())
}


// --prove groth16 path: wraps receipt as Groth16 SNARK for Soroban

