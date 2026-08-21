# ADR-0001: Keep shared memory in sync by sweeping the sibling repos (pull), not by asking them to report (push)

- **Status**: Accepted
- **Date**: 2026-08-21
- **Deciders**: TPT team

## Context

This repository holds the TPT stack's **shared memory** — the ubiquitous language in `CONTEXT.md`
and the architecture decisions in `docs/adr/`. That memory is only useful if it reflects what the
services actually do.

But the sources of truth for *what changed* are the sibling repos' git histories
(`tpt-backend`, `tpt-frontend`, `tpt-data-collector`, `tpt-graph`). Work lands in those repos
without necessarily passing through this one. Concretely:

- Multiple people work on the stack. **Some do not use agents at all**, and some use agents
  **without the `wayfinder` skill**, so cross-cutting work is not routed through this repo's
  coordination flow.
- As a result the memory **drifts**: a domain term gets renamed, a Kafka contract changes, or an
  architectural decision is made in code — and `CONTEXT.md`/`docs/adr/` never hear about it.

We need a reliable way to reconcile the memory with reality that does not depend on how a given
change was authored.

Two mechanisms were considered:

- **Push (at-source capture).** Each sibling repo's `AGENTS.md` instructs agents to open a "memory
  PR" against this repo whenever they change a domain term or a contract. Keeps memory fresh in real
  time.
- **Pull (periodic sweep).** On demand, sweep each sibling repo's history since a recorded
  watermark, reconcile against the memory, and propose updates.

## Decision

**Use pull as the backbone.** We reconcile the memory by sweeping the sibling repos since a per-repo
watermark, not by asking those repos to report their own changes.

This is implemented as the `sync-memory` project skill (`.opencode/skills/sync-memory/`):

- The watermark lives in `docs/agents/sync-state.json` (last reconciled commit SHA + date per repo).
- The sibling-repo list is derived from the repository map in `CONTEXT.md`, so it stays correct as
  the stack evolves.
- Each run fetches merged PRs and commits in the window, classifies changes as memory-worthy vs.
  routine, and proposes concrete `CONTEXT.md`/ADR edits plus draft tickets — all under human
  approval. Tickets are filed via the `to-tickets` skill; memory edits are applied to this repo.
- The watermark advances only on a completed, approved run.

Push is **explicitly not relied upon.** We may later add lightweight push hints in sibling repos to
reduce the sweep's workload, but push can never be the guarantee.

## Consequences

**Positive**

- Catches changes **regardless of how they were authored** — the whole point, given the mixed
  agent/non-agent, wayfinder/non-wayfinder reality of the team.
- No infrastructure or cross-repo coordination required; runs on demand from this repo.
- The watermark makes runs incremental, so catching up stays cheap after the first sync.
- Human approval on both memory edits and tickets keeps the memory trustworthy.

**Negative / trade-offs**

- **Retrospective, not real-time.** Memory is only as fresh as the last sweep; between runs it can
  lag. Someone has to remember to run it (mitigated by making it a discoverable project skill; a
  scheduled safety net was considered and deferred).
- The sweep **derives its repo list from `CONTEXT.md`'s repository-map table**, so a drastic change
  to that table's format could break detection.
- Classification biases toward **surfacing when unsure**, trading occasional noise for not letting
  the memory silently rot.
- Aborting a run late re-covers the same window next time, since the watermark advances only on
  approval.

## Related

- `.opencode/skills/sync-memory/SKILL.md` — the implementation.
- `docs/agents/sync-state.json` — the watermark.
- `docs/agents/domain.md` — how skills consume the memory and flag ADR conflicts.
