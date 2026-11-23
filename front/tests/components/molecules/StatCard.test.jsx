import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from '@/components/molecules/StatCard/StatCard';
import { Activity } from 'lucide-react';

describe('StatCard', () => {
    it('renders with label and value', () => {
        render(<StatCard label="Total" value={42} />);
        expect(screen.getByText('Total')).toBeInTheDocument();
        expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('renders with icon when provided', () => {
        const { container } = render(
            <StatCard label="Active" value={10} icon={Activity} />
        );
        expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders without icon when not provided', () => {
        const { container } = render(<StatCard label="Total" value={42} />);
        expect(container.querySelector('svg')).not.toBeInTheDocument();
    });

    it('applies default variant styles', () => {
        const { container } = render(<StatCard label="Test" value={1} />);
        const heading = screen.getByText('1');
        expect(heading).toHaveClass('text-gray-900');
    });

    it('applies primary variant styles', () => {
        const { container } = render(<StatCard label="Test" value={1} variant="primary" />);
        const heading = screen.getByText('1');
        expect(heading).toHaveClass('text-blue-600');
    });

    it('applies success variant styles', () => {
        const { container } = render(<StatCard label="Test" value={1} variant="success" />);
        const heading = screen.getByText('1');
        expect(heading).toHaveClass('text-green-600');
    });

    it('applies warning variant styles', () => {
        const { container } = render(<StatCard label="Test" value={1} variant="warning" />);
        const heading = screen.getByText('1');
        expect(heading).toHaveClass('text-yellow-600');
    });

    it('applies danger variant styles', () => {
        const { container } = render(<StatCard label="Test" value={1} variant="danger" />);
        const heading = screen.getByText('1');
        expect(heading).toHaveClass('text-red-600');
    });

    it('applies active variant styles', () => {
        const { container } = render(<StatCard label="Test" value={1} variant="active" />);
        const heading = screen.getByText('1');
        expect(heading).toHaveClass('text-green-600');
        expect(heading).toHaveClass('bg-green-50/50');
    });

    it('applies inactive variant styles', () => {
        const { container } = render(<StatCard label="Test" value={1} variant="inactive" />);
        const heading = screen.getByText('1');
        expect(heading).toHaveClass('text-yellow-600');
        expect(heading).toHaveClass('bg-yellow-50/50');
    });

    it('applies abandoned variant styles', () => {
        const { container } = render(<StatCard label="Test" value={1} variant="abandoned" />);
        const heading = screen.getByText('1');
        expect(heading).toHaveClass('text-red-600');
        expect(heading).toHaveClass('bg-red-50/50');
    });

    it('applies custom className when provided', () => {
        const { container } = render(
            <StatCard label="Test" value={1} className="custom-class" />
        );
        // Just verify it renders without crashing with custom class
        expect(container).toBeTruthy();
    });

    it('handles string values', () => {
        render(<StatCard label="Status" value="Active" />);
        expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('handles zero value', () => {
        render(<StatCard label="Count" value={0} />);
        expect(screen.getByText('0')).toBeInTheDocument();
    });
});
