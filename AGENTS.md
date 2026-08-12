# navikt/tpt — Agent Instructions

This repository is the **test rig** for the TittPåTing (TPT) stack. Its primary job is to run all
TPT services from production code in a single Docker Compose environment so the team can verify
end-to-end behaviour, demo the product, and catch breaking contract changes with external APIs.
It is not a deployable service. See `README.md` for an overview.

## Read first

Before exploring or modifying anything, read:

- `CONTEXT.md` — ubiquitous language, domain concepts, repository map, architectural intent.
- `docs/architecture/README.md` in `tpt-backend` — system diagram and component table (not in this repo).

## Task scope — what happens in this repo

The test rig comes first. Prioritise keeping it green and maintainable:

- Update and validate the Docker Compose stack (`local-dev/`) — this is the core artifact
- Maintain WireMock stubs and test data (`scripts/generate-mocks.*`, `test-data/`) — the controlled dataset that makes the rig useful
- Maintain schemas (`schemas/`) — shared contracts between services and external APIs
- Maintain agent tooling (`docs/agents/`, `AGENTS.md`, `CONTEXT.md`)

## Out of scope

- Do not modify application code in sibling repos (`tpt-backend`, `tpt-frontend`, `tpt-data-collector`) directly from this repo.
- Do not deploy anything. This repo has no deploy pipeline.
- Do not commit secrets, tokens, or real credentials. `local-dev/keys/` contains test-only RSA keys — these are not secrets.

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

Single-context layout: `CONTEXT.md` at repo root, ADRs in `docs/architecture/decisions/`. See `docs/agents/domain.md`.
