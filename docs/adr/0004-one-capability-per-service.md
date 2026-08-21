# ADR-0004: One capability per service

Each TPT service owns exactly one named capability. New functionality belongs in an existing service
only if it falls squarely within that service's capability; otherwise it goes in a new service.

## Context

ADR-0003 established a specific split: the backend owns vulnerability enrichment, user context, and
presentation; the data collector owns new data sources and data types that are not vulnerability
enrichment. That decision works well, but it is an instance of a more general principle the team
applies — or should apply — every time a new responsibility appears.

As TPT grows (whodis for ownership resolution, tpt-graph for graph access, future services for
notifications, etc.) we needed a stable, reusable rule so placement decisions don't get relitigated
each time.

## Decision

**Every service in the TPT stack owns exactly one capability. A capability is what the service does,
named in one sentence without an "and".**

Current capability map:

| Service | Capability |
|---|---|
| `tpt-backend` | Aggregate vulnerability and findings data, risk-score it, resolve user context, and present it to the frontend. |
| `tpt-data-collector` | Collect findings data from external sources (GitHub, platform, …) and publish it to Kafka. |
| `tpt-graph` | Serve graph-derived data (attack paths, infrastructure relationships) from the Cartography/Neo4j graph. |
| `whodis` | Resolve ownership — map workloads, repositories, and teams to the people and groups responsible for them. |

**"Concern" is capability-shaped, not integration-shaped.** The data collector's concern is
*findings collection* — not "GitHub". It may integrate with GitHub today and the Nais platform
tomorrow; that is not two concerns, because the capability (collect and publish findings data) stays
the same. A new integration is just the collector growing, not a reason to split.

**The backend is the permanent aggregation hub.** It fans out to specialised services, composes
their data, and hands results to the frontend. Specialised services do not call each other; they
publish (Kafka) or respond (HTTP) to the backend. New services plug into the backend's fan-out, not
into each other.

**Placement rule for new work:** name the capability of what you're building in one sentence. If
that sentence matches an existing service's capability, it belongs there. If it introduces an "and",
or if no existing service's capability covers it, it belongs in a new service.

## Consequences

**Positive**

- Placement decisions have a stable, shared decision rule rather than a case-by-case debate.
- Each service stays focused; scope creep is visible as a capability violation, not just a feeling.
- New services are easy to justify — the rule explains *why* a Slack notifier, for example, is its
  own service rather than a backend endpoint.

**Negative / trade-offs**

- The rule does not resolve every edge case. "Does this belong in the collector or the backend?"
  still requires judgment when data is both a new source *and* touches vulnerability enrichment;
  ADR-0003 provides the tie-breaker for that specific boundary.
- More services mean more operational overhead (deployment, auth, observability). The rule says
  *where* to put something, not *when* to build a new service — that is still a team judgment.

## Related

- ADR-0003 — the backend/collector split is the first concrete application of this principle.
- ADR-0002 — user context ownership is another application: resolving identity is a backend
  capability, so it stays there even though it touches external systems (Entra ID, Nais Console).
- `CONTEXT.md` → repository map and "Architectural intent".
