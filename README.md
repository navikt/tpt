# TittPåTing (TPT) — Test Rig

This repository is the test rig for the TPT stack. Its primary job is to spin up all TPT services
running **production code** in a single Docker Compose environment, so the team can:

- **Verify end-to-end behaviour** with realistic but controlled data — without needing admin access to production.
- **Demo the product** to stakeholders against a stable, repeatable dataset.
- **Catch breaking contract changes** with external dependencies (Nais API, GCVE, Teamkatalogen, GitHub) before they reach production.

Everything else in this repo — docs, schemas, scripts, ADRs — exists to support that goal.

## What is TittPåTing?

TittPåTing is a vulnerability prioritization and compliance tool for Nav developers. It collects
vulnerability data from Nais and GitHub, enriches it with external CVE metadata (GCVE/KEV/EPSS),
and presents a risk-scored, actionable view per team.

## Repositories

| Repository | Description |
|---|---|
| [navikt/tpt-backend](https://github.com/navikt/tpt-backend) | Ktor API — vulnerability data, risk scoring, auth, Kafka sync |
| [navikt/tpt-frontend](https://github.com/navikt/tpt-frontend) | Next.js frontend — vulnerability dashboard |
| [navikt/tpt-data-collector](https://github.com/navikt/tpt-data-collector) | Data collector — GitHub webhooks, Cartography/Neo4j, Kafka producer |
| [navikt/tpt](https://github.com/navikt/tpt) | **This repo** — test rig, docs, schemas, test data |

## What lives here

```
tpt/
├── local-dev/              # Docker Compose stack — the test rig
│   ├── docker-compose.yml  # All services, production images + local builds
│   ├── .env.example        # Environment variable template
│   └── keys/               # Test-only RSA key for local auth (NOT a secret)
├── test-data/
│   └── mock/               # Controlled datasets for demos and scenario testing
├── schemas/                # Shared API schemas (GraphQL, OpenAPI)
├── scripts/
│   ├── bootstrap.sh        # One-stop startup script
│   └── generate-mocks.*    # Generates WireMock stubs from live Nais data
└── docs/
    ├── architecture/       # System diagram, component descriptions, ADRs
    └── runbooks/           # Operational guides and troubleshooting
```

## Getting started

### 1. Install tools

All required tools are declared in `mise.toml`. Install [mise](https://mise.jdx.dev) if you haven't already, then run:

```bash
mise install
```

This installs Java 25, Node.js 24, pnpm, and fnox.

### 2. Store your `NODE_AUTH_TOKEN` in the keychain

`NODE_AUTH_TOKEN` is a GitHub PAT with `read:packages` scope. It is required to pull private
`@navikt` npm packages during the frontend build.

Store it once with fnox:

```bash
fnox secret set NODE_AUTH_TOKEN <your-token>
```

fnox reads this from your keychain at runtime — no `.env` files needed.

### 3. Clone sibling repositories

The bootstrap script expects `tpt-backend` and `tpt-frontend` as siblings of this repo:

```
~/dev/
├── tpt/             # this repo
├── tpt-backend/
└── tpt-frontend/
```

```bash
git clone git@github.com:navikt/tpt-backend.git
git clone git@github.com:navikt/tpt-frontend.git
```

## Quick start

```bash
fnox exec -- ./scripts/bootstrap.sh
```

The bootstrap script checks prerequisites and lets you choose between two modes:

| Mode | What it runs | When to use |
|---|---|---|
| **A — Dev servers** | `./gradlew runLocalDev` + `pnpm run dev:local` | Active development — fast startup, mocked auth |
| **B — Full compose** | `fnox exec -- docker compose up --build` | Integration testing, demos, contract verification |

`fnox exec --` injects secrets from the keychain, including `NODE_AUTH_TOKEN` for the frontend build.
Running without it will cause a 401 when fetching private `@navikt` packages.

**Mode B is the test rig.** It runs every service from source, stubs all external APIs via WireMock,
and uses `mock-oauth2-server` in place of Entra ID. The result is a fully isolated, repeatable
environment that behaves like production.

See [`local-dev/README.md`](local-dev/README.md) for full details, including troubleshooting.

## Keeping the test rig healthy

The test rig is only useful if it stays green. When making changes:

1. **Validate compose syntax** before committing:
   ```bash
   docker compose -f local-dev/docker-compose.yml config --quiet
   ```
2. **Regenerate WireMock stubs** after an external API schema changes:
   ```bash
   fnox exec -- ./scripts/generate-mocks.sh
   ```
3. **Rebuild services** after pulling new application code:
   ```bash
   cd ../tpt-backend && ./gradlew installDist
   cd ../tpt-data-collector && ./gradlew jar
   fnox exec -- docker compose -f local-dev/docker-compose.yml up --build
   ```

## Contact

Maintained by the AppSec team at Nav.

- Slack: [#appsec](https://nav-it.slack.com/archives/C06P91VN27M)
- [Team in Teamkatalogen](https://teamkatalogen.nav.no/team/02ed767d-ce01-49b5-9350-ee4c984fd78f)
