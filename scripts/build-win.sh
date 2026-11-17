#!/usr/bin/env bash
# Cross-build the Windows x64 NSIS installer on Linux (never publishes).
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" == "Linux" ]]; then
  export ELECTRON_BUILDER_WINE_TOOLSET_DIR="$PWD/build/wine-shim"
fi
npx electron-builder --win nsis --x64 --publish never "$@"
