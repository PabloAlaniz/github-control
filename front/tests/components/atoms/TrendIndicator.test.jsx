import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrendIndicator } from '@/components/atoms/TrendIndicator';

describe('TrendIndicator', () => {
    it('renders dash placeholder when delta is null', () => {
        const { container } = render(<TrendIndicator delta={null} />);
        expect(container.textContent).toContain('–');
    });

    it('renders dash placeholder when delta is undefined', () => {
        const { container } = render(<TrendIndicator delta={undefined} />);
        expect(container.textContent).toContain('–');
    });

    it('renders zero state when delta=0', () => {
        const { container } = render(<TrendIndicator delta={0} />);
        // Lucide Minus icon has class "lucide-minus"
        expect(container.querySelector('.lucide-minus')).not.toBeNull();
    });

    it('shows up arrow and green color for positive delta', () => {
        const { container } = render(<TrendIndicator delta={1500} />);
        expect(container.querySelector('.lucide-arrow-up')).not.toBeNull();
        expect(screen.getByText('1,500')).toBeInTheDocument();
        const span = container.querySelector('span');
        expect(span.className).toContain('text-green');
    });

    it('shows down arrow and red color for negative delta', () => {
        const { container } = render(<TrendIndicator delta={-300} />);
        expect(container.querySelector('.lucide-arrow-down')).not.toBeNull();
        expect(screen.getByText('300')).toBeInTheDocument();
        const span = container.querySelector('span');
        expect(span.className).toContain('text-red');
    });

    it('inverts color logic when inverted=true (decline = good)', () => {
        // For metrics like open issues, decreasing is positive.
        const { container } = render(<TrendIndicator delta={-5} inverted />);
        const span = container.querySelector('span');
        expect(span.className).toContain('text-green');
    });

    it('appends suffix when provided', () => {
        const { container } = render(<TrendIndicator delta={42} suffix="%" />);
        expect(container.textContent).toContain('42%');
    });
});
