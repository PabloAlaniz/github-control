import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UptimeCell } from '@/components/molecules/UptimeCell';

const day = (date, checks, down = 0, degraded = 0, avgMs = 120) => ({ date, checks, down, degraded, avgMs });
const base = { checks: 100, uptimePct: 99.9, avgMs: 140, incidents: 0, lastDownAt: null };

describe('UptimeCell', () => {
    it('shows a placeholder without history', () => {
        const { rerender } = render(<UptimeCell uptime={undefined} />);
        expect(screen.getByText('no history')).toBeInTheDocument();
        rerender(<UptimeCell uptime={{ ...base, checks: 0, daily: [] }} />);
        expect(screen.getByText('no history')).toBeInTheDocument();
    });

    it('renders one bar per day colored by how much of the day was down', () => {
        const daily = [
            day('2026-11-19', 0, 0, 0, null),
            day('2026-11-20', 96),
            day('2026-11-21', 96, 0, 3),
            day('2026-11-22', 96, 10),
            day('2026-11-23', 96, 60, 0, null),
        ];
        render(<UptimeCell uptime={{ ...base, daily }} />);

        expect(screen.getByRole('img', { name: 'Uptime 99.9% over 5 days' })).toBeInTheDocument();
        expect(screen.getByTitle('2026-11-19: no checks')).toHaveClass('bg-gray-200');
        expect(screen.getByTitle('2026-11-20: 100% up (96 checks, avg 120ms)')).toHaveClass('bg-green-500');
        expect(screen.getByTitle(/2026-11-21/)).toHaveClass('bg-lime-400');
        expect(screen.getByTitle(/2026-11-22: 90% up/)).toHaveClass('bg-amber-400');
        expect(screen.getByTitle('2026-11-23: 38% up (96 checks)')).toHaveClass('bg-red-500');
    });

    it('colors the percentage and shows latency and incidents', () => {
        const daily = [day('2026-11-23', 10)];
        const { rerender } = render(<UptimeCell uptime={{ ...base, daily }} />);
        expect(screen.getByText('99.9%')).toHaveClass('text-green-700');
        expect(screen.getByText('140ms avg')).toBeInTheDocument();
        expect(screen.queryByText(/incident/)).not.toBeInTheDocument();

        rerender(<UptimeCell uptime={{ ...base, uptimePct: 97, incidents: 1, lastDownAt: '2026-11-22T10:00:00Z', daily }} />);
        expect(screen.getByText('97%')).toHaveClass('text-amber-700');
        expect(screen.getByText('1 incident')).toHaveAttribute('title', expect.stringContaining('Last down'));

        rerender(<UptimeCell uptime={{ ...base, uptimePct: 80, avgMs: null, incidents: 3, daily }} />);
        expect(screen.getByText('80%')).toHaveClass('text-red-700');
        expect(screen.getByText('3 incidents')).not.toHaveAttribute('title');
        expect(screen.queryByText(/ms avg/)).not.toBeInTheDocument();
    });
});
