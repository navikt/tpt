# Scripts

## bootstrap.sh

One-stop local dev startup script. Checks prerequisites and starts either:

- **Mode A** — Native dev servers (`./gradlew runLocalDev` + `pnpm run dev:local`)
- **Mode B** — Full Docker Compose stack with auth infrastructure

### First-time setup

Make the scripts executable after cloning:

```bash
chmod +x scripts/bootstrap.sh scripts/generate-mocks.sh
```

### Usage

```bash
./scripts/bootstrap.sh
```

The script will prompt you to choose a mode, verify prerequisites, and start the stack.

### What each mode does

| Mode | Starts | Auth | Use when |
|---|---|---|---|
| A | Backend process + frontend process | Fully mocked (no real tokens) | Day-to-day development |
| B | `docker compose up --build` | Wonderwall + Texas + mock IdP | Integration testing, auth flows |

See [`local-dev/README.md`](../local-dev/README.md) for detailed documentation on both modes.

---

## generate-mocks.sh

Generates WireMock stub files for the Nais GraphQL API, GCVE, and Teamkatalogen.
Stubs are written to `local-dev/wiremock/mappings/` and are **not committed to git** —
run the generator before first use of Mode B, and again when you want fresh data.

### Prerequisites

- Node.js 24+
- `nais` CLI, authenticated (`nais login`)

The generator does **not** require VPN. It fetches the Nais schema via the nais CLI
(which uses your existing nais authentication) and hardcodes the Teamkatalogen response
shapes (which are stable and small).

### Usage

```bash
./scripts/generate-mocks.sh
```

Optional: point at a different config file:

```bash
./scripts/generate-mocks.sh --config path/to/mock-config.yaml
```

### When to re-run

- **After the Nais GraphQL schema changes** — the generator validates all fields the
  backend uses and fails loudly if any are missing. This is intentional: a breaking
  schema change means `tpt-backend`'s queries and models need updating first.
- **When you want fresh randomized data** — each run produces different team slugs,
  CVE IDs, CVSS scores, workload names, etc.
- **After changing `mocks/mock-config.yaml`** — to pick up different team/app/vuln counts.

### What it generates

```
local-dev/wiremock/mappings/
├── nais/                 Scenario-cycling stubs for all 6 GraphQL operations
│   ├── app-vulns-for-user-{1,2,3}.json
│   ├── job-vulns-for-user-{1,2,3}.json
│   ├── app-vulns-for-team-{1,2,3}.json
│   ├── job-vulns-for-team-{1,2,3}.json
│   ├── team-memberships.json
│   └── all-teams.json
├── gcve/                 Scenario-cycling stubs for CVE lookup + list endpoint
│   ├── cve-by-id-{1,2,3}.json
│   ├── cve-list.json
│   └── cve-not-found.json
└── teamkatalogen/        Static stubs for membership and team lookup
    ├── membership-by-email.json
    ├── teams-by-product-area.json
    └── teams-by-cluster.json
```

**Scenario cycling:** WireMock cycles through the N variations predictably —
each successive call to a given operation returns the next variation, wrapping
back to variation 1 after the last. This simulates different team/workload/CVE
data across backend sync calls without any client changes.

### Schema validation

The generator parses the fetched Nais GraphQL schema and checks that every field
`tpt-backend` reads is still present. If the schema has changed in a breaking way,
the generator exits with an error like:

```
BREAKING SCHEMA CHANGE DETECTED
The following fields used by tpt-backend are no longer in the Nais GraphQL schema:
  Field "vulnerabilityDetailsLink" missing from type "ImageVulnerability"

This means the Nais API has changed in a way that will break tpt-backend.
Update tpt-backend's GraphQL queries and models, then re-run this generator.
```

This is the intended behaviour — treat it as an early warning that integration
tests in `tpt-backend` will fail.

---

## Not yet implemented (future work)

The following capabilities are intentionally out of scope for now and noted here
for future implementation:

### Chaos / fault injection scenarios

WireMock supports stateful scenario-based fault injection. Planned stub sets that
are not yet generated:

- **GCVE 429 (rate limit):** WireMock scenario returning `429 Too Many Requests`
  with a `Retry-After` header — verifies the backend's retry logic and backoff.
- **GCVE 502/503 trilogy (circuit breaker trip):** Three consecutive 502/503 responses
  to verify `InMemoryCircuitBreaker` opens after 3 failures and blocks further calls.
- **Nais GraphQL errors in 200 response:** Valid HTTP 200 with a `{"errors": [...]}` body
  — verifies the backend surfaces `NaisApiException` and handles partial failure.
- **Nais 503:** HTTP 503 from the Nais API — verifies the backend degrades gracefully
  without crashing the sync job.
- **Teamkatalogen malformed JSON:** HTTP 200 with an invalid response body shape —
  verifies deserialization errors are caught and don't crash user context resolution.

A `scripts/chaos.sh` helper to switch WireMock scenarios via the admin API is also
planned — e.g. `./scripts/chaos.sh gcve circuit-break`.

### User-controlled randomization seed

Support a `--seed <n>` flag in `generate-mocks.sh` to make faker output reproducible.
Useful for debugging: share a seed to reproduce an exact data set.

### Prism for external REST API validation

[Prism](https://github.com/stoplightio/prism) (`stoplight/prism`) can serve a mock
from an OpenAPI spec and validate requests against it. If GCVE or Teamkatalogen ever
publish well-specified OpenAPI schemas (with response schemas populated), Prism could
replace the WireMock stubs for those services and provide live request validation at no
extra maintenance cost.
