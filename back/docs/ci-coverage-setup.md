# Setting Up CI Coverage Reporting

Report test coverage from your repos' CI pipelines to the GitHub Control dashboard.

## Quick Setup

1. Copy `.github/workflows/report-coverage.yml` into the target repo
2. Adapt the "Run tests with coverage" step for the repo's stack
3. Set org-level variables (one-time):

| Type | Name | Description |
|------|------|-------------|
| Org variable | `DASHBOARD_URL` | `https://github-control.example.com` |
| Org secret | `COVERAGE_API_TOKEN` | Bearer token (maps to `CI_COVERAGE_TOKEN` on the Worker) |

4. Push to `main` — the workflow runs tests and reports coverage

## Adapting per Stack

The workflow file has two things to customize per repo:

**1. The test command** (install deps + run tests with JSON coverage output):

```yaml
# Node + Vitest (requires json-summary reporter, see note below)
- run: npm ci && npx vitest run --coverage
# Coverage JSON: coverage/coverage-summary.json

# Node + Jest
- run: npm ci && npx jest --coverage --coverageReporters=json-summary
# Coverage JSON: coverage/coverage-summary.json

# Python + pytest-cov
- run: |
    pip install -r requirements-dev.txt
    pytest --cov=app --cov-report=json
# Coverage JSON: coverage.json
```

**2. The `COVERAGE_JSON` path** in the reporting step (and the jq key):

| Stack | Path | jq key |
|-------|------|--------|
| Node (vitest/jest) | `coverage/coverage-summary.json` | `.total.lines.pct` |
| Python (pytest-cov) | `coverage.json` | `.totals.percent_covered` |

## Vitest: `json-summary` Reporter Required

For vitest repos, the coverage config in `vitest.config.js` **must** include the `json-summary` reporter — otherwise `coverage/coverage-summary.json` won't be generated and the workflow will fail:

```js
// vitest.config.js
export default defineConfig({
  test: {
    coverage: {
      reporter: ['text', 'json-summary'],  // json-summary required for CI
    },
  },
});
```

## How It Works

- On **pull requests**: runs tests (validates they pass) but does NOT report to dashboard
- On **push to main**: runs tests + reports coverage to the dashboard API

## Multi-Label Coverage

The dashboard supports **multiple coverage reports per repo** with labels. This is useful for repos with separate test suites (frontend, backend, e2e, etc.).

### How it works

- Each coverage report is identified by a `label` (e.g. `"frontend"`, `"backend"`)
- Labels are stored in the `coverage_reports` table with `UNIQUE(repo_full_name, label)` — reporting the same label overwrites the previous value
- The dashboard Coverage column shows all labels with their values and color-coded percentages
- Sorting by coverage uses the **average** of all labels
- If no label is sent, it defaults to `"default"`

### Single-suite repo

Use the `COVERAGE_LABEL` GitHub variable, or omit it to use `"default"`:

```yaml
COVERAGE_LABEL: ${{ vars.COVERAGE_LABEL || 'default' }}
```

### Multi-suite repo

Create one workflow job per suite, each with a hardcoded label:

```yaml
jobs:
  frontend:
    # ... run frontend tests ...
    - run: |
        curl ... -d '{"coverage": $COV, "label": "frontend", "commit_sha": "..."}'

  backend:
    # ... run backend tests ...
    - run: |
        curl ... -d '{"coverage": $COV, "label": "backend", "commit_sha": "..."}'
```

Both jobs run in parallel and report independently.

### Reading coverage reports

```
GET /api/repos/:owner/:repo/coverage
```

Returns all reports for that repo:
```json
[
  { "label": "backend", "coverage": 45, "commit_sha": "abc123", "reported_at": "..." },
  { "label": "frontend", "coverage": 58, "commit_sha": "abc123", "reported_at": "..." }
]
```

## API Reference

**Endpoint**: `POST /api/repos/:owner/:repo/coverage`

**Headers**:
- `Authorization: Bearer <token>` (required)
- `Content-Type: application/json`

**Body**:
```json
{
  "coverage": 85,
  "label": "frontend",
  "commit_sha": "abc123def456"
}
```

`coverage` is required (integer 0-100). `label` is optional (defaults to `"default"`).

**Response**:
```json
{
  "success": true,
  "coverage": 85,
  "label": "frontend"
}
```

## Server Configuration

Set the `CI_COVERAGE_TOKEN` secret on the Cloudflare Worker:

```bash
npx wrangler secret put CI_COVERAGE_TOKEN
```

This token is validated by the auth middleware. Requests with an invalid or missing token receive a `401 Unauthorized` response.
