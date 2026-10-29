# TPT — Context

## Purpose of this repository

This repository plays two roles for the TPT stack.

**1. Test rig.** It runs all TPT services from production code in a single Docker Compose
environment — isolated from production, with controlled data — so the team can verify end-to-end
behaviour, demo the product, and catch breaking contract changes with external APIs before they
reach production. The schemas, test data, and scripts here exist in service of that goal.

**2. Shared knowledge & coordination hub.** It is the stack's shared memory. Cross-cutting work
that spans multiple TPT repos happens here: architecture decisions (`docs/adr/`), the ubiquitous
language (this file), research, brainstorming, and breaking large initiatives into tickets for the
individual service repos. When a change touches more than one service, it is shaped here first.

## What TPT does

TittPåTing (TPT) is a vulnerability prioritization and compliance tool for Nav developers.
It collects vulnerability data from Nais and GitHub, enriches it with external CVE metadata,
and presents actionable, risk-scored views per team across three areas:

- **Vulnerability prioritization** — the core tab. Every concept centers on Vulnerabilities (CVEs
  affecting a workload). Each Vulnerability carries a single Risk Score derived from multiple
  categories (severity, exploitability, exposure, KEV status, EPSS) that are all surfaced to the
  user on demand.
- **Compliance** — presents per-Team Security Status computed by the backend from synced
  Vulnerability and Workload lifecycle facts: exposure, trend, maintenance, escalation level,
  and monthly history. It is not a complete compliance assessment; additional criteria remain
  unimplemented. Compliance Findings and Actions remain separate concepts from Vulnerabilities.
- **Golden path** — a developer-facing repository-check view, still evolving. Presents Findings
  with descriptions, severity, check times, and reasons, grouped by repository. Current results
  are pass/fail checks, not a separate weighted Findings score. Wider resource support remains
  an architectural direction, not evidence of implemented checks for every resource type.

## Ubiquitous language

| Term | Definition |
|---|---|
| **Vulnerability** | A CVE affecting a specific workload in Nais. The central entity in the prioritization tab. |
| **Risk Score** | A single number expressing the priority of a Vulnerability. Composed of multiple categories (severity, exploitability, exposure, KEV, EPSS) shown to the user on demand. Never called "priority score" or "threat score". |
| **CVE** | A Common Vulnerability and Exposure identifier. Used as a key to look up enrichment from GCVE. |
| **KEV** | Known Exploited Vulnerability — a CISA catalogue flag. Feeds the Risk Score. |
| **EPSS** | Exploit Prediction Scoring System — probability of exploitation. Feeds the Risk Score. |
| **GCVE** | External CVE enrichment service (`db.gcve.eu`) providing KEV, EPSS, SSVC, and CVSS data. |
| **Workload** | A Nais application or Nais job. The unit of deployment. Never called "service" or "app" when referring to a Nais entity. |
| **Team** | A Nais team. The unit of ownership for Workloads. |
| **Finding** | Used in the compliance and golden-path contexts. Means a compliance gap or best-practice deviation. Not a synonym for Vulnerability. |
| **Action** | A required remediation step in the compliance context. |
| **Security Status** | A backend-computed per-Team compliance view of exposure, trend, and maintenance, with an escalation level and monthly history. Distinct from a Vulnerability's Risk Score; not proof of complete regulatory compliance. |
| **Monthly security history** | Daily Security Status counts grouped by month: on track, needs attention, or act now, plus missing coverage. Computed from recorded lifecycle facts; the current month is provisional. Missing coverage is not an on-track result. |
| **Work context** | The frontend's shared Team and Workload selection for vulnerability, GitHub, and golden-path display filtering. Separate from token-derived user context; not authorization. The compliance view does not currently apply it. |
| **User context** | The backend's resolution of the authenticated user (`preferred_username`) to the Teams they belong to, used to fetch that user's relevant data. A relevance mechanism, not access control — see ADR-0002. Owned by the backend. |
| **Data collector** | The `tpt-data-collector` service. The home for **new data sources and data types that are not vulnerability enrichment** (ADR-0003). On request from the backend (over HTTP, answered with 202) it collects data — e.g. GitHub vulnerability alerts via GraphQL, Cartography/Neo4j checks — and sends it back to the backend as **callbacks** (ADR-0005). Never called "collector service" or "tpt-data-collector" in domain language — just "the data collector". |
| **Cartography** | CNCF tool that models cloud, GitHub, Kubernetes, and Nais resources as a graph and populates Neo4j. It is the writer to the graph, not a TPT service. |
| **Graph** | The Cartography-populated Neo4j graph of infrastructure, ownership, and dependency relationships. Today it is read over direct Bolt by appsec's own tools; it is not yet a datasource for the backend or frontend. |
| **tpt-graph** | An appsec-owned service that reads the Graph over Bolt and serves a read-only attack-path web UI plus a small JSON API for its own frontend. The intent to make it a general graph-access layer for the rest of TPT is research, not current state — see "Architectural intent". |
| **Query workspace** | The private appsec investigation tool (`tpt-query-workspace`) for AI-assisted queries against the Graph and rerunning saved investigations. A separate application from the attack-path UI, not a graph-access API for the rest of TPT. |
| **Sync** | A scheduled or on-demand operation that refreshes data from an external source into PostgreSQL. Sync kinds have short names (e.g. `team_sync`, `vuln_data_sync`, `gcve_sync`); the current set lives in code, not here. The backend runs its own syncs in-process, guarded by a Postgres sync lock (ADR-0005). |
| **SSE** | Server-Sent Events — the backend's push channel to the frontend. Events are **signals, not data**: an event tells the frontend something changed; the frontend then re-fetches over REST (the "notify-then-fetch" pattern). Cross-service progress arrives as callbacks from the data collector, which the backend re-broadcasts over SSE. Every event goes through the **SSE event log** so that all backend pods see it. |
| **Callback** | An HTTP request from the data collector to the backend delivering collected data or GitHub vulnerability sync lifecycle signals. Results may originate from a backend-triggered job or a GitHub webhook. Check results do not currently have completion signaling. Authenticated with Entra machine-to-machine tokens. See ADR-0005. |
| **SSE event log** | The backend's Postgres table of recent SSE events plus a LISTEN/NOTIFY channel. Publishing inserts a row and notifies; every pod listens and pushes the event to its own connected browsers. Also lets a reconnecting browser replay missed events via `Last-Event-ID`. See ADR-0005. |
| **preferred_username** | The employee's identity claim on the Entra ID token. The backend derives *who is asking* from it and returns that user's Teams' data by default — a relevance mechanism (**user context**), not a security control; TPT's vulnerability data is not secret. Never passed as a request parameter. See "User context" in Architectural intent. |

## Retired synonyms

| Avoid | Use instead |
|---|---|
| "issue" (for a CVE hit) | Vulnerability |
| "app" or "service" (for a Nais entity) | Workload |
| "priority score" | Risk Score |
| "collector service" | data collector |
| "finding" (in vulnerability context) | Vulnerability |

## Repository map

Each service owns exactly one named capability — see ADR-0004.

| Repo | Owner | Capability |
|---|---|---|
| `tpt-backend` | tpt | Aggregate vulnerability and findings data, risk-score it, resolve user context, and present it to the frontend. Permanent aggregation hub. |
| `tpt-frontend` | tpt | Next.js UI — dashboard, per-team views, compliance tab, golden-path tab |
| `tpt-data-collector` | tpt | Collect findings data from external sources (GitHub, platform, …) on request from the backend and send it back to the backend as callbacks. The concern is *findings collection*, not any specific integration. |
| `tpt-graph` | appsec | Hosts two independently deployed applications: the graph-derived attack-path UI (`tpt-graph`) and the private Query workspace (`tpt-query-workspace`). |
| `tpt` (this repo) | tpt | IaC, docs, local dev stack, schemas, test data, agent tooling |

## The collector callback seam

The backend and the data collector meet over **HTTP in both directions**:

- **trigger** — the backend asks the data collector to start a job. The data collector validates,
  answers **202 Accepted**, and works in the background.
- **callbacks** — the data collector POSTs results to the backend: GitHub vulnerability data
  and repository check results. GitHub vulnerability collection also sends started/complete
  lifecycle signals, attempting completion even on failure. Delivery is bounded by the retry
  window, so completion is not guaranteed to arrive. Check collection currently has no
  equivalent completion signal. GitHub webhooks also produce result callbacks.

Both directions use Entra machine-to-machine tokens. `/internal` paths are reserved for health
checks and metrics, never for callbacks. The backend's own syncs no longer travel between services;
they run in-process (see **Sync**).

> **Endpoint paths and payload schemas are volatile and live in code, not here.** This document
> describes the *shape* of the seam. There is still **no shared schema or code between repos**, so a
> rename on one side breaks the other; the same holds for SSE event names. Treat both as contracts
> maintained by convention, verified against code (and against the WireMock stubs in this repo).

The data collector never writes to PostgreSQL — it sends callbacks; the backend stores. The backend
is the single reader/writer of its own PostgreSQL.

## The refresh choreography (notify-then-fetch)

Data is cached in the backend's PostgreSQL and refreshed asynchronously. The stack keeps the UI live
during a refresh with a consistent **notify-then-fetch** pattern — SSE carries the *signal*, REST
carries the *data*:

1. The frontend asks the backend to refresh (e.g. a team's GitHub data).
2. The backend clears the stale data and asks the data collector for fresh data (over HTTP, 202).
3. For GitHub vulnerability collection, the data collector sends a **started** callback,
   does the work, sends data callbacks, and attempts a **finished** callback even on failure.
   Callback retries are bounded, so delivery can still fail. The backend writes received
   signals to the **SSE event log**, so the pod holding the frontend's connection can push them.
4. On the *finished* signal the frontend **re-fetches over REST** — the SSE event itself carries no
   data, only the news that fresh data is now available.

The same shape recurs for team/vulnerability syncs, which the backend runs itself and signals
through the same SSE event log. This is the intended refresh pattern, not a guarantee for every
screen: golden path currently reads stored checks once and independently triggers collection,
without re-fetching when that collection finishes. The specific endpoints and event names live
in code and change.

### Compliance from synced facts

The backend records Workload presence, absence, and deployment facts during team sync, and keeps
resolved Vulnerabilities and resolution gaps for bounded history. It computes Security Status
and monthly history from those facts rather than storing compliance snapshots. The response
includes the active measurement rules; the frontend presents the results rather than owning
a second status evaluator. Historical coverage begins with recorded facts, not an assumed
all-clear past. ADR-0006 records this existing production architecture.

## Architectural intent

### User context: identity selects relevant data

TPT leans on the Nais Entra ID model (see ADR-0002 and https://doc.nais.io/auth/entra-id/). All
three standard flows are in use:

- **Login** — the browser authenticates via the Wonderwall sidecar (frontend). The app never sees
  the login.
- **On-behalf-of (OBO)** — the frontend's server layer exchanges the user's token (via Texas) and
  calls the backend *as the user*. The employee's identity is preserved across the hop.
- **Client credentials (m2m)** — the backend calls the data collector *as itself*, no user context.

Because the user's identity survives into the backend, the backend reads **`preferred_username`**
from the validated token, resolves the user's Teams (the **user context**), and returns that user's
data by default. This is a **relevance/convenience mechanism, not a confidentiality control**:
vulnerability data in TPT is **not secret** — only Nav developers can reach TPT, and they can already
browse the same org-wide vulnerability/infrastructure data via the Nais console and GitHub (no
security by obscurity). A user *could* fetch any team's data; the user context just spares them a
team picker by figuring out their teams and fetching that data. The invariant to preserve is that
"my data" is **derived from the token, never taken as a request parameter** — not because it would be
a breach otherwise, but because identity-driven selection is what makes the product usable. Resolving
the user context is a **backend** responsibility (ADR-0003). *(The "not secret" premise is
conditional on that audience — see ADR-0002 if it ever changes.)*

Note the model is *not* "sidecars own all tokens": the data collector validates inbound tokens
itself against Entra's JWKS, and the backend attaches a mounted service-account token when calling
the Nais Console API. Texas is used for OBO exchange and token introspection, not for everything.

### One capability per service (ADR-0004)

Each TPT service owns exactly one named capability. New functionality belongs in an existing service only if it falls squarely within that service's capability; otherwise it goes in a new service. "Concern" is capability-shaped, not integration-shaped — the data collector's concern is *findings collection*, not "GitHub"; it may add new integrations without splitting. The backend is the permanent aggregation hub; specialised services do not call each other.

Placement rule: name what you're building in one sentence. If that sentence matches an existing service's capability, put it there. If it introduces an "and", or no existing service covers it, create a new service.

### The backend / data-collector split (ADR-0003)

TPT's original goal is **vulnerability enrichment** — that is the backend's core job, and it may
hold multiple enrichment sources. To stop the backend from scope-creeping as the product grows, the
rule is: **any new data source or data type that is not vulnerability enrichment belongs in the data
collector.** The backend receives, handles (possibly enriches), and presents data, and owns user
context; the data collector reaches out to new external sources and sends results back as callbacks (ADR-0005). Deciding
question for new work: *is this vulnerability enrichment?* If yes, backend; if it's a new source or
kind of data, the data collector.

### Private graph investigations

The `tpt-graph` repository also hosts the independently built and deployed Query workspace.
It generates Cypher with Vertex AI using an investigation question and cached Graph schema
metadata, validates it, and executes it directly over Bolt. Saved investigations rerun their
stored query and parameters without generation. There is no review-before-execution step.

The workspace owns a separate PostgreSQL catalogue for saved questions, queries, parameters,
and schema snapshots. It does not store result sets or generation diagnostics there, and
does not read the backend's PostgreSQL. Access is restricted through Entra group configuration
and the login sidecar. Application query checks and driver read routing are not a
database-enforced read-only guarantee; that boundary depends on Neo4j credentials.

This is an appsec investigation tool, not the proposed shared graph-access layer. It does
not change the rule that the TPT backend and frontend never query the Graph.

### Other invariants

- The backend is the single source of truth for vulnerability and enrichment data. No other
  service reads from its PostgreSQL.
- The data collector holds no state the backend depends on. It collects on request (HTTP from the
  backend, answered with 202) and sends facts back as callbacks; it makes no prioritization decisions.
- SSE events reach every backend pod through the SSE event log (Postgres LISTEN/NOTIFY), never
  through in-memory state alone — a browser is connected to one pod, but events can originate on
  any pod (ADR-0005).
- **The backend and frontend never touch the Graph — this is a deliberate boundary, not a WIP
  question.** The Graph is populated by Cartography and read only by appsec's own tools over direct
  Bolt: today tpt-graph (its own UI), the Query workspace, and the data collector's live
  `OldDeploymentsCheck`, each with its own Neo4j driver rather than a shared graph-access API.
  The *intent* is to make tpt-graph a shared
  graph-access layer so those tools drop their own Bolt drivers and the collector's direct access is
  retired — that layer does not exist yet and no migration is in code. But even then, graph access
  stays out of the backend and frontend; if TPT ever needs graph-derived data, it arrives via the
  data collector (ADR-0003), never by the backend querying the Graph.
- Local dev has two modes: Mode A (native dev servers, mocked auth) for active development,
  Mode B (full Docker Compose) for integration testing. See `local-dev/README.md`.
