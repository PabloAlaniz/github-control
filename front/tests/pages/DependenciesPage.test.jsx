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
});
