#!/usr/bin/env bash
# Reuse matching dependencies and skip checks for a previously checked build.
exec bash "$(dirname "${BASH_SOURCE[0]}")/build-linux.sh" --quick "$@"
