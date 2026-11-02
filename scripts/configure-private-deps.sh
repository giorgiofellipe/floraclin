#!/usr/bin/env bash
set -euo pipefail

: "${FISCAL_REPO_TOKEN:?FISCAL_REPO_TOKEN is required to install @bullcode/fiscal}"

git config --global url."https://x-access-token:${FISCAL_REPO_TOKEN}@github.com/bullcodeapps/".insteadOf "https://github.com/bullcodeapps/"
