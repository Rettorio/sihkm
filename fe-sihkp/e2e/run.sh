#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
echo "  Running E2E blackbox tests..."

NODE_ENV=production node e2e/blackbox.mjs "$@"
