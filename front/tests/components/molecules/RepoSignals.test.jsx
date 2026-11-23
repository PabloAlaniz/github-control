import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RepoSignals, SignalChips } from '@/components/molecules/RepoSignals';

const standards = {
    passed: 1,
    total: 3,
    checked_at: '2026-11-23T10:00:00Z',
    checks: [
        { key: 'description', label: 'Description', passed: true, applicable: true, hint: 'Add a description' },
        { key: 'topics', label: 'Topics', passed: false, applicable: true, hint: 'Add topics' },
        { key: 'branchProtection', label: 'Default branch protected', passed: null, applicable: true, hint: 'Protect it' },
        { key: 'license', label: 'License', passed: false, applicable: false, hint: 'Add a LICENSE file' },
    ],
};

describe('SignalChips', () => {
    it('renders a dash without signals', () => {
        render(<SignalChips repo={{}} />);
        expect(screen.getByText('-')).toBeInTheDocument();
    });

    it('renders a chip per signal', () => {
        render(<SignalChips repo={{ signals: { standards } }} />);
        expect(screen.getByText('Std 1/3')).toHaveAttribute('title', expect.stringContaining('1 of 3'));
    });
});

describe('RepoSignals', () => {
    it('invites to sync when there are no signals', () => {
        const onSync = vi.fn();
        render(<RepoSignals repo={{ signals: {} }} onSync={onSync} />);

        expect(screen.getByText('never synced')).toBeInTheDocument();
        expect(screen.getByText(/No signals yet/)).toBeInTheDocument();
        fireEvent.click(screen.getByText('Sync signals'));
        expect(onSync).toHaveBeenCalled();
    });

    it('shows the standards checklist with hints only for failing checks', () => {
        render(<RepoSignals repo={{ signals: { standards } }} />);

        expect(screen.getByText('1/3')).toBeInTheDocument();
        expect(screen.getByLabelText('Pass')).toBeInTheDocument();
        expect(screen.getByLabelText('Fail')).toBeInTheDocument();
        expect(screen.getByLabelText('Unknown')).toBeInTheDocument();
        expect(screen.getByLabelText('Not applicable')).toBeInTheDocument();
        expect(screen.getByText('Add topics')).toBeInTheDocument();
        expect(screen.queryByText('Add a description')).not.toBeInTheDocument();
        expect(screen.queryByText('Add a LICENSE file')).not.toBeInTheDocument();
        expect(screen.getByText(/n\/a \(private repo\)/)).toBeInTheDocument();
        expect(screen.queryByText('Sync signals')).not.toBeInTheDocument();
    });

    it('disables the sync button while syncing', () => {
        render(<RepoSignals repo={{}} onSync={vi.fn()} syncing />);
        expect(screen.getByText('Syncing...').closest('button')).toBeDisabled();
    });

    it('tolerates a signal without checks', () => {
        render(<RepoSignals repo={{ signals: { standards: { passed: 0, total: 0, checked_at: 'x' } } }} />);
        expect(screen.queryByText('Standards')).not.toBeInTheDocument();
    });

    it('shows the dependency summary and runtime support', () => {
        render(<RepoSignals repo={{ signals: { dependencies: {
            total: 12, ecosystems: { npm: 10, pypi: 2 }, checked_at: 'x',
            runtimes: [
                { name: 'node', version: '18', eolDate: '2020-01-01' },
                { name: 'python', version: '3.13', eolDate: '2999-01-01' },
                { name: 'go', version: '1.22', eolDate: null },
            ],
        } } }} />);

        expect(screen.getByText('12 direct')).toBeInTheDocument();
        expect(screen.getByText('npm')).toBeInTheDocument();
        expect(screen.getByText('EOL 2020-01-01')).toBeInTheDocument();
        expect(screen.getByText('until 2999-01-01')).toBeInTheDocument();
        expect(screen.getByText('EOL unknown')).toBeInTheDocument();
    });

    it('says so when a repo has no supported manifests', () => {
        render(<RepoSignals repo={{ signals: { dependencies: { total: 0, ecosystems: {}, runtimes: [] } } }} />);
        expect(screen.getByText('No supported manifests found')).toBeInTheDocument();
    });

    describe('security card', () => {
        const security = {
            available: true, total: 7, checked_at: 'x',
            sources: {
                dependabot: { available: true, open: 100, truncated: true },
                codeScanning: { available: false, open: 0, truncated: false },
                secretScanning: { available: true, open: 1, truncated: false },
            },
            items: [
                { source: 'secretScanning', severity: 'critical', title: 'API Key', url: 'https://example.test/1' },
                { source: 'dependabot', severity: 'high', title: 'semver: ReDoS', url: null },
                ...Array.from({ length: 5 }, (_, i) => ({ source: 'dependabot', severity: 'low', title: `low-${i}`, url: null })),
            ],
        };

        it('lists sources and the top alerts', () => {
            render(<RepoSignals repo={{ signals: { security } }} />);

            expect(screen.getByText('7 open')).toBeInTheDocument();
            expect(screen.getByText('100+')).toBeInTheDocument();
            expect(screen.getByText('n/a')).toBeInTheDocument();
            expect(screen.getByText('API Key').closest('a')).toHaveAttribute('href', 'https://example.test/1');
            expect(screen.getByText('semver: ReDoS').closest('a')).toBeNull();
            expect(screen.getByText('+2 more')).toBeInTheDocument();
        });

        it('shows a clean state', () => {
            render(<RepoSignals repo={{ signals: { security: { available: true, total: 0, sources: {}, items: [] } } }} />);
            expect(screen.getByText('no open alerts')).toBeInTheDocument();
        });

        it('explains when alerts cannot be read', () => {
            render(<RepoSignals repo={{ signals: { security: { available: false } } }} />);
            expect(screen.getByText(/Not available/)).toBeInTheDocument();
        });
    });

    describe('release card', () => {
        const card = (release) => render(<RepoSignals repo={{ signals: { release } }} />);
        const daysAgo = (n) => new Date(Date.now() - n * 86400000 - 60000).toISOString();

        it('shows the latest release and what is pending', () => {
            card({ hasRelease: true, source: 'release', tag: 'v1.2.0', name: 'Spring', publishedAt: daysAgo(12), url: 'https://example.test/r', unreleasedCommits: 14 });

            expect(screen.getByText('v1.2.0').closest('a')).toHaveAttribute('href', 'https://example.test/r');
            expect(screen.getByText(/Spring/)).toBeInTheDocument();
            expect(screen.getByText('published 12d ago')).toBeInTheDocument();
            expect(screen.getByText('14 commits not released yet')).toBeInTheDocument();
        });

        it('handles a tag without link, name or pending commits', () => {
            card({ hasRelease: true, source: 'tag', tag: 'v0.1.0', name: 'v0.1.0', publishedAt: daysAgo(0), url: null, unreleasedCommits: 0 });

            expect(screen.getByText('v0.1.0').closest('a')).toBeNull();
            expect(screen.getByText('published today')).toBeInTheDocument();
            expect(screen.getByText('default branch is released')).toBeInTheDocument();
        });

        it('handles unknown date and unknown pending commits', () => {
            card({ hasRelease: true, source: 'tag', tag: 'v1', publishedAt: null, unreleasedCommits: null });
            expect(screen.getByText('date unknown')).toBeInTheDocument();
            expect(screen.getByText('unreleased commits unknown')).toBeInTheDocument();
        });

        it('says when the repo never released', () => {
            card({ hasRelease: false });
            expect(screen.getByText('No releases or tags yet')).toBeInTheDocument();
        });
    });

    describe('branches card', () => {
        const branches = {
            total: 9, merged: 2, stale: 1, openPrs: 4, stalePrCount: 4, truncated: true,
            stalePrs: [1, 2, 3, 4].map(n => ({
                number: n, title: `PR ${n}`, url: `https://example.test/${n}`, draft: n === 1,
                updatedAt: new Date(Date.now() - 40 * 86400000 - 60000).toISOString(),
            })),
        };

        it('shows counts, stale PRs and the cleanup action', () => {
            const onCleanupBranches = vi.fn();
            render(<RepoSignals repo={{ signals: { branches } }} onCleanupBranches={onCleanupBranches} />);

            expect(screen.getByText('9 total')).toBeInTheDocument();
            expect(screen.getByText('#1 PR 1').closest('a')).toHaveAttribute('href', 'https://example.test/1');
            expect(screen.getByText(/idle 40d, draft/)).toBeInTheDocument();
            expect(screen.getByText('+1 more stale PRs')).toBeInTheDocument();
            expect(screen.getByText(/first 100 branches/)).toBeInTheDocument();

            fireEvent.click(screen.getByText('Clean up 3 branches…'));
            expect(onCleanupBranches).toHaveBeenCalled();
        });

        it('hides the cleanup action when there is nothing to clean', () => {
            render(<RepoSignals repo={{ signals: { branches: { total: 1, merged: 0, stale: 0, openPrs: 0 } } }} onCleanupBranches={vi.fn()} />);
            expect(screen.queryByText(/Clean up/)).not.toBeInTheDocument();
        });
    });

    it('prefers the summary list of security alerts and counts the rest from the total', () => {
        render(<RepoSignals repo={{ signals: { security: {
            available: true, total: 9, sources: {},
            top: [{ severity: 'high', title: 'only-top', url: null }],
        } } }} />);
        expect(screen.getByText('only-top')).toBeInTheDocument();
        expect(screen.getByText('+8 more')).toBeInTheDocument();
    });

    describe('ci card', () => {
        const ci = {
            available: true, sampled: 100, truncated: true, counted: 90, windowDays: 21,
            successRate: 82, avgDurationSec: 185, totalMinutes: 277, flaky: 2,
            daily: [
                { date: '2026-11-21', success: 0, failure: 0 },
                { date: '2026-11-22', success: 3, failure: 1 },
            ],
            workflows: [
                { name: 'CI', runs: 80, successRate: 95, avgDurationSec: 200, flaky: 2, lastConclusion: 'success', lastUrl: 'https://example.test/run' },
                { name: 'Deploy', runs: 10, successRate: 50, avgDurationSec: null, flaky: 0, lastConclusion: null, lastUrl: null },
                { name: 'Nightly', runs: 0, successRate: null, avgDurationSec: 30, flaky: 0, lastConclusion: 'failure', lastUrl: null },
            ],
        };

        it('shows reliability, cost and the per-workflow breakdown', () => {
            render(<RepoSignals repo={{ signals: { ci } }} />);

            expect(screen.getByText('last 100+ runs · 21d')).toBeInTheDocument();
            expect(screen.getByText('82%')).toBeInTheDocument();
            expect(screen.getByText('avg 3m 5s')).toBeInTheDocument();
            expect(screen.getByText('277 min run time')).toBeInTheDocument();
            expect(screen.getByText('2 flaky')).toBeInTheDocument();
            expect(screen.getByRole('img', { name: 'Workflow runs per day' })).toBeInTheDocument();
            expect(screen.getByTitle('2026-11-22: 3 passed, 1 failed')).toBeInTheDocument();
            expect(screen.getByText('CI', { selector: 'a' })).toHaveAttribute('href', 'https://example.test/run');
            expect(screen.getByText('Deploy').closest('a')).toBeNull();
            expect(screen.getByText('50%')).toBeInTheDocument();
        });

        it('handles a repo with runs but no countable results', () => {
            render(<RepoSignals repo={{ signals: { ci: { ...ci, successRate: null, flaky: 0, truncated: false, workflows: undefined, daily: undefined } } }} />);
            expect(screen.getByText('last 100 runs · 21d')).toBeInTheDocument();
        });

        it('says when there are no runs or Actions is unavailable', () => {
            const { unmount } = render(<RepoSignals repo={{ signals: { ci: { available: true, sampled: 0 } } }} />);
            expect(screen.getByText('No workflow runs yet')).toBeInTheDocument();
            unmount();

            render(<RepoSignals repo={{ signals: { ci: { available: false } } }} />);
            expect(screen.getByText(/not available/)).toBeInTheDocument();
        });
    });

    describe('settings card', () => {
        const config = {
            applicable: true, canApply: true, drift: 2, unknown: 1,
            settings: [
                { key: 'delete_branch_on_merge', label: 'Delete head branches on merge', expected: true, actual: false, drift: true },
                { key: 'has_wiki', label: 'Wiki', expected: false, actual: true, drift: true },
                { key: 'allow_squash_merge', label: 'Allow squash merging', expected: true, actual: true, drift: false },
                { key: 'allow_merge_commit', label: 'Allow merge commits', expected: false, actual: null, drift: false },
            ],
        };

        it('shows each setting against the baseline', () => {
            render(<RepoSignals repo={{ signals: { config } }} />);

            expect(screen.getByText('2 drift')).toBeInTheDocument();
            expect(screen.getByText('is off, baseline is on')).toBeInTheDocument();
            expect(screen.getByText('is on, baseline is off')).toBeInTheDocument();
            expect(screen.getAllByLabelText('Drift')).toHaveLength(2);
            expect(screen.getByLabelText('Matches')).toBeInTheDocument();
            expect(screen.getByText('unknown')).toBeInTheDocument();
            expect(screen.getByText(/no admin access/)).toBeInTheDocument();
            expect(screen.queryByText('Apply baseline…')).not.toBeInTheDocument();
        });

        it('applies the baseline only after a second, explicit click', async () => {
            const onApplyConfig = vi.fn().mockResolvedValue(undefined);
            render(<RepoSignals repo={{ signals: { config } }} onApplyConfig={onApplyConfig} />);

            fireEvent.click(screen.getByText('Apply baseline…'));
            expect(onApplyConfig).not.toHaveBeenCalled();

            fireEvent.click(screen.getByText('Cancel'));
            expect(screen.getByText('Apply baseline…')).toBeInTheDocument();

            fireEvent.click(screen.getByText('Apply baseline…'));
            fireEvent.click(screen.getByText('Confirm: change 2 settings on GitHub'));
            expect(onApplyConfig).toHaveBeenCalledTimes(1);
            await waitFor(() => expect(screen.getByText('Apply baseline…')).toBeInTheDocument());
        });

        it('disables the confirmation while applying', () => {
            render(<RepoSignals repo={{ signals: { config } }} onApplyConfig={vi.fn()} applyingConfig />);
            fireEvent.click(screen.getByText('Apply baseline…'));
            expect(screen.getByText('Applying...')).toBeDisabled();
        });

        it('explains when the token cannot apply it', () => {
            render(<RepoSignals repo={{ signals: { config: { ...config, canApply: false, unknown: 0 } } }} onApplyConfig={vi.fn()} />);
            expect(screen.getByText(/Admin access is required/)).toBeInTheDocument();
            expect(screen.queryByText('Apply baseline…')).not.toBeInTheDocument();
        });

        it('handles compliant and archived repos', () => {
            const { unmount } = render(<RepoSignals repo={{ signals: { config: { applicable: true, canApply: true, drift: 0, unknown: 0, settings: [] } } }} onApplyConfig={vi.fn()} />);
            expect(screen.getByText('matches baseline')).toBeInTheDocument();
            expect(screen.queryByText('Apply baseline…')).not.toBeInTheDocument();
            unmount();

            render(<RepoSignals repo={{ signals: { config: { applicable: false } } }} />);
            expect(screen.getByText(/Archived repo/)).toBeInTheDocument();
        });
    });
});
