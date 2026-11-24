import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SettingsPage } from '@/pages/SettingsPage';

const mockApiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...args) => mockApiFetch(...args) }));

const ok = (body) => ({ ok: true, json: async () => body });
const current = (extra = {}) => ({
    editable: true, storageDriver: 'sqlite', username: 'admin', githubTokenSet: true,
    githubOrgs: ['acme-org'], syncIntervalHours: 24, publicBadges: false, locked: [], ...extra,
});
const renderPage = () => render(<MemoryRouter><SettingsPage /></MemoryRouter>);
const lastPatch = () => JSON.parse(mockApiFetch.mock.calls.at(-1)[1].body);

describe('SettingsPage', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows the current settings', async () => {
        mockApiFetch.mockResolvedValue(ok(current()));
        renderPage();

        expect(await screen.findByLabelText('Organizations')).toHaveValue('acme-org');
        expect(screen.getByLabelText('Hours between automatic syncs')).toHaveValue(24);
        expect(screen.getByLabelText(/Serve public SVG badges/)).not.toBeChecked();
        expect(screen.getByText('A token is set. Leave blank to keep it.')).toBeInTheDocument();
        expect(screen.getByText(/Signed in as admin · storage: sqlite/)).toBeInTheDocument();
    });

    it('saves only what changed', async () => {
        mockApiFetch
            .mockResolvedValueOnce(ok(current()))
            .mockResolvedValueOnce(ok(current({ syncIntervalHours: 6, publicBadges: true })));
        const user = userEvent.setup();
        renderPage();

        const interval = await screen.findByLabelText('Hours between automatic syncs');
        await user.clear(interval);
        await user.type(interval, '6');
        await user.click(screen.getByLabelText(/Serve public SVG badges/));
        await user.click(screen.getByRole('button', { name: 'Save settings' }));

        expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.');
        expect(mockApiFetch).toHaveBeenLastCalledWith('/api/settings', expect.objectContaining({ method: 'PATCH' }));
        expect(lastPatch()).toEqual({ syncIntervalHours: 6, publicBadges: true });
    });

    it('sends a new token, organizations and password when filled in', async () => {
        mockApiFetch.mockResolvedValueOnce(ok(current())).mockResolvedValueOnce(ok(current({ githubOrgs: ['a', 'b'] })));
        const user = userEvent.setup();
        renderPage();

        await user.type(await screen.findByLabelText('Personal access token'), ' ghp_new ');
        const orgs = screen.getByLabelText('Organizations');
        await user.clear(orgs);
        await user.type(orgs, 'a, b');
        await user.type(screen.getByLabelText('Current password'), 'old password');
        await user.type(screen.getByLabelText('New password'), 'new password');
        await user.type(screen.getByLabelText('Confirm new password'), 'new password');
        await user.click(screen.getByRole('button', { name: 'Save settings' }));

        await screen.findByRole('status');
        expect(lastPatch()).toEqual({
            githubToken: 'ghp_new', githubOrgs: ['a', 'b'],
            password: { current: 'old password', next: 'new password' },
        });
        expect(screen.getByLabelText('Personal access token')).toHaveValue('');
        expect(screen.getByLabelText('Current password')).toHaveValue('');
    });

    it('does not call the server with nothing to save or mismatched passwords', async () => {
        mockApiFetch.mockResolvedValue(ok(current()));
        const user = userEvent.setup();
        renderPage();

        await user.click(await screen.findByRole('button', { name: 'Save settings' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Nothing to save');

        await user.type(screen.getByLabelText('Current password'), 'old password');
        await user.type(screen.getByLabelText('New password'), 'new password');
        await user.type(screen.getByLabelText('Confirm new password'), 'different');
        await user.click(screen.getByRole('button', { name: 'Save settings' }));
        expect(screen.getByRole('alert')).toHaveTextContent('The new passwords do not match');
        expect(mockApiFetch).toHaveBeenCalledTimes(1);
    });

    it('shows the server error', async () => {
        mockApiFetch
            .mockResolvedValueOnce(ok(current()))
            .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'GitHub rejected the token: invalid or expired token' }) });
        const user = userEvent.setup();
        renderPage();
        await user.type(await screen.findByLabelText('Personal access token'), 'bad');
        await user.click(screen.getByRole('button', { name: 'Save settings' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('GitHub rejected the token');
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    describe('webhooks', () => {
        it('explains the setup with this server\'s payload URL and says whether they are on', async () => {
            mockApiFetch.mockResolvedValue(ok(current({ webhookSecretSet: false })));
            renderPage();

            expect(await screen.findByText('No secret yet: webhooks are off.')).toBeInTheDocument();
            expect(screen.getByText(`${window.location.origin}/api/webhooks/github`)).toBeInTheDocument();
            expect(screen.getByLabelText('Secret')).toHaveValue('');
        });

        it('generates a secret and saves it', async () => {
            const user = userEvent.setup();
            mockApiFetch.mockResolvedValue(ok(current({ webhookSecretSet: false })));
            renderPage();
            await screen.findByText('No secret yet: webhooks are off.');

            await user.click(screen.getByRole('button', { name: 'Generate' }));
            const secret = screen.getByLabelText('Secret').value;
            expect(secret).toMatch(/^[0-9a-f]{40}$/);

            mockApiFetch.mockResolvedValue(ok(current({ webhookSecretSet: true })));
            await user.click(screen.getByRole('button', { name: /Save/ }));
            await waitFor(() => expect(lastPatch()).toEqual({ webhookSecret: secret }));

            expect(await screen.findByText('A secret is configured: webhooks are on.')).toBeInTheDocument();
            // The saved secret is not shown again.
            expect(screen.getByLabelText('Replace the secret')).toHaveValue('');
        });

        it('cannot be changed when the environment sets the secret', async () => {
            mockApiFetch.mockResolvedValue(ok(current({ webhookSecretSet: true, locked: ['webhookSecret'] })));
            renderPage();
            expect(await screen.findByLabelText('Replace the secret')).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
        });
    });

    it('disables what the environment locks', async () => {
        mockApiFetch.mockResolvedValue(ok(current({ locked: ['githubToken', 'syncIntervalHours', 'password'] })));
        renderPage();

        expect(await screen.findByLabelText('Personal access token')).toBeDisabled();
        expect(screen.getByLabelText('Hours between automatic syncs')).toBeDisabled();
        expect(screen.getByLabelText('Organizations')).toBeEnabled();
        expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
        expect(screen.getAllByText('Set by an environment variable on the server.')).toHaveLength(3);
    });

    it('explains when the server does not allow changes, or cannot be reached', async () => {
        mockApiFetch.mockResolvedValueOnce(ok({ editable: false }));
        const first = renderPage();
        expect(await screen.findByText(/cannot be changed here/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
        first.unmount();

        mockApiFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
        renderPage();
        await waitFor(() => expect(screen.getByText('Could not load the settings')).toBeInTheDocument());
    });

    describe('repo settings baseline', () => {
        const repoBaseline = [
            { key: 'delete_branch_on_merge', label: 'Delete head branches on merge', expected: true },
            { key: 'allow_merge_commit', label: 'Allow merge commits', expected: false },
            { key: 'has_issues', label: 'Issues', expected: null },
        ];

        it('shows each setting with what is expected of it', async () => {
            mockApiFetch.mockResolvedValue(ok(current({ repoBaseline })));
            renderPage();

            expect(await screen.findByLabelText('Delete head branches on merge')).toHaveValue('on');
            expect(screen.getByLabelText('Allow merge commits')).toHaveValue('off');
            expect(screen.getByLabelText('Issues')).toHaveValue('ignore');
        });

        it('sends the whole baseline when a setting changes, leaving out the ones not checked', async () => {
            mockApiFetch.mockResolvedValueOnce(ok(current({ repoBaseline }))).mockResolvedValueOnce(ok(current({ repoBaseline })));
            const user = userEvent.setup();
            renderPage();

            await user.selectOptions(await screen.findByLabelText('Issues'), 'on');
            await user.selectOptions(screen.getByLabelText('Allow merge commits'), 'ignore');
            await user.click(screen.getByRole('button', { name: 'Save settings' }));

            await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
            expect(lastPatch()).toEqual({ repoBaseline: { delete_branch_on_merge: true, has_issues: true } });
        });

        it('does not send the baseline when it did not change', async () => {
            mockApiFetch.mockResolvedValue(ok(current({ repoBaseline })));
            const user = userEvent.setup();
            renderPage();

            await user.selectOptions(await screen.findByLabelText('Issues'), 'on');
            await user.selectOptions(screen.getByLabelText('Issues'), 'ignore');
            await user.click(screen.getByRole('button', { name: 'Save settings' }));

            expect(await screen.findByText('Nothing to save')).toBeInTheDocument();
            expect(mockApiFetch).toHaveBeenCalledTimes(1);
        });

        it('is read-only when the environment sets it, and absent on servers that do not report it', async () => {
            mockApiFetch.mockResolvedValueOnce(ok(current({ repoBaseline, locked: ['repoBaseline'] })));
            const first = renderPage();
            expect(await screen.findByLabelText('Issues')).toBeDisabled();
            first.unmount();

            mockApiFetch.mockResolvedValueOnce(ok(current()));
            renderPage();
            await screen.findByLabelText('Organizations');
            expect(screen.queryByText('Repo settings baseline')).not.toBeInTheDocument();
        });
    });
});
