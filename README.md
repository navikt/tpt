# TittPåTing (TPT)

This repository plays two roles for the TPT stack.

**Test rig.** It spins up all TPT services running **production code** in a single Docker Compose
environment, so the team can:

- **Verify end-to-end behaviour** with realistic but controlled data — without needing admin access to production.
- **Demo the product** to stakeholders against a stable, repeatable dataset.
- **Catch breaking contract changes** with external dependencies (Nais API, GCVE, Teamkatalogen, GitHub) before they reach production.

**Shared knowledge & coordination hub.** It is the stack's shared memory. Cross-cutting work that
spans multiple TPT repos happens here: architecture decisions ([`docs/adr/`](docs/adr/)), the
ubiquitous language ([`CONTEXT.md`](CONTEXT.md)), research, brainstorming, and breaking large
initiatives into tickets for the individual service repos.

The schemas, test data, and scripts here exist to support the test-rig goal.

## Contents

- [What is TittPåTing?](#what-is-tittp%C3%A5ting)
- [Repositories](#repositories)
- [What lives here](#what-lives-here)
- [Getting started](#getting-started)
- [Quick start](#quick-start)
- [Keeping the test rig healthy](#keeping-the-test-rig-healthy)
- [Contact](#contact)

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
| [navikt/tpt-graph](https://github.com/navikt/tpt-graph) | Graph service (team appsec) — reads the Cartography/Neo4j graph over Bolt and serves a read-only attack-path web UI. Candidate graph datasource for TPT (research in progress). |
| [navikt/tpt](https://github.com/navikt/tpt) | **This repo** — test rig, shared knowledge & coordination hub (docs, ADRs, schemas, test data) |

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
    ├── adr/                # Architecture decision records (cross-cutting)
    ├── agents/             # Agent tooling — issue tracker, triage labels, domain docs
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

The bootstrap script expects all three sibling repos next to this one:

```
~/dev/
├── tpt/                  # this repo
├── tpt-backend/
├── tpt-frontend/
└── tpt-data-collector/
```

```bash
git clone git@github.com:navikt/tpt-backend.git
git clone git@github.com:navikt/tpt-frontend.git
git clone git@github.com:navikt/tpt-data-collector.git
```

### 4. Generate WireMock stubs

The stack (Mode B) requires WireMock stubs that are not committed to the repo. Generate them once
before first run, and again whenever an external API schema changes:

```bash
fnox exec -- ./scripts/generate-mocks.sh
```

This fetches live data from the Nais API. Before running it, make sure:
- naisdevice is running and connected
- you are authenticated: `nais auth login`

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
