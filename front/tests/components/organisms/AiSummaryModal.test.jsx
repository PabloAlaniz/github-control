import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AiSummaryModal } from '@/components/organisms/AiSummaryModal';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const mockApiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...args) => mockApiFetch(...args) }));

beforeEach(() => mockApiFetch.mockReset());

const repo = { fullName: 'acme/example' };

const baseSummary = {
    title: 'Example Repo',
    description: 'A short description.',
    keyFeatures: ['Feature A', 'Feature B', 'Feature C'],
    primaryUseCase: 'Demoing the SDK',
    audience: 'Developers',
    source: 'ai',
    model: 'claude-opus-4-7',
    generated_at: '2026-05-12T10:00:00Z',
    tokens_in: 1200,
    tokens_out: 220,
    cache_read_input_tokens: 800,
};

describe('AiSummaryModal', () => {
    it('uses the cached summary from /docs without calling generate-summary', async () => {
        mockApiFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ summary: baseSummary }),
        });

        render(<AiSummaryModal repo={repo} onClose={vi.fn()} />);

        await waitFor(() => expect(screen.getByText('Example Repo')).toBeInTheDocument());
        expect(screen.getByText('A short description.')).toBeInTheDocument();
        expect(screen.getByText('Feature A')).toBeInTheDocument();
        expect(screen.getByText('Demoing the SDK')).toBeInTheDocument();
        expect(screen.getByText('Developers')).toBeInTheDocument();
        // Only the /docs call should have been made.
        expect(mockApiFetch).toHaveBeenCalledTimes(1);
        expect(mockApiFetch).toHaveBeenCalledWith('/api/repos/acme/example/docs');
    });

    it('falls back to generate-summary when no cached summary is available', async () => {
        // /docs returns no summary
        mockApiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ summary: null }) });
        // generate-summary returns one
        mockApiFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true, summary: baseSummary }),
        });

        render(<AiSummaryModal repo={repo} onClose={vi.fn()} />);

        await waitFor(() => expect(screen.getByText('Example Repo')).toBeInTheDocument());
        expect(mockApiFetch).toHaveBeenCalledTimes(2);
        expect(mockApiFetch).toHaveBeenNthCalledWith(2, '/api/repos/acme/example/generate-summary', { method: 'POST' });
    });

    it('shows an error state when generation fails', async () => {
        mockApiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ summary: null }) });
        mockApiFetch.mockResolvedValueOnce({
            ok: false,
            json: async () => ({ error: 'ANTHROPIC_API_KEY is not configured' }),
        });

        render(<AiSummaryModal repo={repo} onClose={vi.fn()} />);

        await waitFor(() => expect(screen.getByText(/ANTHROPIC_API_KEY/)).toBeInTheDocument());
    });

    it('regenerates with force=true when the Regenerate button is clicked', async () => {
        mockApiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ summary: baseSummary }) });

        render(<AiSummaryModal repo={repo} onClose={vi.fn()} />);

        await waitFor(() => expect(screen.getByText('Example Repo')).toBeInTheDocument());

        mockApiFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true, summary: { ...baseSummary, title: 'Refreshed' } }),
        });
        fireEvent.click(screen.getByText('Regenerate').closest('button'));

        await waitFor(() => expect(screen.getByText('Refreshed')).toBeInTheDocument());
        expect(mockApiFetch).toHaveBeenLastCalledWith(
            '/api/repos/acme/example/generate-summary?force=true',
            { method: 'POST' },
        );
    });

    it('calls onClose when the close button is clicked', () => {
        mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({ summary: baseSummary }) });
        const onClose = vi.fn();
        const { container } = render(<AiSummaryModal repo={repo} onClose={onClose} />);
        // The X button is the only icon-size button before the summary loads.
        const buttons = container.querySelectorAll('button');
        fireEvent.click(buttons[0]);
        expect(onClose).toHaveBeenCalledOnce();
    });
});
