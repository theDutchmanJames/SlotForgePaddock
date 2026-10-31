#!/usr/bin/env bash
# Build the AppImage and Debian installer on Linux.
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Install Node.js 22.12 or newer, then run this builder again.' >&2
  exit 1
fi
exec node scripts/build-desktop.cjs linux "$@"
