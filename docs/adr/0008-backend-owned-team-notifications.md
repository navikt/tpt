# ADR-0008: Backend-owned Team notifications with a stateless notifier

- **Status**: Accepted (not yet implemented)
- **Date**: 2026-11-20
- **Deciders**: @albrektsson (decision owner for each question in navikt/tpt#14)

## Context

Teams have asked to be told in Slack when they get new high-risk Vulnerabilities. Someone has to
decide *what* is new for a Team, *when* to tell them, and *how* to deliver the message, and has to
remember what has already been sent.

ADR-0004 says each service owns one capability and that a Slack notifier should be its own service.
`appsec-notifiers` already exists. Today it runs scheduled Naisjobs with a reusable Slack client,
and it falls back to the `appsec-aktivitet` channel when no team channel is found.

Two facts shape the placement:

- **Risk Scores are computed at read time** in the backend (`VulnerabilityRiskAssessor`); they are
  not stored during sync. Whether a Vulnerability crosses a Team's threshold can only be decided
  where the scoring happens.
- **The backend already tracks the Vulnerability lifecycle.** It stores discovery, `resolved_at`,
  and resolution gaps per natural key `(app_nais_id, cve_id, package_name)` (ADR-0006).

The alternative was a **stateful notifier** that owns settings, the ledger, and scheduling. It would
have to pull scored Vulnerabilities back from the backend, re-implement "what is new", and keep its
own database in step with the backend's lifecycle data.

## Decision

**`tpt-backend` owns all notification state and decides what to send and when.
`appsec-notifiers` offers a stateless REST API that delivers a given digest to a channel.**

### Backend capability is amended, not excepted

Deciding what is new and relevant for a Team is part of aggregation and presentation: it is a
different view over the same risk-scored data, pushed instead of pulled. The backend's capability
in ADR-0004 now reads:

> Aggregate vulnerability and findings data, risk-score it, resolve user context, and present it to
> Teams, in the frontend or as notifications.

`appsec-notifiers` is added to the capability map: *deliver a given message to a team channel.*
It makes no decisions about what to send and stores nothing.

### What the backend owns

- **Notification settings** per Team: enabled, threshold, destination (Slack channel ID), cadence,
  and who changed them and when.
- **Notification ledger**: which Vulnerabilities, by natural key, the Team has been told about in
  their current **active period**.
- **Outbox** of digests with status `PENDING`, `SENT` or `FAILED`, retries, and the next due time.
  Ledger items are marked notified only when their digest is `SENT`.

### What counts as new

- Threshold: TPT's Risk Score bands from `GET /config`, not source severity. A Team chooses
  "Immediately" only, or "Immediately" plus "Must be prioritized".
- A non-suppressed, unresolved Nais workload Vulnerability is new when it meets the threshold and
  has not been notified in its current active period. A Vulnerability that reappears after being
  resolved starts a new active period. A move from "Must be prioritized" to "Immediately" also
  notifies, for Teams that subscribe to both bands.
- When a Team enables notifications or lowers its threshold, Vulnerabilities that already qualify
  are taken as a baseline and are not sent.
- GitHub (Dependabot) Vulnerabilities are out of scope for now.
- Evaluation runs only after a **complete** Team sync. A Team sync with a failed Nais page must fail
  as a whole rather than resolve the Vulnerabilities it missed (navikt/tpt-backend#186).

### Who may change settings

Direct Nais team members of the Team and TPT admins (`ADMIN_GROUPS`). The backend checks this on
the server against Nais team membership, not against the user context, which also includes
Teamkatalogen and leader teams for relevance only (ADR-0002). As in ADR-0007, read relevance is
separate from authorization to act.

### Delivery

- A new dedicated TPT Slack app, owned by AppSec, with a bot token. It has no webhooks and no
  `chat:write.public`. The bot must be invited to a channel. Externally shared (Slack Connect)
  channels are rejected, and there is no fallback channel.
- The backend sends a structured digest synchronously, using Entra client credentials. The
  notifier renders it in Norwegian and returns the Slack message reference or an RFC 7807 problem.
  The notifier owns the contract as an OpenAPI spec in `appsec-notifiers`. The draft is in
  navikt/appsec-notifiers#47. It also has endpoints to validate a
  channel and to send a test message, which the settings page uses.
- The digest job runs on the Nais leader pod and claims each digest with a row lock, because
  leadership can change during a run. Retryable errors are retried with backoff for about 24 hours,
  honouring `Retry-After`. After that the digest fails and its items roll into the next one.
- Ambiguous outcomes (timeout or 5xx) are retried with the same `deliveryId`. The notifier attaches
  the ID as Slack message metadata and checks channel history before posting again. This prevents
  duplicates without storing anything in the notifier.

## Consequences

**Positive**

- One place decides what is new, next to the scoring and lifecycle data it depends on.
- The notifier stays small and stateless, and other channels can be added there without changing
  TPT's decision logic.
- Fixing partial syncs (navikt/tpt-backend#186) also improves resolution history and Security Status.

**Negative / trade-offs**

- The backend grows: settings, ledger, outbox, scheduling and an authorization check for writes.
  The capability sentence is wider, so new "push" features must still pass the ADR-0004 test on
  their own.
- Duplicate prevention depends on Slack message metadata and channel history (`channels:history`,
  `groups:history`). If that lookup fails, a retry can still produce a duplicate.
- Delivery quality depends on sync completeness. A sync that falsely resolves Vulnerabilities would
  cause notifications to be sent again.
- `appsec-notifiers` gains a long-running Nais Application next to its Naisjobs.

## Related

- navikt/tpt#14 — the research ticket with every question, answer and owner.
- navikt/tpt-backend#184 — backend implementation. navikt/tpt-backend#186 — partial pagination bug.
- ADR-0002 (user context is not authorization), ADR-0004 (amended here), ADR-0006 (lifecycle
  facts), ADR-0007 (separate authorization for write actions).
