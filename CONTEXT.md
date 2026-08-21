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
- **Compliance** — PoC state. Deals with compliance Findings and required Actions. The vocabulary
  here is deliberately separate from vulnerability prioritization: "finding" in this context means
  a compliance gap, not a CVE hit.
- **Golden path** — in development. Surfaces Findings: issues that do not follow best practices
  across GitHub repositories and Nais deployments. "Finding" here means a best-practice deviation.

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
| **User context** | The backend's resolution of the authenticated user (`preferred_username`) to the Teams they belong to, used to fetch that user's relevant data. A relevance mechanism, not access control — see ADR-0002. Owned by the backend. |
| **Data collector** | The `tpt-data-collector` service. The home for **new data sources and data types that are not vulnerability enrichment** (ADR-0003). On request from the backend (over HTTP) it collects data — e.g. GitHub vulnerability alerts via GraphQL, Cartography/Neo4j checks — and publishes it to Kafka. Never called "collector service" or "tpt-data-collector" in domain language — just "the data collector". |
| **Cartography** | CNCF tool that models cloud, GitHub, Kubernetes, and Nais resources as a graph and populates Neo4j. It is the writer to the graph, not a TPT service. |
| **Graph** | The Cartography-populated Neo4j graph of infrastructure, ownership, and dependency relationships. Today it is read over direct Bolt by appsec's own tools; it is not yet a datasource for the backend or frontend. |
| **tpt-graph** | An appsec-owned service that reads the Graph over Bolt and serves a read-only attack-path web UI plus a small JSON API for its own frontend. The intent to make it a general graph-access layer for the rest of TPT is research, not current state — see "Architectural intent". |
| **Sync** | A scheduled or on-demand operation that refreshes data from an external source into PostgreSQL. Sync kinds are named after their Kafka command key (e.g. `team_sync`, `vuln_data_sync`, `gcve_sync`); the current set lives in code, not here. |
| **SSE** | Server-Sent Events — the backend's push channel to the frontend. Events are **signals, not data**: an event tells the frontend something changed; the frontend then re-fetches over REST (the "notify-then-fetch" pattern). Cross-service progress originates as Kafka signals from the data collector, which the backend re-broadcasts over SSE. |
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
| `tpt-data-collector` | tpt | Collect findings data from external sources (GitHub, platform, …) on request from the backend and publish it to Kafka. The concern is *findings collection*, not any specific integration. |
| `tpt-graph` | appsec | Serve graph-derived data (attack paths, infrastructure relationships) from the Cartography/Neo4j graph. |
| `tpt` (this repo) | tpt | IaC, docs, local dev stack, schemas, test data, agent tooling |

## The Kafka seam

The backend and the data collector meet over **one shared Kafka topic** (`appsec.tpt`, JSON values,
no schema registry). The message **key is a type discriminator**, not a partition/entity key. Three
kinds of message ride the same topic, told apart only by key:

- **commands** — "do this sync" (mostly backend→backend, an internal work queue)
- **lifecycle signals** — "a sync started / finished" (drive SSE to the frontend)
- **data payloads** — the actual collected data the backend ingests into PostgreSQL

Only three keys actually cross the repo boundary (data collector → backend): a *started* signal, a
*finished* signal, and the vulnerability **data payload**. Everything else is backend-internal.

> **The keys and payload schemas are volatile — they change often and are added to freely.** The
> authoritative, current list lives in the code (`KafkaKey` in the backend; the string literals in
> the data collector), **not here**. This document describes the *shape* of the seam, not its
> contents. Two consequences worth knowing: keys are hand-written strings with **no shared schema
> or code between repos**, so a rename on one side silently breaks the other; and the same is true
> of SSE event names. Treat both as contracts maintained by convention, verified against code.

The data collector never writes to PostgreSQL — it publishes; the backend consumes and stores. The
backend is the single reader/writer of its own PostgreSQL.

## The refresh choreography (notify-then-fetch)

Data is cached in the backend's PostgreSQL and refreshed asynchronously. The stack keeps the UI live
during a refresh with a consistent **notify-then-fetch** pattern — SSE carries the *signal*, REST
carries the *data*:

1. The frontend asks the backend to refresh (e.g. a team's GitHub data).
2. The backend clears the stale data and asks the data collector for fresh data (over HTTP).
3. The data collector emits a **started** signal, does the work, publishes the **data** to Kafka,
   then emits a **finished** signal. Signals travel as Kafka messages; the backend re-broadcasts
   them to the frontend over SSE.
4. On the *finished* signal the frontend **re-fetches over REST** — the SSE event itself carries no
   data, only the news that fresh data is now available.

The same shape recurs for team/vulnerability syncs (triggered over Kafka rather than HTTP). The
invariant is the pattern; the specific endpoints, event names, and keys live in code and change.

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
context; the data collector reaches out to new external sources and publishes to Kafka. Deciding
question for new work: *is this vulnerability enrichment?* If yes, backend; if it's a new source or
kind of data, the data collector.

### Other invariants

- The backend is the single source of truth for vulnerability and enrichment data. No other
  service reads from its PostgreSQL.
- The data collector holds no state the backend depends on. It collects on request (HTTP from the
  backend) and publishes facts to Kafka; it makes no prioritization decisions.
- **The backend and frontend never touch the Graph — this is a deliberate boundary, not a WIP
  question.** The Graph is populated by Cartography and read only by appsec's own tools over direct
  Bolt: today tpt-graph (its own UI) and the data collector's live `OldDeploymentsCheck`, each with
  its own Neo4j driver, neither reading through the other. The *intent* is to make tpt-graph a shared
  graph-access layer so those tools drop their own Bolt drivers and the collector's direct access is
  retired — that layer does not exist yet and no migration is in code. But even then, graph access
  stays out of the backend and frontend; if TPT ever needs graph-derived data, it arrives via the
  data collector (ADR-0003), never by the backend querying the Graph.
- Local dev has two modes: Mode A (native dev servers, mocked auth) for active development,
  Mode B (full Docker Compose) for integration testing. See `local-dev/README.md`.
