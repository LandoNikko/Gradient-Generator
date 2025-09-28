# Gradient Generator

A gradient generator prototype built with **Rust + WebAssembly** for creative visual effects.

Try it here: https://landonikko.github.io/Gradient-Generator

![Gradient Generator](https://img.shields.io/badge/Rust-WebAssembly-orange?style=flat-square&logo=rust)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

![Banner image](https://i.imgur.com/59zO7CO.png)

## Features

**Rust + WebAssembly**  
Gradient generation

**Real-time Controls**  
Sliders, presets

**Interactive Canvas**  
Drag to pan and scroll to zoom

## Quick Start

### Option 1 - **[Live Demo](https://landonikko.github.io/Gradient-Generator)**

### Option 2 - Local Use

1. `git clone https://github.com/LandoNikko/Gradient-Generator.git`
2. `python -m http.server 8000` or open `index.html`

### Option 3 - Build from Source

**Install Prerequisites**
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install wasm-pack
cargo install wasm-pack
```

**Build the Project**
```bash
# Windows
build.bat

# Unix/Linux/macOS
wasm-pack build --target web --out-dir pkg --release
```

## Development

### Structure
```
├── index.html         # Main web interface
├── app.js             # Logic
├── styles.css         # Styling
├── Cargo.toml         # Rust project configuration
├── build.bat          # Windows build script
├── src/
│   └── lib.rs         # Rust WebAssembly source
└── pkg/               # Generated WebAssembly files
    ├── gradient_noise_wasm.js
    ├── gradient_noise_wasm_bg.wasm
    └── *.d.ts
```

### Stack

**Rust**  
Core gradient algorithms

**WebAssembly**  
Browser performance

**SIMD**  
Parallel processing

**Rayon**  
Multi-core utilization

## Contributing

Fork, create a feature branch, make changes and submit a pull request.

## License

MIT License - see LICENSE file for details