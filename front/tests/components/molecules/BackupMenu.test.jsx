import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BackupMenu } from '@/components/molecules/BackupMenu';

vi.mock('react-hot-toast', () => ({
    default: { success: vi.fn(), error: vi.fn() },
}));

const mockApiFetch = vi.fn();
vi.mock('@/lib/api', () => ({
    apiFetch: (...args) => mockApiFetch(...args),
}));

// Stub createObjectURL / revokeObjectURL for jsdom.
beforeEach(() => {
    mockApiFetch.mockReset();
    global.URL.createObjectURL = vi.fn(() => 'blob:fake');
    global.URL.revokeObjectURL = vi.fn();
});

describe('BackupMenu', () => {
    it('shows export and import options when toggled open', () => {
        render(<BackupMenu />);
        fireEvent.click(screen.getByText(/Backup/i));
        expect(screen.getByText('Export to JSON')).toBeInTheDocument();
        expect(screen.getByText('Import from JSON')).toBeInTheDocument();
    });

    it('calls export endpoint and triggers download on click', async () => {
        mockApiFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ version: 1, groups: [{}], repo_groups: [{}, {}], meta_overrides: [] }),
        });

        // Patch a.click before triggering.
        const clickSpy = vi.fn();
        const originalCreate = document.createElement.bind(document);
        const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
            if (tag === 'a') {
                const a = originalCreate('a');
                a.click = clickSpy;
                return a;
            }
            return originalCreate(tag);
        });

        render(<BackupMenu />);
        fireEvent.click(screen.getByText(/Backup/i));
        fireEvent.click(screen.getByText('Export to JSON'));

        await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/api/export'));
        await waitFor(() => expect(clickSpy).toHaveBeenCalled());

        createSpy.mockRestore();
    });

    it('uploads file content to /api/import when a file is picked', async () => {
        const onImportSuccess = vi.fn();
        mockApiFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true, summary: { groups_upserted: 1, repo_groups_added: 2, meta_applied: 3 } }),
        });

        const { container } = render(<BackupMenu onImportSuccess={onImportSuccess} />);
        fireEvent.click(screen.getByText(/Backup/i));

        const fileInput = container.querySelector('input[type="file"]');
        const fakeContent = JSON.stringify({ version: 1, groups: [], repo_groups: [], meta_overrides: [] });
        const file = new File([fakeContent], 'backup.json', { type: 'application/json' });

        // jsdom doesn't implement Blob.text() consistently; polyfill it.
        Object.defineProperty(file, 'text', { value: () => Promise.resolve(fakeContent) });

        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/api/import', expect.objectContaining({ method: 'POST' })));
        await waitFor(() => expect(onImportSuccess).toHaveBeenCalled());
    });
});
