# Changelog

## [0.3.1](https://github.com/PabloAlaniz/github-control/compare/v0.3.0...v0.3.1) (2026-11-25)


### Bug Fixes

* **security:** resolve open CodeQL code scanning alerts ([#22](https://github.com/PabloAlaniz/github-control/issues/22)) ([e8427c8](https://github.com/PabloAlaniz/github-control/commit/e8427c8607d253a39a7ebcd7141bbc1596e18d57))

## [0.3.0](https://github.com/PabloAlaniz/github-control/compare/v0.1.0...v0.3.0) (2026-11-24)

The first release since 0.1.0: version 0.2.0 was never tagged, so its changes ship here too.

### Features

* **Code search** across all tracked repos, from the app, the API and the MCP server.
* **Inbox**: check and review state of each pull request, a "ready to merge" section, and review or comment without leaving the page.
* **Report**: what changed in the last 7, 14 or 30 days.
* **Known vulnerabilities** (opt-in) of the versions pinned in lockfiles, from the OSV database, per repo and across repos.
* **Dependencies**: versions resolved from lockfiles, a finder for any package across repos, and Ruby, Java and .NET support.
* **Real-time updates** from GitHub webhooks, verified by signature.
* **Alerts** for failing CI, services down, serious security alerts, stale repos and low health, sent to Slack, Discord, Telegram, ntfy, email or a webhook, with rules of your own in the policy.
* **Policy as code**: baseline, health weights, custom checks and alert thresholds in one YAML document, with a dry run.
* **MCP server**: the dashboard as tools for coding agents.
* **Public surface** (opt-in): badges and cards for READMEs, and a status page for services.
* **OpenSSF Scorecard** as an optional signal for public repos.
* One navigation for every page, and a layout that works on a phone.

### Upgrading

* On Node and Docker, schema migrations are applied on start. On Cloudflare Workers, run `node dist/cli.mjs migrate` against the database.
* Reviewing and commenting from the inbox needs a token with *Pull requests* and *Issues* set to read and write.
* The vulnerability lookup and the Scorecard are off until the policy turns them on.

### Continuous Integration

* release with release-please ([42e649a](https://github.com/PabloAlaniz/github-control/commit/42e649a88b73672472d6a10cd0f3e515d25ae35f))
