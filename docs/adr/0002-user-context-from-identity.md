# ADR-0002: Identity selects the user's relevant data (user context), not a confidentiality boundary

- **Status**: Accepted
- **Date**: 2026-08-21
- **Deciders**: TPT team

## Context

TPT presents vulnerability, compliance, and golden-path data **per Team**. A user opening the app
wants to see *their* teams' data without having to say which teams they belong to. We needed a way to
turn "who is logged in" into "which teams' data to show them."

Crucially, **vulnerability data in TPT is not secret** — and this rests on two conditions that hold
today:

1. **Access is already gated at the platform.** Only Nav developers can reach TPT at all
   (Wonderwall / Entra ID). Those same people can *already* browse the equivalent
   vulnerability and infrastructure data for the whole organisation directly — via the Nais console
   and GitHub. TPT surfaces nothing they couldn't already see.
2. **A deliberate stance: no security by obscurity.** We do not treat team-scoping as concealment.

So this is **not** an access-control problem. It is a *relevance* problem: automatically resolve the
caller's teams and fetch that data, so the user sees something useful by default instead of having to
specify teams.

The "not secret" property is therefore **conditional on that audience.** If TPT were ever opened to a
wider audience, or ingested data that is *not* already visible to that audience on the platform, this
premise — and this ADR — would need revisiting.

Even so, the design degrades safely. Access is restricted to our Entra ID tenant, so an external user
never reaches TPT in the first place. And even if they did, user-context resolution would yield
`userRole: none` and an empty Teams set — so the frontend renders no data. The identity-selects-data
model means "no resolved teams" naturally means "no data," with no special-casing.

The Nais platform gives us the Entra ID identity model
(https://doc.nais.io/auth/entra-id/): login via the Wonderwall sidecar, on-behalf-of (OBO) exchange,
and client-credentials (m2m). The question was how to use the authenticated identity to drive team
selection without building a bespoke roles/policy layer we don't actually need.

## Decision

**The authenticated employee's identity selects which data is relevant to them. This is a
convenience/relevance mechanism, not a confidentiality control.**

Concretely:

- The browser authenticates through **Wonderwall** (frontend). The frontend's server layer performs
  an **OBO** exchange (via the Texas sidecar) and calls the backend **as the user**, preserving the
  employee's identity across the hop.
- The backend validates the inbound token and reads the **`preferred_username`** claim. A backend
  **user-context service** resolves that identity to the user's Teams, and the "my data" routes
  (e.g. `/vulnerabilities/user`) fetch data for exactly those Teams.
- This is **derivation, not enforcement.** The backend figures out the user's teams as a default and
  fetches their data; it is not a gate that rejects access to other teams' (non-secret) data.
- Resolving the user's teams from identity — the **user context** — is owned by the **backend**
  (see ADR-0003). It is not the frontend's job or the platform's.
- Service-to-service calls with no user involved (backend → data collector) use the
  **client-credentials** flow — the caller acts as itself.

The invariant to preserve: **"my data" is derived from the token's identity, never taken as a
request parameter.** Not because exposing another team's data would be a breach, but because
identity-driven selection is what makes the product usable without a team picker.

## Consequences

**Positive**

- **No bespoke access-control layer to build or maintain.** Relevance falls out of identity + Team
  membership. This is the property the team values — it keeps the model simple.
- **Good default UX.** A user sees their teams' data immediately, with no configuration.
- **Uniform** across REST and the SSE stream (events are filtered to the user's Teams), and aligned
  with the platform's standard Entra flows.

**Negative / trade-offs**

- **This is NOT a confidentiality control.** It holds only while both premises hold: the audience is
  already-authenticated Nav developers, and TPT surfaces nothing they couldn't already see on the
  platform (Nais console, GitHub). If TPT ever opens to a wider audience or ingests data that *is*
  sensitive or not already platform-visible, this model gives no protection and a real authorization
  layer would be required. Do not mistake team-scoped responses for a security boundary — they are a
  relevance filter over non-secret data.
- **Team resolution quality drives correctness of the default.** If Teamkatalogen resolution is
  wrong, the user sees the wrong default set — a usability bug, not a breach.
- **Reality is more nuanced than "sidecars own all tokens."** The data collector validates inbound
  tokens itself against Entra's JWKS (not via Texas), and the backend attaches a mounted
  service-account token when calling the Nais Console API. Texas handles OBO exchange and
  introspection, but not universally. Documentation must not overstate the sidecars' role.

## Related

- `CONTEXT.md` → "Architectural intent → User context: identity selects relevant data".
- ADR-0003 — the backend/data-collector responsibility split (the user-context logic lives in the
  backend).
- Nais Entra ID model: https://doc.nais.io/auth/entra-id/
