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
- Release download counts, CI and release badges, repo and summary cards with themes, and a page with the Markdown to copy
- Public status page for services, with a status badge
- Policy as code: baseline, health weights, custom checks and alert thresholds in one YAML document, from the app or a versioned file, with a dry run
- OpenSSF Scorecard as an optional signal for public repos
- MCP server: the dashboard as tools for coding agents
- Alerts for failing CI, services down, serious security alerts, stale repos and low health, sent to Slack, Discord, Telegram, ntfy, email or a webhook, with daily or weekly digests
- One navigation for every page, and a layout that works on a phone
- Code search across all tracked repos
- Alert rules of your own in the policy (coverage, CI reliability, unreleased commits, settings drift, Scorecard, end-of-life runtimes, custom checks)
- Check and review state of each pull request in the inbox, and a "ready to merge" section

## Next

- **Inbox**: review and comment on a pull request without leaving it.
- **AI cost attribution**: track AI coding assistant usage per repo.

## Later

- GitHub App / OAuth sign-in, multiple users.
- Dependency inventory from lockfiles (resolved and transitive versions) and more ecosystems.

## Known limitations

- The JSON and CSV stores rewrite a whole collection file on each change and support one running instance.
- On Cloudflare Workers the full sync must be run by an external script.
- The dependency inventory reads direct dependencies declared in npm, PyPI, Go and Cargo manifests; it does not read lockfiles. End-of-life dates for Node and Python are a table in the code that has to be updated by hand.
- Signals look at one page of results: the latest 100 workflow runs, 100 branches, 100 alerts per source and the 100 most recently updated open pull requests and issues.
- The inbox is as fresh as the last sync or Refresh, including the check and review state it shows; checks are verified again when merging.
- Code search goes through GitHub's code search: default branches only, about 10 searches a minute, the first 50 files, and at most 15 repo owners per search.
- Email alerts need the Node server or Docker; Cloudflare Workers cannot open SMTP connections.
- Custom checks look at file paths only (does a file exist, or not), not at file contents.
- The MCP server is stateless: one JSON answer per request, no streaming or server-initiated messages.
- Uptime is computed from periodic checks (every 15 minutes unless `SERVICE_CHECK_MINUTES` says otherwise), so an outage shorter than the interval can go unnoticed.
- Alerts are evaluated after a sync or a round of service checks, not when something changes on GitHub: a broken build is noticed at the next sync. A failed delivery to a channel is recorded but not retried.
- The standalone sync scripts under `back/scripts/` support PostgreSQL only.
