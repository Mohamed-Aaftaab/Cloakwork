fn main() {
    // Builds the `zkdnssec-program` guest crate into a RISC0 ELF + image ID,
    // embedded into this host binary at compile time. Analogue of the SP1
    // `build.rs` that embedded the SP1 guest ELF.
    risc0_build::embed_methods();
}

