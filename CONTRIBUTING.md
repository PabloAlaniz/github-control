# Contributing

Thanks for your interest in GitHub Control. Bug reports, ideas and pull requests are welcome.

## Getting set up

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev          # frontend on :13338, backend on :13337
npm run test:all     # frontend + backend
```

To run the self-hosted server locally: `npm start` (data goes to `back/data/`). To explore with fictional data, see "Try it with demo data" in the README.

## Before opening a pull request

- `npm run test:all` passes, and `cd back && npx tsc --noEmit` reports no errors.
- New behaviour has tests. The backend enforces coverage thresholds in CI.
- Keep changes focused; unrelated refactors are easier to review separately.

## Things worth knowing

- Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first. Routes and services must not import from `infrastructure/`; a test enforces it.
- **Storage changes** go through the ports in `back/src/application/ports/storage.ts` and must work on every adapter. Add the expected behaviour to `back/tests/contract/storage-contract.ts`; it runs against all of them.
- **Schema changes**: update `back/src/infrastructure/storage/schema.ts` and append a migration in `back/src/infrastructure/storage/sql/migrate.ts`. Never edit a released migration.
- Do not commit real tokens, connection strings or personal data, in code, tests or fixtures.

## Reporting security issues

Please do not open a public issue for a vulnerability. See [`SECURITY.md`](SECURITY.md).
