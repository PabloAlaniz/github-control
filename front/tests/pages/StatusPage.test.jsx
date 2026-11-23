import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { StatusPage } from '@/pages/StatusPage';

const day = (date, extra = {}) => ({ date, checks: 96, down: 0, degraded: 0, ...extra });
const payload = {
    overall: 'degraded', days: 90, updatedAt: new Date().toISOString(),
    services: [
        { slug: 'api', name: 'API', status: 'healthy', uptimePct: 99.9, incidents: 1, daily: [day('2026-01-01', { checks: 0 }), day('2026-01-02', { down: 30 }), day('2026-01-03', { down: 1 }), day('2026-01-04')] },
        { slug: 'web', name: 'Web', status: 'degraded', uptimePct: null, incidents: 0, daily: [day('2026-01-04', { degraded: 40 }), day('2026-01-05', { degraded: 1 })] },
    ],
};
const respond = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

describe('StatusPage', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
    afterEach(() => vi.unstubAllGlobals());

    it('shows the overall state and each service without signing in', async () => {
        fetch.mockReturnValue(respond(payload));
        render(<StatusPage />);

        expect(await screen.findByRole('status')).toHaveTextContent('Some systems are degraded');
        expect(fetch).toHaveBeenCalledWith('/api/status');
        expect(screen.getByRole('heading', { name: 'API' })).toBeInTheDocument();
        expect(screen.getByText('Operational')).toBeInTheDocument();
        expect(screen.getByText('Degraded')).toBeInTheDocument();
        expect(screen.getByText('99.9% uptime')).toBeInTheDocument();
        expect(screen.getByText('no data yet')).toBeInTheDocument();
    });

    it('explains each day of the history', async () => {
        fetch.mockReturnValue(respond(payload));
        render(<StatusPage />);
        await screen.findByRole('status');

        const tone = (title) => screen.getByTitle(title).className;
        expect(tone('2026-01-01: no data')).toContain('bg-gray-200');
        expect(tone('2026-01-02: down in 30 of 96 checks')).toContain('bg-red-500');
        expect(tone('2026-01-03: down in 1 of 96 checks')).toContain('bg-orange-400');
        expect(screen.getAllByTitle('2026-01-04: no problems')[0].className).toContain('bg-green-500');
        expect(tone('2026-01-04: degraded in 40 of 96 checks')).toContain('bg-yellow-400');
        // A single slow check is noted but does not color the day.
        expect(tone('2026-01-05: degraded in 1 of 96 checks')).toContain('bg-green-500');
    });

    it.each([
        ['operational', 'All systems operational'], ['outage', 'Some systems are down'], ['unknown', 'No checks yet'],
    ])('says "%s" as "%s"', async (overall, text) => {
        fetch.mockReturnValue(respond({ ...payload, overall }));
        render(<StatusPage />);
        expect(await screen.findByRole('status')).toHaveTextContent(text);
    });

    it('says so when no services are monitored', async () => {
        fetch.mockReturnValue(respond({ ...payload, overall: 'unknown', services: [] }));
        render(<StatusPage />);
        expect(await screen.findByText('No services are being monitored yet.')).toBeInTheDocument();
    });

    it('says the page is not enabled when the server has it off', async () => {
        fetch.mockReturnValue(respond({ error: 'disabled' }, 404));
        render(<StatusPage />);
        expect(await screen.findByText('This status page is not enabled.')).toBeInTheDocument();
    });

    it('reports a failure to load', async () => {
        fetch.mockRejectedValue(new Error('offline'));
        render(<StatusPage />);
        expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    });

    it('keeps showing the last status when a refresh fails', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        fetch.mockReturnValueOnce(respond(payload)).mockRejectedValue(new Error('offline'));
        render(<StatusPage />);
        await screen.findByRole('status');

        await vi.advanceTimersByTimeAsync(60_000);
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        expect(screen.getByRole('status')).toHaveTextContent('Some systems are degraded');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        vi.useRealTimers();
    });
});
