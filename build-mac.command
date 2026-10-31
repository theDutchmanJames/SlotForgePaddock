#!/usr/bin/env bash
# Build a universal DMG and ZIP on macOS (Intel and Apple Silicon).
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Install Node.js 22.12 or newer, then run this builder again.' >&2
  if [ -t 0 ]; then read -r -p 'Press Enter to close. ' reply; fi
  exit 1
fi
exec node scripts/build-desktop.cjs mac "$@"
