@echo off
REM Build script for Rust + WebAssembly noise generator (Windows)

echo 🦀 Building Rust WebAssembly module...

REM Check if wasm-pack is installed
wasm-pack --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ wasm-pack is not installed. Please install it first:
    echo    cargo install wasm-pack
    echo    or download from: https://rustwasm.github.io/wasm-pack/installer/
    exit /b 1
)

REM Build the WebAssembly module
wasm-pack build --target web --out-dir pkg

if %errorlevel% equ 0 (
    echo ✅ WebAssembly build completed successfully!
    echo 📦 Generated files are in the 'pkg' directory
    echo 🚀 You can now open index.html in a web browser
) else (
    echo ❌ Build failed. Please check the error messages above.
    exit /b 1
)
