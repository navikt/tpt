# ADR-0006: Compute Security Status from synced lifecycle facts

- **Status**: Accepted (implemented in production)
- **Date**: 2026-10-29
- **Deciders**: TPT team

This record documents the existing production architecture retrospectively; it
does not propose a new decision. The date above is the documentation date, not
the production rollout date.

## Context

Compliance now presents exposure, trend, maintenance, escalation level, and monthly
history per Team. The backend already owns Vulnerability enrichment, storage, and
presentation. Historical status needs evidence of resolved and returning
Vulnerabilities, Workload presence, and deployment age, not just today's open CVEs.

## Decision

Record lifecycle facts during backend sync and compute Security Status at read
time, rather than storing separate compliance snapshots. Retain resolved
Vulnerabilities, resolution gaps, Workload presence and absence, and deployment
facts within the configured history horizon.

Keep evaluation and active measurement rules in the backend. Return monthly
daily-status counts, missing coverage, the evaluated-through date, and whether
the month is provisional. The frontend renders these results and does not own
a duplicate status evaluator.

Security Status is distinct from a Vulnerability's Risk Score. It does not
assert that every compliance requirement has been assessed.

## Consequences

- Current status and history use the same backend rules.
- Recalculation with current rules is not an immutable audit snapshot.
- History is limited by recorded observations and retention; missing data must
  remain visible rather than being presented as successful compliance.
- Response-shape changes require coordinated backend/frontend changes; the
  monthly day-count change is already implemented on both sides.
- This stays within the backend's aggregation capability under ADR-0003 and
  ADR-0004; it does not add a new data-collector responsibility.

## Related

- [navikt/tpt-backend#148](https://github.com/navikt/tpt-backend/pull/148) and
  [navikt/tpt-backend#162](https://github.com/navikt/tpt-backend/pull/162)
- [navikt/tpt-frontend#203](https://github.com/navikt/tpt-frontend/pull/203) and
  [navikt/tpt-frontend#224](https://github.com/navikt/tpt-frontend/pull/224)
- `CONTEXT.md`: Security Status and the refresh choreography
