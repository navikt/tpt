#!/usr/bin/env bash
# =============================================================================
# TPT scripts — shared helpers
# =============================================================================
# Source this file from bootstrap.sh and generate-mocks.sh:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET} $*"; }
fail() { echo -e "  ${RED}✗${RESET} $*"; }
warn() { echo -e "  ${YELLOW}!${RESET} $*"; }

# Prints an error and exits if Node.js < 24 is found (or not found at all).
check_node_version() {
  if ! command -v node &>/dev/null; then
    fail "node not found — install Node.js 24+"
    return 1
  fi
  local ver
  ver=$(node --version | sed 's/v//' | cut -d'.' -f1)
  if [[ "$ver" -lt 24 ]]; then
    fail "Node.js $ver found, 24+ required"
    return 1
  fi
  ok "Node.js $ver"
}

# Returns 0 if all WireMock stub directories are non-empty (contain at least
# one .json stub file beyond .gitkeep). Returns 1 otherwise.
wiremock_stubs_present() {
  local mappings_dir="$1"
  for subdir in nais gcve teamkatalogen; do
    local count
    count=$(find "$mappings_dir/$subdir" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l)
    if [[ "$count" -eq 0 ]]; then
      return 1
    fi
  done
  return 0
}
