import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import { BranchCleanupModal } from '@/components/organisms/BranchCleanupModal';
import { apiFetch } from '@/lib/api';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const respond = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });
const daysAgo = (n) => new Date(Date.now() - n * 86400000 - 60000).toISOString();
const items = [
    { name: 'feat/done', sha: 'a'.repeat(40), status: 'merged', mergedVia: 'pr', pr: { number: 12, url: 'https://example.test/12' }, lastCommitAt: daysAgo(10), ahead: 2 },
    { name: 'fix/old', sha: 'b'.repeat(40), status: 'merged', mergedVia: 'ancestor', pr: null, lastCommitAt: null, ahead: 0 },
    { name: 'spike', sha: 'c'.repeat(40), status: 'stale', mergedVia: null, pr: null, lastCommitAt: daysAgo(200), ahead: 4 },
    { name: 'wip', sha: 'd'.repeat(40), status: 'active', mergedVia: null, pr: null, lastCommitAt: daysAgo(1), ahead: 1 },
];
const repo = { fullName: 'me/api' };

describe('BranchCleanupModal', () => {
    let onClose;
    let onDone;

    beforeEach(() => {
        vi.clearAllMocks();
        onClose = vi.fn();
        onDone = vi.fn();
        apiFetch.mockReturnValue(respond({ signals: { branches: { items } } }));
    });

    const open = async () => {
        render(<BranchCleanupModal repo={repo} onClose={onClose} onDone={onDone} />);
        await waitFor(() => expect(screen.getByText('feat/done')).toBeInTheDocument());
    };

    it('lists merged and stale branches, preselecting only the merged ones', async () => {
        await open();

        expect(apiFetch).toHaveBeenCalledWith('/api/repos/me/api/signals');
        expect(screen.queryByText('wip')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Select branch feat/done')).toBeChecked();
        expect(screen.getByLabelText('Select branch fix/old')).toBeChecked();
        expect(screen.getByLabelText('Select branch spike')).not.toBeChecked();
        expect(screen.getByText('#12')).toHaveAttribute('href', 'https://example.test/12');
        expect(screen.getByText(/no commits of its own/)).toBeInTheDocument();
        expect(screen.getByText(/4 unmerged commits · last commit 200d ago/)).toBeInTheDocument();
        expect(screen.getByText(/last commit unknown/)).toBeInTheDocument();
    });

    it('requires a second click to delete and sends name + sha', async () => {
        await open();
        apiFetch.mockReturnValueOnce(respond({
            deleted: 1,
            results: [
                { name: 'feat/done', deleted: true },
                { name: 'fix/old', deleted: false, reason: 'moved' },
            ],
        }));

        fireEvent.click(screen.getByText('Delete 2 branches'));
        expect(apiFetch).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText('Confirm: delete 2 on GitHub'));

        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Deleted 1 of 2 branches'));
        const [path, options] = apiFetch.mock.calls[1];
        expect(path).toBe('/api/repos/me/api/branches/delete');
        expect(JSON.parse(options.body)).toEqual({ branches: [
            { name: 'feat/done', sha: 'a'.repeat(40) },
            { name: 'fix/old', sha: 'b'.repeat(40) },
        ] });
        expect(screen.getByText('deleted')).toBeInTheDocument();
        expect(screen.getByText(/has new commits since it was listed/)).toBeInTheDocument();
        expect(onDone).toHaveBeenCalled();

        fireEvent.click(screen.getByText('Close'));
        expect(onClose).toHaveBeenCalled();
    });

    it('changing the selection cancels a pending confirmation', async () => {
        await open();

        fireEvent.click(screen.getByText('Delete 2 branches'));
        fireEvent.click(screen.getByLabelText('Select branch spike'));

        expect(screen.queryByText(/Confirm: delete/)).not.toBeInTheDocument();
        expect(screen.getByText('Delete 3 branches')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Select branch spike'));
        fireEvent.click(screen.getByLabelText('Select branch feat/done'));
        fireEvent.click(screen.getByLabelText('Select branch fix/old'));
        expect(screen.getByText('Delete 0 branches').closest('button')).toBeDisabled();
    });

    it('shows unknown reasons and error details in the results', async () => {
        await open();
        apiFetch.mockReturnValueOnce(respond({ deleted: 0, results: [
            { name: 'feat/done', deleted: false, reason: 'error', error: 'boom' },
            { name: 'fix/old', deleted: false, reason: 'weird' },
        ] }));

        fireEvent.click(screen.getByText('Delete 2 branches'));
        fireEvent.click(screen.getByText('Confirm: delete 2 on GitHub'));

        await waitFor(() => expect(screen.getByText(/GitHub error: boom/)).toBeInTheDocument());
        expect(screen.getByText(/— weird/)).toBeInTheDocument();
    });

    it('reports a failed delete and stays on the list', async () => {
        await open();
        apiFetch.mockReturnValueOnce(respond({ error: 'Validation failed' }, false)).mockReturnValueOnce(respond({}, false));

        fireEvent.click(screen.getByText('Delete 2 branches'));
        fireEvent.click(screen.getByText('Confirm: delete 2 on GitHub'));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Validation failed'));
        expect(onDone).not.toHaveBeenCalled();
        expect(screen.getByText('feat/done')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Delete 2 branches'));
        fireEvent.click(screen.getByText('Confirm: delete 2 on GitHub'));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Delete failed'));
    });

    it('says when there is nothing to clean up', async () => {
        apiFetch.mockReturnValue(respond({ signals: {} }));
        render(<BranchCleanupModal repo={repo} onClose={onClose} />);
        await waitFor(() => expect(screen.getByText(/Nothing to clean up/)).toBeInTheDocument());
    });

    it('shows a load error and can be cancelled', async () => {
        apiFetch.mockReturnValue(respond({}, false));
        render(<BranchCleanupModal repo={repo} onClose={onClose} />);
        await waitFor(() => expect(screen.getByText('Could not load branches')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Cancel'));
        fireEvent.click(screen.getByLabelText('Close'));
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});
