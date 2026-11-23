# Roadmap

Where GitHub Control is heading. Nothing here is a promise; priorities follow what people actually use. Ideas and votes are welcome in the issues.

## Done

- Dashboard with groups, priorities, notes, health score, CI status, bulk actions
- Daily metrics history with charts and comparison
- Monorepo app detection, services with health checks, coverage from CI
- AI summaries of READMEs
- Pluggable storage: SQLite, JSON, CSV, PostgreSQL, with a shared contract test suite
- Self-hosting without configuration: setup wizard, Docker image, built-in scheduled sync
- Admin CLI: migrations, copying data between storages, backups
- Traffic history: views, clones, referrers and popular paths kept beyond GitHub's 14 days, per repo and across repos
- Embeddable SVG badges for public repos
- Full sync from the dashboard, with progress
- Settings page: GitHub token, organizations, sync interval, badges, password
- Saved views, filters in the URL, command palette and keyboard navigation
- Signals per repo: standards checklist, security alerts, releases, branch hygiene with cleanup, CI reliability, settings drift with a configurable baseline
- Cross-repo dependency inventory with end-of-life runtimes
- Uptime history for services, checked on a schedule
- Demo mode: one variable starts the app on a fictional dataset, editable or read-only
- Dark theme, following the system or chosen by hand
- Inbox: open pull requests and issues across repos, with sections, saved filters, keyboard navigation and guarded bulk merge
- Alerts for failing CI, services down, serious security alerts, stale repos and low health, sent to Slack, Discord, Telegram, ntfy or a webhook, with daily or weekly digests

## Next

- **Release download counts.**
- **Summary cards** (SVG) with totals across repos.

## Later

- **Inbox**: check status of each pull request in the list, review and comment without leaving it.
- **Alerts by email**, and rules of your own.
- **AI cost attribution**: track AI coding assistant usage per repo.
- **Search across repos.**
- GitHub App / OAuth sign-in, multiple users.
- Better mobile layout.
- Dependency inventory from lockfiles (resolved and transitive versions) and more ecosystems.

## Known limitations

- The JSON and CSV stores rewrite a whole collection file on each change and support one running instance.
- On Cloudflare Workers the full sync must be run by an external script.
- The dependency inventory reads direct dependencies declared in npm, PyPI, Go and Cargo manifests; it does not read lockfiles. End-of-life dates for Node and Python are a table in the code that has to be updated by hand.
- Signals look at one page of results: the latest 100 workflow runs, 100 branches, 100 alerts per source and the 100 most recently updated open pull requests and issues.
- The inbox is as fresh as the last sync or Refresh, and does not show the check status of a pull request; checks are verified when merging.
- Uptime is computed from periodic checks (every 15 minutes unless `SERVICE_CHECK_MINUTES` says otherwise), so an outage shorter than the interval can go unnoticed.
- Alerts are evaluated after a sync or a round of service checks, not when something changes on GitHub: a broken build is noticed at the next sync. A failed delivery to a channel is recorded but not retried.
- The standalone sync scripts under `back/scripts/` support PostgreSQL only.
