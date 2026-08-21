# navikt/tpt — Agent Instructions

This repository serves two roles for the TittPåTing (TPT) stack:

1. **Test rig** — it runs all TPT services from production code in a single Docker Compose
   environment so the team can verify end-to-end behaviour, demo the product, and catch breaking
   contract changes with external APIs. It is not a deployable service.
2. **Shared knowledge & coordination hub** — it is where the team does cross-cutting work that
   spans multiple TPT repos: architecture decisions (ADRs), research notes, brainstorming, and
   breaking large initiatives into tickets (`to-tickets`) for the individual service repos. The
   shared memory and vocabulary that hold the stack together live here.

See `README.md` for an overview.

## Read first

Before exploring or modifying anything, read:

- `CONTEXT.md` — ubiquitous language, domain concepts, repository map, architectural intent.
- `docs/adr/` — architecture decision records for cross-cutting decisions.
- `docs/architecture/README.md` in `tpt-backend` — system diagram and component table (not in this repo).

## Task scope — what happens in this repo

Two kinds of work happen here:

**Test rig** — keep it green and maintainable:

- Update and validate the Docker Compose stack (`local-dev/`) — this is the core rig artifact
- Maintain WireMock stubs and test data (`scripts/generate-mocks.*`, `test-data/`) — the controlled dataset that makes the rig useful
- Maintain schemas (`schemas/`) — shared contracts between services and external APIs
- Maintain agent tooling (`docs/agents/`, `AGENTS.md`, `CONTEXT.md`)

**Coordination hub** — capture and shape cross-cutting work:

- Record architecture decisions in `docs/adr/`
- Keep `CONTEXT.md` current as the ubiquitous language evolves
- Research and brainstorm stack-wide changes here, then split them into tickets for the service repos

## Out of scope

- Do not modify application code in sibling repos (`tpt-backend`, `tpt-frontend`, `tpt-data-collector`, `tpt-graph`) directly from this repo.
- Do not deploy anything. This repo has no deploy pipeline.
- Do not commit secrets, tokens, or real credentials. `local-dev/keys/` contains test-only RSA keys — these are not secrets.

## Git: never commit

Agents **must never commit, amend, push, or otherwise write to git history.** Commits require a
signature that only the user can and should provide.

- Stage files (`git add`) and **draft** a commit message for the user, but stop there — the user runs `git commit`.
- Read-only git inspection is fine: `git status`, `git diff`, `git show`, `git log`.
- Never run `git commit`, `git commit --amend`, `git push`, `git rebase`, `git reset --hard`, or anything that rewrites or publishes history.
- This applies to sibling repos too — the same rule holds there.

## Verification commands

After changing `local-dev/docker-compose.yml`:
```bash
docker compose -f local-dev/docker-compose.yml config --quiet
```

After changing scripts:
```bash
bash -n scripts/bootstrap.sh
bash -n scripts/generate-mocks.sh
```

## Secrets and credentials

This repo uses `fnox` for secret injection. Never put secrets in `.env` files or hardcode them.
Run commands that need secrets with `fnox exec -- <command>`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues at navikt/tpt (uses `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` at repo root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.

### Keeping the memory in sync

Work lands in the sibling repos without always passing through here. The `sync-memory` project
skill (`.opencode/skills/sync-memory/`) sweeps the sibling repos since a per-repo watermark
(`docs/agents/sync-state.json`), finds memory-worthy changes, and proposes `CONTEXT.md`/ADR edits
plus draft tickets for approval. Run it to catch up the shared memory ("catch up the memory",
"what changed across the repos").
