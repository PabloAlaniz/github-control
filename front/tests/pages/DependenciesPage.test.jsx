import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { DependenciesPage } from '@/pages/DependenciesPage';
import * as router from 'react-router-dom';
import * as api from '@/lib/api';

vi.mock('react-router-dom', () => ({ useNavigate: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const payload = {
    repos_synced: 2,
    packages: [
        {
            ecosystem: 'npm', name: 'react', repo_count: 2, majors: ['17', '18'], divergent: true,
            usages: [
                { repo: 'me/a', version: '^17.0.2', major: '17', scope: 'prod', manifest: 'package.json' },
                { repo: 'me/b', version: '^18.2.0', major: '18', scope: 'prod', manifest: 'package.json' },
            ],
        },
        {
            ecosystem: 'npm', name: 'vitest', repo_count: 2, majors: ['1'], divergent: false,
            usages: [
                { repo: 'me/a', version: '^1.6.0', major: '1', scope: 'dev', manifest: 'package.json' },
                { repo: 'me/b', version: '^1.6.0', major: '1', scope: 'dev', manifest: 'package.json' },
            ],
        },
        {
            ecosystem: 'pypi', name: 'fastapi', repo_count: 1, majors: ['0.110'], divergent: false,
            usages: [{ repo: 'me/c', version: '>=0.110', major: '0.110', scope: 'prod', manifest: 'pyproject.toml' }],
        },
    ],
    runtimes: [
        { repo: 'me/a', name: 'node', version: '18', source: '.nvmrc', release: '18', eolDate: '2025-04-30', eol: true },
        { repo: 'me/b', name: 'node', version: '22', source: '.nvmrc', release: '22', eolDate: '2027-04-30', eol: false },
        { repo: 'me/c', name: 'go', version: '1.22', source: 'go.mod', release: '1', eolDate: null, eol: null },
    ],
};
const respond = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });
const packageNames = () => screen.getAllByRole('button', { expanded: false }).map(b => b.textContent);

describe('DependenciesPage', () => {
    const navigate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        router.useNavigate.mockReturnValue(navigate);
        api.apiFetch.mockReturnValue(respond(payload));
    });

    it('shows stats, runtimes and packages', async () => {
        render(<DependenciesPage />);

        await waitFor(() => expect(screen.getByText('react')).toBeInTheDocument());
        expect(api.apiFetch).toHaveBeenCalledWith('/api/dependencies');
        expect(screen.getByText('EOL since 2025-04-30')).toBeInTheDocument();
        expect(screen.getByText('Supported until 2027-04-30')).toBeInTheDocument();
        expect(screen.getByText('unknown')).toBeInTheDocument();
        expect(screen.getByText('divergent')).toBeInTheDocument();
        expect(screen.getByText('3 packages')).toBeInTheDocument();
        expect(within(screen.getByText('EOL runtimes').closest('div')).getByText('1')).toBeInTheDocument();
    });

    it('filters by search, ecosystem and toggles', async () => {
        render(<DependenciesPage />);
        await waitFor(() => expect(screen.getByText('react')).toBeInTheDocument());

        fireEvent.change(screen.getByPlaceholderText('Search packages...'), { target: { value: 'fast' } });
        expect(packageNames()).toEqual(['fastapi']);
        fireEvent.change(screen.getByPlaceholderText('Search packages...'), { target: { value: '' } });

        fireEvent.change(screen.getByLabelText('Ecosystem'), { target: { value: 'pypi' } });
        expect(packageNames()).toEqual(['fastapi']);
        fireEvent.change(screen.getByLabelText('Ecosystem'), { target: { value: 'all' } });

        fireEvent.click(screen.getByLabelText('Used in 2+ repos'));
        expect(packageNames()).toEqual(['react', 'vitest']);

        fireEvent.click(screen.getByLabelText('Divergent majors only'));
        expect(packageNames()).toEqual(['react']);

        fireEvent.change(screen.getByPlaceholderText('Search packages...'), { target: { value: 'zzz' } });
        expect(screen.getByText('No packages match')).toBeInTheDocument();
    });

    it('expands a package to show which repo uses which version', async () => {
        render(<DependenciesPage />);
        await waitFor(() => expect(screen.getByText('react')).toBeInTheDocument());

        fireEvent.click(screen.getByText('react'));
        expect(screen.getByText('^17.0.2')).toBeInTheDocument();
        expect(screen.getByText('^18.2.0')).toBeInTheDocument();

        fireEvent.click(screen.getByText('react'));
        expect(screen.queryByText('^17.0.2')).not.toBeInTheDocument();
    });

    it('explains how to get data when nothing was synced', async () => {
        api.apiFetch.mockReturnValue(respond({ repos_synced: 0, packages: [], runtimes: [] }));
        render(<DependenciesPage />);
        await waitFor(() => expect(screen.getByText('No dependency data yet')).toBeInTheDocument());
    });

    it('hides the runtime table when no repo declares one', async () => {
        api.apiFetch.mockReturnValue(respond({ ...payload, runtimes: [] }));
        render(<DependenciesPage />);
        await waitFor(() => expect(screen.getByText('react')).toBeInTheDocument());
        expect(screen.queryByText('Runtimes')).not.toBeInTheDocument();
    });

    it('shows an error with retry', async () => {
        api.apiFetch.mockReturnValueOnce(respond({}, false));
        render(<DependenciesPage />);
        await waitFor(() => expect(screen.getByText('Failed to fetch dependencies')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
        await waitFor(() => expect(screen.getByText('react')).toBeInTheDocument());
    });

    it('navigates back', async () => {
        render(<DependenciesPage />);
        fireEvent.click(screen.getByText('Back'));
        expect(navigate).toHaveBeenCalledWith('/');
    });

    describe('lockfiles', () => {
        const locked = {
            ...payload, locked: { repos: 2, packages: 1840 },
            packages: payload.packages.map((pkg, i) => (i === 0
                ? { ...pkg, usages: pkg.usages.map((usage, j) => ({ ...usage, resolved: j === 0 ? ['17.0.2'] : ['18.3.1', '18.2.0'] })) }
                : pkg)),
        };
        const located = {
            query: 'lodash', exact: true, repos: 2,
            locations: [
                { repo: 'me/a', ecosystem: 'npm', name: 'lodash', versions: ['4.17.20', '4.17.21'], direct: false },
                { repo: 'me/b', ecosystem: 'npm', name: 'lodash', versions: ['4.17.21'], direct: true },
            ],
        };
        const mock = (locate = () => respond(located)) => api.apiFetch.mockImplementation((path) => (
            path.startsWith('/api/dependencies/locate') ? locate(path) : respond(locked)
        ));

        it('shows how many packages are pinned and the resolved version of each use', async () => {
            mock();
            render(<DependenciesPage />);

            expect(await screen.findByText('1,840')).toBeInTheDocument();
            fireEvent.click(screen.getByRole('button', { name: /react/ }));
            expect(screen.getByText('→ 17.0.2')).toBeInTheDocument();
            expect(screen.getByText('→ 18.3.1, 18.2.0')).toBeInTheDocument();
        });

        it('finds a package anywhere, telling declared from transitive', async () => {
            mock();
            render(<DependenciesPage />);
            const finder = await screen.findByRole('search', { name: 'Find a package' });

            expect(within(finder).getByRole('button', { name: /Find/ })).toBeDisabled();
            fireEvent.change(within(finder).getByLabelText('Package name'), { target: { value: ' lodash ' } });
            fireEvent.submit(finder);

            expect(await screen.findByText('“lodash” is in 2 repos.')).toBeInTheDocument();
            expect(api.apiFetch).toHaveBeenCalledWith('/api/dependencies/locate?name=lodash');
            expect(screen.getByText('4.17.20, 4.17.21').closest('tr')).toHaveTextContent('me/a');
            expect(screen.getByText('4.17.20, 4.17.21').closest('tr')).toHaveTextContent('transitive');
            expect(screen.getByText('declared')).toBeInTheDocument();
        });

        it('says when a package is nowhere, or when only similar names exist', async () => {
            mock(() => respond({ query: 'left-pad', exact: false, repos: 0, locations: [] }));
            render(<DependenciesPage />);
            const finder = await screen.findByRole('search', { name: 'Find a package' });
            fireEvent.change(within(finder).getByLabelText('Package name'), { target: { value: 'left-pad' } });
            fireEvent.submit(finder);
            expect(await screen.findByText('“left-pad” is not in any lockfile.')).toBeInTheDocument();

            mock(() => respond({ ...located, query: 'loda', exact: false }));
            fireEvent.change(within(finder).getByLabelText('Package name'), { target: { value: 'loda' } });
            fireEvent.submit(finder);
            expect(await screen.findByText(/No package is called exactly “loda”/)).toBeInTheDocument();
        });

        it('shows why a lookup failed, and no finder when no repo has a lockfile', async () => {
            mock(() => respond({ error: 'boom' }, false));
            const { unmount } = render(<DependenciesPage />);
            const finder = await screen.findByRole('search', { name: 'Find a package' });
            fireEvent.change(within(finder).getByLabelText('Package name'), { target: { value: 'lodash' } });
            fireEvent.submit(finder);
            expect(await screen.findByRole('alert')).toHaveTextContent('boom');
            unmount();

            api.apiFetch.mockImplementation(() => respond(payload));
            render(<DependenciesPage />);
            await screen.findByText('Runtimes');
            expect(screen.queryByRole('search', { name: 'Find a package' })).not.toBeInTheDocument();
        });
    });

    describe('known vulnerabilities', () => {
        const locked = { ...payload, locked: { repos: 2, packages: 300 } };
        const item = (n, severity, extra = {}) => ({
            id: `GHSA-${n}`, aliases: [`CVE-2025-${n}`], ecosystem: 'npm', name: `pkg${n}`, version: '1.0.0', severity,
            summary: `Problem ${n}`, fixed: '1.0.1', url: `https://osv.dev/vulnerability/GHSA-${n}`, repos: ['me/a'], ...extra,
        });
        const found = {
            enabled: true, repos_checked: 2, repos_affected: 1, packages_checked: 1300, total: 18, truncated: ['me/a'],
            bySeverity: { critical: 1, high: 17, moderate: 0, low: 0, unknown: 0 },
            items: [item(0, 'critical', { fixed: null, aliases: [], repos: ['me/a', 'me/b'] }), ...Array.from({ length: 17 }, (_, i) => item(i + 1, 'high'))],
        };
        const mock = (body, ok = true) => api.apiFetch.mockImplementation((path) => (
            path === '/api/dependencies/vulnerabilities' ? respond(body, ok) : respond(locked)
        ));
        const table = () => screen.getByText('Known vulnerabilities').closest('div').parentElement;

        it('lists them worst first, filters by severity and shows the rest on demand', async () => {
            mock(found);
            render(<DependenciesPage />);

            expect(await screen.findByText('18 in 1 of 2 repos · 1,300 pinned versions checked')).toBeInTheDocument();
            expect(screen.getByRole('link', { name: 'GHSA-0' })).toHaveAttribute('href', 'https://osv.dev/vulnerability/GHSA-0');
            expect(screen.getByRole('link', { name: 'CVE-2025-1' })).toBeInTheDocument();
            expect(screen.getByText('no fix known')).toBeInTheDocument();
            expect(screen.getByText('me/a, me/b')).toBeInTheDocument();
            expect(screen.getByText(/Too many findings to list in full for: me\/a/)).toBeInTheDocument();
            expect(within(table()).getAllByRole('row')).toHaveLength(16);

            fireEvent.click(screen.getByRole('button', { name: 'Show all 18' }));
            expect(within(table()).getAllByRole('row')).toHaveLength(19);

            const severities = screen.getByRole('group', { name: 'Severity' });
            expect(within(severities).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'critical 1', 'high 17']);
            fireEvent.click(within(severities).getByRole('button', { name: 'critical 1' }));
            expect(within(table()).getAllByRole('row')).toHaveLength(2);
        });

        it('says when nothing was found, when it is waiting for a sync, and how to turn it on', async () => {
            mock({ ...found, total: 0, items: [], repos_affected: 0, truncated: [] });
            const { unmount } = render(<DependenciesPage />);
            expect(await screen.findByText(/None found · 1,300 pinned versions checked/)).toBeInTheDocument();
            unmount();

            mock({ enabled: true, repos_checked: 0, items: [] });
            const second = render(<DependenciesPage />);
            expect(await screen.findByText(/Results appear after the next sync/)).toBeInTheDocument();
            second.unmount();

            mock({ enabled: false, repos_checked: 0, items: [] });
            render(<DependenciesPage />);
            expect(await screen.findByText(/known_vulnerabilities: true/)).toBeInTheDocument();
        });

        it('stays out of the way when it cannot be read', async () => {
            mock({ error: 'boom' }, false);
            render(<DependenciesPage />);
            await screen.findByText('Find a package anywhere');
            expect(screen.queryByText('Known vulnerabilities')).not.toBeInTheDocument();
        });
    });
});
