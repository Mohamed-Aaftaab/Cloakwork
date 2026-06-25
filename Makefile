.PHONY: build test clean

build:
	stellar contract build

test:
	cargo test --workspace

clippy:
	cargo clippy --workspace -- -D warnings

clean:
	cargo clean
