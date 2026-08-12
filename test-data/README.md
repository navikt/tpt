# Test Data

This directory contains example JSON payloads for overriding the built-in mock data in `tpt-backend`
during local development (Mode A).

## How to use

Copy the files you want to `tpt-backend/src/test/resources/`:

```bash
cp mock/mock-vulnerabilities.json ../tpt-backend/src/test/resources/
cp mock/mock-github-data.json ../tpt-backend/src/test/resources/
```

Then start the backend:

```bash
cd ../tpt-backend
./gradlew runLocalDev
```

The backend detects these files at startup and uses them instead of the built-in minimal dataset.

## Using production data

For more realistic data, fetch it directly from the production API (requires Nav SSO login):

```bash
# Vulnerabilities
curl -H "Authorization: Bearer <your-token>" https://tpt.ansatt.nav.no/api/debug \
  > ../tpt-backend/src/test/resources/mock-vulnerabilities.json

# GitHub data
curl -H "Authorization: Bearer <your-token>" "https://tpt.ansatt.nav.no/api/debug?endpoint=github" \
  > ../tpt-backend/src/test/resources/mock-github-data.json
```

**Both files are gitignored in `tpt-backend`** — production dumps can be large and must never be committed.

## File shapes

The example files in `mock/` here contain minimal skeletons showing the expected data structure.
They are safe to commit (no real data).

| File | Used by | Shape |
|---|---|---|
| `mock/mock-vulnerabilities.json` | `tpt-backend` `MockNaisApiService` | `{ "teams": [{ "slug": "...", "workloads": [...] }] }` |
| `mock/mock-github-data.json` | `tpt-backend` `MockGitHubRepositoryWithData` | `{ "repositories": [{ "name": "...", "alerts": [...] }] }` |
