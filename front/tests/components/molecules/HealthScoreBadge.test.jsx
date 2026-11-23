import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HealthScoreBadge } from '@/components/molecules/HealthScoreBadge';

const fullBreakdown = {
    score: 85,
    grade: 'B',
    archived: false,
    breakdown: {
        ci: { score: 15, max: 15, checks: [] },
        tests: { score: 20, max: 25, checks: [] },
        docs: { score: 12, max: 15, checks: [] },
        quality: { score: 10, max: 15, checks: [] },
        hygiene: { score: 8, max: 10, checks: [] },
        freshness: { score: 20, max: 20, checks: [] },
    },
};

describe('HealthScoreBadge', () => {
    it('renders dash placeholder when healthScore is null', () => {
        const { container } = render(<HealthScoreBadge healthScore={null} />);
        expect(container.textContent).toBe('-');
    });

    it('renders score and grade when healthScore is provided', () => {
        render(<HealthScoreBadge healthScore={fullBreakdown} />);
        expect(screen.getByText('85')).toBeInTheDocument();
        expect(screen.getByText('B')).toBeInTheDocument();
    });

    it('opens breakdown popover on click and shows category names', () => {
        render(<HealthScoreBadge healthScore={fullBreakdown} />);

        const button = screen.getByRole('button');
        fireEvent.click(button);

        expect(screen.getByText('Health Score Breakdown')).toBeInTheDocument();
        expect(screen.getByText('CI/CD')).toBeInTheDocument();
        expect(screen.getByText('Tests')).toBeInTheDocument();
        expect(screen.getByText('Docs')).toBeInTheDocument();
        expect(screen.getByText('Quality')).toBeInTheDocument();
        expect(screen.getByText('Hygiene')).toBeInTheDocument();
        expect(screen.getByText('Freshness')).toBeInTheDocument();
    });

    it('shows category scores as fractions like "15/15"', () => {
        render(<HealthScoreBadge healthScore={fullBreakdown} />);
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByText('15/15')).toBeInTheDocument();
        expect(screen.getByText('20/25')).toBeInTheDocument();
    });

    it('toggles closed when clicking the button again', () => {
        render(<HealthScoreBadge healthScore={fullBreakdown} />);
        const button = screen.getByRole('button');
        fireEvent.click(button);
        expect(screen.getByText('Health Score Breakdown')).toBeInTheDocument();
        fireEvent.click(button);
        expect(screen.queryByText('Health Score Breakdown')).not.toBeInTheDocument();
    });

    it('shows archived disclaimer when archived flag is true', () => {
        render(<HealthScoreBadge healthScore={{ ...fullBreakdown, archived: true }} />);
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByText(/archived/i)).toBeInTheDocument();
    });
});
