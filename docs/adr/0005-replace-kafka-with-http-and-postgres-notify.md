# ADR-0005: Replace Kafka with HTTP callbacks and Postgres LISTEN/NOTIFY

- **Status**: Accepted
- **Date**: 2026-09-29
- **Deciders**: TPT team
- **Supersedes**: the "Kafka seam" parts of ADR-0003 (the responsibility split itself still stands)

## Context

The backend and the data collector share one Kafka topic (`appsec.tpt`). Three unrelated kinds of
message travel on it, and the message key tells them apart:

1. **A backend work queue** (`team_sync`, `vuln_data_sync`, `gcve_sync`). Kafka gives us little here:
   - The key is the command type, so every command of one type lands on the same partition and runs
     on the same pod. No work is spread across pods.
   - Duplicate runs are blocked by a Postgres sync lock, not by Kafka.
   - A failed command is not retried until the pod restarts or partitions are reassigned.
   - The schedulers already run only on the leader pod.
2. **Data and signals from the data collector** (vulnerability data per repo, check results,
   GitHub sync started/complete). The data collector never checks whether a send succeeded, so
   failures are lost without an error. The vulnerability payload per repo has no size limit and can
   go over Kafka's 1 MB default.
3. **SSE broadcast across the backend's pods.** Each pod uses its own consumer group so that every
   pod gets every event and can push it to the browsers connected to it. There is no replay: events
   sent while a pod is restarting, or while a browser reconnects to another pod, are lost.

Keys and payloads are strings kept in sync by convention, with no shared schema. We run and pay for
a Kafka topic, pool config on both apps, and a separate tpt-kafka-manager app for this.

The hard problem is (3): a browser holds one SSE connection to one backend pod, but the event can
come from any pod.

## Decision

**Remove Kafka from the TPT stack. Use HTTP between the backend and the data collector, run the
backend's own jobs in-process, and use Postgres LISTEN/NOTIFY with an events table for SSE across
pods.**

### 1. The backend triggers jobs over HTTP

The backend calls the data collector to start a job. The data collector validates the request,
answers **202 Accepted**, and does the work in the background. Invalid input gets **400**. This
applies to every trigger endpoint, including those that answer 200 today.

### 2. The data collector sends results back with callbacks

When results are ready, the data collector POSTs them to backend endpoints (**callbacks**):

- GitHub vulnerability data, **one request per repo**
- check results (both from backend-triggered jobs and from the GitHub webhook)
- sync lifecycle signals (started / complete). "Complete" is always sent, from a `finally` block,
  so the frontend never waits for a signal that will not arrive.

Rules for callbacks:

- Auth is Entra ID machine-to-machine (client credentials). The backend accepts callbacks only
  from tpt-data-collector.
- The data collector checks the response of every call and retries with backoff. Failures that
  survive the retries are logged and counted in a metric.
- **`/internal` paths are reserved for health checks and metrics.** Callback endpoints must not use
  them. Each repo decides its own paths and payload details; this ADR does not fix them.

### 3. The backend runs its own jobs in-process

- `team_sync` runs in the background on the pod that got the trigger.
- `vuln_data_sync` and `gcve_sync` run directly in the scheduler on the leader pod.
- The existing Postgres sync lock still prevents duplicate runs.
- `team_sync_complete` is sent by the sync itself, whatever triggered it. Today it is only sent on
  the Kafka path.

Jobs are not durable. If a pod dies mid-job, the next schedule or stale read starts it again. This
is roughly the behaviour we have today.

### 4. SSE across pods: Postgres LISTEN/NOTIFY plus an events table

- To publish an event, the backend inserts a row into an **SSE event log** table (id, type,
  payload, created_at) and calls `pg_notify` with the row id **in the same transaction**.
- Each pod holds one dedicated connection, outside the connection pool, that runs `LISTEN`. It
  reads the notified rows and emits them on the pod's local SSE bus. Team filtering stays as it is.
- Every SSE event carries an `id:`. When a browser reconnects with `Last-Event-ID`, possibly to a
  different pod, the backend replays the events it missed from the table.
- When the listener connection drops, the pod reconnects and catches up from the last id it saw.
- A cleanup job on the leader pod deletes events older than about 1 hour.
- NOTIFY carries only the id, well below Postgres's 8 KB payload limit. Events remain signals, not
  data (notify-then-fetch).

### 5. Retire Kafka

Remove the `appsec.tpt` topic, tpt-kafka-manager, the Kafka pool config on both apps, and all Kafka
clients and consumers.

## Consequences

**Positive**

- No Kafka infrastructure to run, configure or pay for.
- Failed sends become visible errors instead of being lost silently.
- No 1 MB message limit.
- SSE events can be replayed after a reconnect, which Kafka did not give us.
- Fits the notify-then-fetch pattern cleanly.
- The contract between backend and data collector becomes HTTP endpoints, which are easier to
  test, stub (WireMock in this repo) and document than keys on a shared topic.

**Negative / trade-offs**

- **The data collector depends on the backend being up** to deliver results. Retries soften this,
  but results are lost if the backend is down longer than the retry window. The next sync fixes it.
- **Background jobs are lost on pod restart**, in both services. Same as today in practice.
- **The LISTEN connection needs care**: a reconnect loop, catch-up from the last id, and a health
  metric.
- **The events table adds a little write load** to Postgres, plus a cleanup job.
- **Traffic now flows in both directions** between the two services, so both need access policies
  for each other.

## Alternatives considered

- **Pod-to-pod HTTP broadcast.** Nais has no clean way for a pod to find its siblings. Brittle.
- **Valkey pub/sub.** Works, but adds infrastructure for something Postgres already does.
- **Sticky sessions.** Do not help: the job that produces an event often runs on a different pod
  from the one holding the browser's SSE connection.
- **Polling the events table without NOTIFY.** Simpler, but adds 1–2 s latency and constant
  queries. Kept as the fallback if LISTEN turns out awkward with our database stack.
- **Synchronous request/response** (the backend waits for the data in the response). GitHub
  collection can take minutes, and webhook-triggered check results have to be pushed anyway.
- **A durable job table** (`SELECT … FOR UPDATE SKIP LOCKED`). Not needed yet; the schedules and
  stale-read triggers recover lost jobs. Revisit if lost jobs become a problem.

## Rollout

1. The backend adds the callback endpoints and the SSE event log, running alongside Kafka.
2. The data collector switches from Kafka to callbacks, and its triggers answer 202.
3. The backend moves its own commands off Kafka and removes the SSE fan-out consumer.
4. Remove the Kafka consumers, the topic, tpt-kafka-manager and the pool config.

Before deleting the topic, confirm that appsec-stats and appsec-vulnerability-stats (which have
write access) do not depend on it.

## Related

- ADR-0003 — backend / data-collector responsibility split (still valid; transport superseded here).
- `CONTEXT.md` → "The collector callback seam", "The refresh choreography".
