# CI Workflow Convention

Standard naming and structure for GitHub Actions workflows across all repos.

## Workflow Files

| File | Name | What it runs | When |
|------|------|-------------|------|
| `ci.yml` | CI | lint + typecheck + unit tests + build | PR + push to main |
| `report-coverage.yml` | Report coverage | coverage collection → dashboard | push to main |

## Job Structure (ci.yml)

Split into independent parallel jobs that reflect the testing columns in the dashboard:

```
test-frontend  ──┐
test-backend   ──┼──> build
typecheck      ──┘
```

- **test-frontend**: `npx vitest run` (root)
- **test-backend**: `cd cloudflare && npx vitest run`
- **typecheck**: `cd cloudflare && npx tsc --noEmit` (when TS errors are resolved)
- **build**: `npm run build` — runs after all checks pass

## Principles

1. **Split only when jobs have distinct dependencies, runtimes, or triggers** — don't create a separate workflow just for naming. A single `ci.yml` with parallel jobs is fine.
2. **Name jobs descriptively** — `Test / Frontend`, `Test / Backend`, `Build` — so GitHub status checks are readable.
3. **Build depends on tests** — don't deploy or build if tests fail.
4. **Coverage is separate** — `report-coverage.yml` runs independently on push to main, since it's not a gate for PRs.

## Adding New Test Types

When a repo adds E2E tests (Playwright, Cypress), add a new job:

```yaml
  test-e2e:
    name: Test / E2E
    needs: [build]  # E2E may need built assets
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx playwright test
```

## Monorepo Pattern

For repos with multiple apps (e.g., `apps/web`, `apps/api`), use a matrix or separate jobs per app:

```yaml
  test:
    strategy:
      matrix:
        app: [web, api]
    steps:
      - run: cd apps/${{ matrix.app }} && npm test
```
