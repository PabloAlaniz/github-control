# Contributing

Thanks for your interest in GitHub Control. Bug reports, ideas and pull requests are welcome.

## Getting set up

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev          # frontend on :13338, backend on :13337
npm run test:all     # frontend + backend
```

To run the self-hosted server locally: `npm start` (data goes to `back/data/`). To explore with fictional data: `DEMO=true npm start` (see "Demo mode" in the README).

## Before opening a pull request

- `npm run test:all` passes, and `cd back && npx tsc --noEmit` reports no errors.
- New behaviour has tests. The backend enforces coverage thresholds in CI.
- Keep changes focused; unrelated refactors are easier to review separately.

## Things worth knowing

- Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first. Routes and services must not import from `infrastructure/`; a test enforces it.
- **Storage changes** go through the ports in `back/src/application/ports/storage.ts` and must work on every adapter. Add the expected behaviour to `back/tests/contract/storage-contract.ts`; it runs against all of them.
- **Schema changes**: update `back/src/infrastructure/storage/schema.ts` and append a migration in `back/src/infrastructure/storage/sql/migrate.ts`. Never edit a released migration.
- The demo dataset (`docs/demo/demo-data.json`) gets its signals, uptime history and saved views from `npx tsx back/scripts/demo-signals.ts`. Run it again after changing the shape of a signal.
- The dark theme re-points Tailwind's palette (`front/src/styles/dark.css`) instead of using `dark:` variants: write components with the light palette and check them in both themes.
- Do not commit real tokens, connection strings or personal data, in code, tests or fixtures.

## Reporting security issues

Please do not open a public issue for a vulnerability. See [`SECURITY.md`](SECURITY.md).

## Commit messages

Commits on `main` follow [Conventional Commits](https://www.conventionalcommits.org/): `type: summary`, optionally `type(scope): summary`. The type decides the next version and what the changelog lists:

- `feat:` a new feature (minor version).
- `fix:` a bug fix (patch version).
- `feat!:` or `fix!:`, or a `BREAKING CHANGE:` footer, for a change that breaks existing setups.
- `docs:`, `test:`, `refactor:`, `perf:`, `ci:`, `build:`, `chore:` for everything else; these do not trigger a release on their own.

## Releasing

Releases are automatic. On every push to `main`, the **Release** workflow (release-please) opens or updates a pull request named `chore(main): release X.Y.Z` with the next version in the `package.json` files, the lockfile and the MCP server info, and the new section of `CHANGELOG.md`. Merging that pull request creates the tag `vX.Y.Z` and the GitHub release, and publishes the Docker image (`X.Y.Z`, `X.Y` and `latest`).

Do not bump versions by hand. To force a specific version, add a `Release-As: X.Y.Z` footer to a commit.

The workflow needs **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests** turned on.
