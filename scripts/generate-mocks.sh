#!/usr/bin/env bash
# =============================================================================
# TPT mock stub generator — shell wrapper
# =============================================================================
# Checks prerequisites, installs npm deps if needed, then runs generate-mocks.js
#
# Requires:
#   - Node.js 24+
#   - nais CLI, authenticated (nais login)
#
# Usage:
#   ./scripts/generate-mocks.sh [--config path/to/mock-config.yaml]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=scripts/lib.sh
source "$SCRIPT_DIR/lib.sh"

echo ""
echo "TPT mock stub generator"
echo ""

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------

errors=0

# Node.js >= 24 (via shared lib.sh)
check_node_version || errors=$((errors + 1))

# nais CLI
if ! command -v nais &>/dev/null; then
  fail "nais CLI not found — install from https://docs.nais.io/cli/install/"
  errors=$((errors + 1))
else
  ok "nais CLI found: $(command -v nais)"
fi

# nais authentication — try a quick schema fetch to verify
if command -v nais &>/dev/null; then
  if ! nais api schema &>/dev/null 2>&1; then
    fail "nais CLI is not authenticated — run: nais login"
    errors=$((errors + 1))
  else
    ok "nais CLI authenticated"
  fi
fi

if [[ "$errors" -gt 0 ]]; then
  echo ""
  echo -e "${RED}Prerequisites not met. Fix the issues above and try again.${RESET}"
  exit 1
fi

# ---------------------------------------------------------------------------
# Install npm dependencies if needed
# ---------------------------------------------------------------------------

if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  echo ""
  echo "Installing npm dependencies..."
  (cd "$SCRIPT_DIR" && npm install --silent)
  ok "Dependencies installed"
fi

# ---------------------------------------------------------------------------
# Run generator
# ---------------------------------------------------------------------------

echo ""
node "$SCRIPT_DIR/generate-mocks.js" "$@"
