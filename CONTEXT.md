# TPT — Context

## Purpose of this repository

This repository is the **test rig** for the TPT stack. Its primary job is to run all TPT services
from production code in a single Docker Compose environment — isolated from production, with
controlled data — so the team can verify end-to-end behaviour, demo the product, and catch
breaking contract changes with external APIs before they reach production.

Everything else here (schemas, test data, docs, scripts) exists in service of that goal.

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
| **Data collector** | The `tpt-data-collector` service. Receives GitHub webhooks, runs Cartography checks against Neo4j, and publishes enriched data to Kafka. Never called "collector service" or "tpt-data-collector" in domain language — just "the data collector". |
| **Sync** | A scheduled or on-demand operation that pulls data from an external source (Nais API, GCVE) and stores it in PostgreSQL. Named: `team_sync`, `vuln_data_sync`, `gcve_sync`. |
| **SSE** | Server-Sent Events — used by the backend to push sync lifecycle events to the frontend. |

## Retired synonyms

| Avoid | Use instead |
|---|---|
| "issue" (for a CVE hit) | Vulnerability |
| "app" or "service" (for a Nais entity) | Workload |
| "priority score" | Risk Score |
| "collector service" | data collector |
| "finding" (in vulnerability context) | Vulnerability |

## Repository map

| Repo | Owner | Responsibility |
|---|---|---|
| `tpt-backend` | tpt | Ktor API — vulnerability aggregation, risk scoring, Kafka sync, admin endpoints, PostgreSQL |
| `tpt-frontend` | tpt | Next.js UI — dashboard, per-team views, compliance tab, golden-path tab |
| `tpt-data-collector` | tpt | GitHub webhook receiver, Cartography/Neo4j, Kafka producer |
| `tpt` (this repo) | tpt | IaC, docs, local dev stack, schemas, test data, agent tooling |

The seam between backend and data collector is **Kafka**. The data collector never writes to
PostgreSQL directly — it publishes; the backend consumes and stores.

## Architectural intent

- Auth is owned by Nais sidecars (Wonderwall, Texas). Application code never handles tokens
  directly — it calls Texas for OBO exchange and introspection.
- The backend is the single source of truth for vulnerability and enrichment data. No other
  service reads from its PostgreSQL.
- The data collector is stateless beyond Neo4j (Cartography). It produces facts; it does not
  make prioritization decisions.
- Local dev has two modes: Mode A (native dev servers, mocked auth) for active development,
  Mode B (full Docker Compose) for integration testing. See `local-dev/README.md`.
