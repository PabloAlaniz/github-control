# Security policy

## Reporting a vulnerability

Please do not open a public issue. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/PabloAlaniz/github-control/security/advisories/new)
on this repository, with the steps to reproduce and the version or commit you are running.

You can expect a first answer within a week. Fixes are released for the latest version only.

## What is in scope

GitHub Control holds a GitHub token with access to your repositories, so these matter most:

- Reading or changing data, settings or the stored token without signing in.
- Getting around the setup code on an instance that has not been configured yet.
- Anything that exposes private repository data through the public badge endpoints.

## Running it safely

See the "Security notes" section of the [README](README.md): finish setup before exposing the
server, keep the data directory private, and put a TLS-terminating reverse proxy in front of it.
