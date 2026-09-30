# Local Development

This directory contains the Docker Compose stack for running the full TPT stack locally.

## Prerequisites: fnox

Secrets (including `NODE_AUTH_TOKEN` for the frontend build) are managed via
[fnox](https://github.com/navikt/fnox). Always prefix commands with `fnox exec --` so secrets
are injected from the keychain:

```bash
fnox exec -- ./scripts/bootstrap.sh
# or
fnox exec -- docker compose -f local-dev/docker-compose.yml up --build
```

Running without `fnox exec --` will cause the frontend Docker build to fail with a 401 when
fetching private `@navikt` packages from `npm.pkg.github.com`.

---

## Two modes

### Mode A — Dev servers (recommended for active development)

Runs the backend and frontend as native processes. Auth is fully mocked — no Wonderwall, no Texas,
no real tokens. Fastest to start, easiest to debug.

```bash
# From the repo root
fnox exec -- ./scripts/bootstrap.sh
# Select: Mode A
```

Or manually:

```bash
# Terminal 1 — backend (starts its own Postgres via testcontainers)
cd ../tpt-backend
./gradlew runLocalDev

# Terminal 2 — frontend (hits backend at localhost:8080, generates a fake token)
cd ../tpt-frontend
pnpm install
pnpm run dev:local
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8080 |
| Swagger UI | http://localhost:8080/swagger |

---

### Mode B — Full Docker Compose stack

Runs all services in containers, including Wonderwall (OIDC proxy), Texas (token sidecar), and
`mock-oauth2-server` (local Entra ID). Closer to production. Requires more prerequisites.

```bash
# From the repo root
fnox exec -- ./scripts/bootstrap.sh
# Select: Mode B
```

Or manually:

```bash
# 1. Build JVM services first (Dockerfiles copy pre-built artifacts)
cd ../tpt-backend && ./gradlew installDist
cd ../tpt-data-collector && ./gradlew jar

# 2. Generate WireMock stubs (requires nais login)
cd ../tpt && ./scripts/generate-mocks.sh

# 3. Start the stack
fnox exec -- docker compose -f local-dev/docker-compose.yml up --build
```

| Service | URL | Notes |
|---|---|---|
| **Frontend** (via Wonderwall) | http://localhost:3000 | **Use this in browser** |
| Backend API | http://localhost:8080 | Direct access |
| WireMock admin UI | http://localhost:9090/__admin/mappings | Inspect active stubs, view request log |
| Mock IdP | http://localhost:8888 | |
| Mock IdP debugger | http://localhost:8888/azuread/debugger | Manual token testing |
| Neo4j browser | http://localhost:7474 | user: `neo4j`, password: `password` |

**Login flow:** Visit http://localhost:3000 — Wonderwall redirects to the mock login page at
`localhost:8888`. Enter a username to log in:

| Username | Role |
|---|---|
| `admin` | Admin (Entra ID admin group injected into token) |
| anything else (e.g. `alice`) | Regular user (no admin group) |

**Switching users:** Clear cookies for `localhost` in your browser, then visit http://localhost:3000 and log in with the new username.

**WireMock stubs** for the Nais API, GCVE, and Teamkatalogen are generated on demand and not committed to git.
Run `./scripts/generate-mocks.sh` (requires `nais login`) before your first Mode B startup, and again when you want fresh randomized data..

---

## Prerequisites

| Tool | Required for | How to install |
|---|---|---|
| Docker Desktop | Mode B | https://www.docker.com/products/docker-desktop |
| Java 25+ | Mode A (backend) | https://adoptium.net or `mise install java` |
| Node.js 24+ | Mode A (frontend) | https://nodejs.org or `mise install node` |
| pnpm | Mode A (frontend) | `npm install -g pnpm` |
| gcloud CLI | Mode B (GAR image pull) | https://cloud.google.com/sdk/docs/install |
| GitHub PAT (`read:packages`) | Mode B (frontend build) | https://github.com/settings/tokens |

### GAR authentication (required for Mode B)

All service images are built from base images in Nav's Google Artifact Registry.
You must authenticate before running `docker compose up --build`:

```bash
gcloud auth login
gcloud auth configure-docker europe-north1-docker.pkg.dev
```

---

## Directory layout

```
local-dev/
├── docker-compose.yml              # Full stack definition
├── .env.example                    # Environment variable template
├── dummy-nais-token                # Placeholder token file (WireMock ignores auth headers)
├── mock-oauth2-server-config.json  # Mock Entra ID configuration
├── keys/
│   ├── README.md                   # Explains these are non-secret test keys
│   ├── local-dev-private.jwk       # RSA private key for Texas (test only)
│   └── local-dev-public.jwk        # RSA public key (reference)
└── wiremock/
    └── mappings/                   # WireMock stub files (generated + committed)
        ├── nais/                   # Nais GraphQL API stubs (scenario-cycling)
        ├── gcve/                   # GCVE CVE lookup stubs (scenario-cycling)
        └── teamkatalogen/          # Teamkatalogen membership stubs (static)
```

## Using production data as mock data (Mode A)

The backend's `runLocalDev` mode loads mock vulnerability data from local files if present.
See [`test-data/README.md`](../test-data/README.md) for how to populate these from production.

## Stopping and cleaning up

```bash
# Stop all containers
docker compose --file local-dev/docker-compose.yml down

# Stop and remove volumes (resets database and Neo4j)
docker compose --file local-dev/docker-compose.yml down -v
```

---

## Troubleshooting

### GAR authentication errors

```
pull access denied for europe-north1-docker.pkg.dev/...
```

```bash
gcloud auth login
gcloud auth configure-docker europe-north1-docker.pkg.dev
```

---

### Frontend build fails with 401

```
ERR_PNPM_META_FETCH_FAIL  GET https://npm.pkg.github.com/... 401 Unauthorized
```

`NODE_AUTH_TOKEN` is missing or expired. Generate a GitHub PAT with `read:packages` at
https://github.com/settings/tokens, then run with `fnox exec --`.

---

### Backend port 8080 already in use

```bash
lsof -i :8080
```

Kill the conflicting process or restart Docker.

---

### Testcontainers: Docker socket not found (Mode A)

```
Could not find a valid Docker environment
```

Ensure Docker Desktop is running. On macOS:

```bash
sudo ln -sf "$HOME/.docker/run/docker.sock" /var/run/docker.sock
```

---

### Wonderwall login loop (Mode B)

Browser keeps redirecting between `localhost:3000/oauth2/login` and `localhost:8888/...`.

`mock-oauth2-server` takes a few seconds to become healthy — wait and retry. On Linux,
`host-gateway` may not resolve; add `127.0.0.1 host.docker.internal` to `/etc/hosts`.

---

### Texas: token introspection returns `active: false`

Backend rejects all requests with 401. Force a fresh login:

```
http://localhost:3000/oauth2/logout/local
http://localhost:3000/oauth2/login
```

---

### tpt-data-collector: Neo4j connection refused

Neo4j takes 20–30 seconds to become ready. If the data-collector started too early:

```bash
docker compose --file local-dev/docker-compose.yml restart tpt-data-collector
```
