#!/usr/bin/env bash
# =============================================================================
# TPT local dev bootstrap
# =============================================================================
# Checks prerequisites and starts the TPT stack in your chosen mode.
#
# Mode A — Dev servers:  ./gradlew runLocalDev + pnpm run dev:local
# Mode B — Full compose: docker compose up --build (full auth stack)
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$(cd "$REPO_ROOT/../tpt-backend" 2>/dev/null && pwd)" || true
FRONTEND_DIR="$(cd "$REPO_ROOT/../tpt-frontend" 2>/dev/null && pwd)" || true
COMPOSE_DIR="$REPO_ROOT/local-dev"

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET} $*"; }
warn() { echo -e "  ${YELLOW}!${RESET} $*"; }
fail() { echo -e "  ${RED}✗${RESET} $*"; }

# =============================================================================
# Helper: check a command exists and optionally meets a minimum version
# =============================================================================
check_command() {
  local cmd="$1"
  local label="${2:-$cmd}"
  if ! command -v "$cmd" &>/dev/null; then
    fail "$label not found"
    return 1
  fi
  ok "$label found: $(command -v "$cmd")"
}

check_java_version() {
  if ! command -v java &>/dev/null; then
    fail "java not found"
    return 1
  fi
  local ver
  ver=$(java -version 2>&1 | awk -F '"' '/version/ {print $2}' | cut -d'.' -f1)
  if [[ "$ver" -lt 25 ]]; then
    fail "Java $ver found, Java 25+ required"
    return 1
  fi
  ok "Java $ver"
}

check_node_version() {
  if ! command -v node &>/dev/null; then
    fail "node not found"
    return 1
  fi
  local ver
  ver=$(node --version | sed 's/v//' | cut -d'.' -f1)
  if [[ "$ver" -lt 24 ]]; then
    fail "Node $ver found, Node 24+ required"
    return 1
  fi
  ok "Node $ver"
}

check_docker() {
  if ! command -v docker &>/dev/null; then
    fail "docker not found"
    return 1
  fi
  if ! docker info &>/dev/null; then
    fail "Docker daemon not running — start Docker Desktop"
    return 1
  fi
  ok "Docker running"
}

check_gar_auth() {
  local registry="europe-north1-docker.pkg.dev"
  if docker system info 2>/dev/null | grep -q "$registry"; then
    ok "GAR auth configured"
    return 0
  fi
  # Try to look at docker config
  local config="$HOME/.docker/config.json"
  if [[ -f "$config" ]] && grep -q "$registry" "$config" 2>/dev/null; then
    ok "GAR auth configured (docker config)"
    return 0
  fi
  warn "GAR auth not detected. Run:"
  warn "  gcloud auth login"
  warn "  gcloud auth configure-docker europe-north1-docker.pkg.dev"
  return 1
}

# =============================================================================
# Mode selection
# =============================================================================
select_mode() {
  echo ""
  echo -e "${BOLD}Select local dev mode:${RESET}"
  echo ""
  echo "  1) Mode A — Dev servers (recommended for active development)"
  echo "     Runs backend + frontend as native processes."
  echo "     Auth is fully mocked. No Docker Compose needed."
  echo ""
  echo "  2) Mode B — Full Docker Compose stack"
  echo "     All services in containers, including Wonderwall + Texas + mock IdP."
  echo "     Closest to production. Requires Docker + GAR auth + NODE_AUTH_TOKEN."
  echo ""
  read -rp "Enter choice [1/2]: " choice
  echo ""
  case "$choice" in
    1) MODE=A ;;
    2) MODE=B ;;
    *) echo "Invalid choice. Exiting."; exit 1 ;;
  esac
}

# =============================================================================
# Mode A: native dev servers
# =============================================================================
run_mode_a() {
  echo -e "${BOLD}Checking prerequisites for Mode A...${RESET}"
  local ok=true

  check_java_version    || ok=false
  check_node_version    || ok=false
  check_command pnpm    || ok=false

  if [[ -z "$BACKEND_DIR" ]] || [[ ! -d "$BACKEND_DIR" ]]; then
    fail "tpt-backend not found at ../tpt-backend"
    ok=false
  else
    ok "tpt-backend found: $BACKEND_DIR"
  fi

  if [[ -z "$FRONTEND_DIR" ]] || [[ ! -d "$FRONTEND_DIR" ]]; then
    fail "tpt-frontend not found at ../tpt-frontend"
    ok=false
  else
    ok "tpt-frontend found: $FRONTEND_DIR"
  fi

  if [[ "$ok" == "false" ]]; then
    echo ""
    echo -e "${RED}Prerequisites not met. Fix the issues above and try again.${RESET}"
    exit 1
  fi

  echo ""
  echo -e "${BOLD}Starting Mode A...${RESET}"
  echo ""
  echo "  Backend:  http://localhost:8080"
  echo "  Swagger:  http://localhost:8080/swagger"
  echo "  Frontend: http://localhost:3000"
  echo ""
  echo "Press Ctrl+C to stop both processes."
  echo ""

  # Install frontend deps if needed
  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    echo "Installing frontend dependencies..."
    (cd "$FRONTEND_DIR" && pnpm install)
  fi

  # Start backend in background
  (cd "$BACKEND_DIR" && ./gradlew runLocalDev) &
  BACKEND_PID=$!

  # Trap Ctrl+C to kill both
  trap 'echo ""; echo "Stopping..."; kill $BACKEND_PID 2>/dev/null; exit 0' INT TERM

  # Small delay so backend starts first
  sleep 3

  # Start frontend in foreground (keeps the terminal alive)
  (cd "$FRONTEND_DIR" && pnpm run dev:local)
}

# =============================================================================
# Mode B: Docker Compose
# =============================================================================
run_mode_b() {
  echo -e "${BOLD}Checking prerequisites for Mode B...${RESET}"
  local ok=true

  check_docker      || ok=false
  check_gar_auth    || ok=false

  if [[ -z "${NODE_AUTH_TOKEN:-}" ]]; then
    fail "NODE_AUTH_TOKEN is not set"
    warn "Generate a GitHub PAT with read:packages at https://github.com/settings/tokens"
    warn "Then: export NODE_AUTH_TOKEN=<your-token>"
    ok=false
  else
    ok "NODE_AUTH_TOKEN set"
  fi

  # Check sibling repos exist (needed for build contexts)
  for repo in tpt-backend tpt-frontend tpt-data-collector; do
    local dir
    dir="$(cd "$REPO_ROOT/../$repo" 2>/dev/null && pwd)" || true
    if [[ -z "$dir" ]] || [[ ! -d "$dir" ]]; then
      fail "$repo not found at ../$repo"
      ok=false
    else
      ok "$repo found: $dir"
    fi
  done

  if [[ "$ok" == "false" ]]; then
    echo ""
    echo -e "${RED}Prerequisites not met. Fix the issues above and try again.${RESET}"
    exit 1
  fi

  # Create .env from example if it doesn't exist
  if [[ ! -f "$COMPOSE_DIR/.env" ]]; then
    echo ""
    echo "Creating $COMPOSE_DIR/.env from .env.example..."
    cp "$COMPOSE_DIR/.env.example" "$COMPOSE_DIR/.env"
    warn "Review $COMPOSE_DIR/.env before continuing (press Enter to proceed or Ctrl+C to abort)"
    read -r
  fi

  echo ""
  echo -e "${BOLD}Starting Mode B (this may take a few minutes on first run)...${RESET}"
  echo ""
  echo "  Frontend (browser entry point): http://localhost:3000"
  echo "  Backend API:                    http://localhost:8080"
  echo "  Mock IdP:                       http://localhost:8888"
  echo "  Mock IdP debugger:              http://localhost:8888/azuread/debugger"
  echo "  Neo4j browser:                  http://localhost:7474"
  echo ""
  echo "Login: visit http://localhost:3000 — enter any username on the mock login page."
  echo ""

  docker compose \
    --file "$COMPOSE_DIR/docker-compose.yml" \
    --env-file "$COMPOSE_DIR/.env" \
    up --build
}

# =============================================================================
# Main
# =============================================================================
echo ""
echo -e "${BOLD}TittPåTing — local dev bootstrap${RESET}"
echo ""

select_mode

if [[ "$MODE" == "A" ]]; then
  run_mode_a
else
  run_mode_b
fi
