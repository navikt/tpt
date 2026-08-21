# ADR-0003: The data collector owns new data sources; the backend owns enrichment, user context, and presentation

- **Status**: Accepted
- **Date**: 2026-08-21
- **Deciders**: TPT team

## Context

TPT began as a **vulnerability enrichment and prioritization** tool. That is the backend's original
and central purpose: take vulnerabilities, enrich them (KEV, EPSS, CVSS, SSVC via GCVE, plus other
sources over time), risk-score them, and present them per team to the user.

The backend has historically had **multiple sources** feeding vulnerability enrichment, and that set
changes. But as TPT grew, new *kinds* of data appeared that are not vulnerability enrichment —
compliance findings, golden-path/best-practice deviations, GitHub repository facts, graph/Cartography
data. Putting all of that into the backend would bloat it and creep its scope far beyond its reason
for existing.

We needed a rule for **where new data belongs** so the backend stays focused.

## Decision

**The data collector is the home for any new data source or data type that is not vulnerability
enrichment. The backend receives, handles (possibly enriches), and presents data — and owns user
context — but does not grow new collection responsibilities.**

The split:

- **Backend** — vulnerability enrichment and risk scoring (its original goal); resolving **user
  context** (mapping the authenticated identity to the user's Teams — see ADR-0002); receiving data,
  handling and possibly enriching it, and presenting it to the frontend; sole owner of its
  PostgreSQL. Vulnerability *enrichment* sources may live here, because that is the backend's core
  job.
- **Data collector** — the landing place for **new data sources and new data types not related to
  vulnerability enrichment.** It collects on request (HTTP from the backend), reaches out to
  external systems (GitHub, Cartography/Neo4j, …), and publishes results to Kafka. It makes no
  prioritization or presentation decisions.

Rule of thumb for new work: **if it's a new source/kind of data that isn't vulnerability enrichment,
it goes in the data collector.** If it's enriching or presenting vulnerabilities, or resolving who
the user is, it's the backend.

## Consequences

**Positive**

- **The backend stays focused** on enrichment, user context, and presentation; it does not accrete
  every new integration.
- **Clear home for new data**, so contributors don't have to relitigate placement each time.
- **The Kafka seam is the buffer** between "collecting" and "handling/presenting," keeping the two
  concerns decoupled and independently testable.

**Negative / trade-offs**

- **The boundary can blur** for data that is arguably enrichment *and* a new source. "Is this
  vulnerability enrichment?" is the deciding question, and it will occasionally need a judgment call.
- **Two services to run and reason about** for a single user-visible feature, with the notify-then-
  fetch choreography (see `CONTEXT.md`) spanning both.
- **Some historical/edge behaviour doesn't fit cleanly** — e.g. the data collector currently holds a
  direct Neo4j read (`OldDeploymentsCheck`), which is graph data, not vulnerability enrichment; it
  fits the "new data type in the collector" rule but is slated to move behind tpt-graph.

## Related

- `CONTEXT.md` → repository map, "The Kafka seam", "Architectural intent".
- ADR-0002 — user context lives in the backend.
