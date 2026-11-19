#!/usr/bin/env bash
# Reproduce every figure and report under outputs/.
set -euo pipefail
cd "$(dirname "$0")"
export PYTHONPATH="$PWD/.deps:$PWD/src${PYTHONPATH:+:$PYTHONPATH}"
export MPLBACKEND=Agg
python3 -m hatching.main --out "${1:-outputs}"
