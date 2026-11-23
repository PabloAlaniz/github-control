// Per-repo signals (cached in the back, see back/src/lib/signals/).
// The presentation logic lives here: which chip to show in the table and
// which repos fall into each filter.

/**
 * Signal types the front syncs. One is requested per request so that each
 * Worker invocation makes few calls to GitHub.
 */
export const SIGNAL_KINDS = ['standards', 'dependencies', 'security', 'release', 'branches', 'ci', 'config'];

/** Minimum number of runs with a result to show the CI success rate. */
export const CI_MIN_RUNS = 5;

/** Number of unreleased commits from which the chip turns into a warning. */
export const UNRELEASED_WARN = 20;

const SEVERITIES = ['critical', 'high', 'medium', 'low'];

/** Compact chips for the "Signals" column. Each one: { key, label, tone, title }. */
export function signalChips(repo) {
    const signals = repo?.signals || {};
    const chips = [];

    const std = signals.standards;
    if (std && std.total > 0) {
        const ratio = std.passed / std.total;
        chips.push({
            key: 'standards',
            label: `Std ${std.passed}/${std.total}`,
            tone: ratio === 1 ? 'ok' : ratio >= 0.5 ? 'warn' : 'bad',
            title: `Repo standards: ${std.passed} of ${std.total} checks pass`,
        });
    }

    const sec = signals.security;
    if (sec?.available) {
        const worst = SEVERITIES.find(s => sec.bySeverity?.[s] > 0);
        if (!worst) {
            chips.push({ key: 'security', label: 'Sec ✓', tone: 'ok', title: 'No open security alerts' });
        } else {
            chips.push({
                key: 'security',
                label: `${sec.bySeverity[worst]} ${worst}`,
                tone: worst === 'critical' || worst === 'high' ? 'bad' : 'warn',
                title: `${sec.total} open security alerts (${SEVERITIES.filter(s => sec.bySeverity[s] > 0).map(s => `${sec.bySeverity[s]} ${s}`).join(', ')})`,
            });
        }
    }

    const rel = signals.release;
    if (rel?.hasRelease && rel.unreleasedCommits > 0) {
        chips.push({
            key: 'release',
            label: `${rel.unreleasedCommits} unreleased`,
            tone: rel.unreleasedCommits >= UNRELEASED_WARN ? 'warn' : 'neutral',
            title: `${rel.unreleasedCommits} commits on the default branch since ${rel.tag}`,
        });
    }

    const br = signals.branches;
    if (br && (br.merged > 0 || br.stale > 0)) {
        const parts = [br.merged > 0 && `${br.merged} merged`, br.stale > 0 && `${br.stale} stale`].filter(Boolean);
        chips.push({
            key: 'branches',
            label: `${br.merged + br.stale} branches`,
            tone: br.merged + br.stale >= 5 ? 'warn' : 'neutral',
            title: `Branches to clean up: ${parts.join(', ')}`,
        });
    }
    if (br?.stalePrCount > 0) {
        chips.push({
            key: 'stale-prs',
            label: `${br.stalePrCount} stale PR${br.stalePrCount === 1 ? '' : 's'}`,
            tone: 'warn',
            title: `${br.stalePrCount} open pull requests without activity in 30 days`,
        });
    }

    const ci = signals.ci;
    if (ci?.available && ci.counted >= CI_MIN_RUNS && ci.successRate !== null) {
        chips.push({
            key: 'ci',
            label: `CI ${ci.successRate}%`,
            tone: ci.successRate >= 90 ? 'ok' : ci.successRate >= 70 ? 'warn' : 'bad',
            title: `${ci.successRate}% of the last ${ci.counted} workflow runs passed`,
        });
    }
    if (ci?.flaky > 0) {
        chips.push({
            key: 'ci-flaky',
            label: `${ci.flaky} flaky`,
            tone: 'warn',
            title: `${ci.flaky} commits both failed and passed the same workflow`,
        });
    }

    const cfg = signals.config;
    if (cfg?.applicable && cfg.drift > 0) {
        chips.push({
            key: 'config',
            label: `${cfg.drift} drift`,
            tone: 'warn',
            title: `${cfg.drift} repo settings differ from the baseline`,
        });
    }

    const today = new Date().toISOString().slice(0, 10);
    for (const rt of signals.dependencies?.runtimes || []) {
        if (rt.eolDate && rt.eolDate <= today) {
            chips.push({
                key: `eol-${rt.name}`,
                label: `EOL ${rt.name} ${rt.release}`,
                tone: 'bad',
                title: `${rt.name} ${rt.release} reached end of life on ${rt.eolDate} (declared in ${rt.source})`,
            });
        }
    }

    return chips;
}

/** Signal-based list filters. Returns null if `filter` is not a signal filter. */
export function matchesSignalFilter(repo, filter) {
    const signals = repo?.signals || {};
    switch (filter) {
        case 'needs-standards': {
            const std = signals.standards;
            return !std || !(std.total > 0) || std.passed < std.total;
        }
        case 'security-alerts': {
            const by = signals.security?.bySeverity;
            return !!by && (by.critical > 0 || by.high > 0);
        }
        case 'unreleased':
            return !!signals.release?.hasRelease && signals.release.unreleasedCommits > 0;
        case 'branch-cleanup': {
            const br = signals.branches;
            return !!br && (br.merged > 0 || br.stale > 0 || br.stalePrCount > 0);
        }
        case 'ci-unreliable': {
            const ci = signals.ci;
            if (!ci?.available) return false;
            return ci.flaky > 0 || (ci.counted >= CI_MIN_RUNS && ci.successRate !== null && ci.successRate < 80);
        }
        case 'config-drift':
            return !!signals.config?.applicable && signals.config.drift > 0;
        case 'eol-runtime': {
            const today = new Date().toISOString().slice(0, 10);
            return (signals.dependencies?.runtimes || []).some(rt => rt.eolDate && rt.eolDate <= today);
        }
        default:
            return null;
    }
}

/** Oldest sync date among the repo's signals (or null). */
export function signalsCheckedAt(repo) {
    const dates = Object.values(repo?.signals || {}).map(s => s?.checked_at).filter(Boolean).sort();
    return dates[0] || null;
}

/** Days elapsed since an ISO date (null if there is no date). */
export function daysSince(iso, now = Date.now()) {
    if (!iso) return null;
    const time = new Date(iso).getTime();
    return Number.isNaN(time) ? null : Math.max(0, Math.floor((now - time) / 86400000));
}

/** "95s" → "1m 35s", "3700s" → "1h 2m". */
export function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return '-';
    const s = Math.round(seconds);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
