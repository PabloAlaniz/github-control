import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '@/components/atoms/Badge/Badge';

describe('Badge', () => {
    it('renders children correctly', () => {
        render(<Badge>Test Badge</Badge>);
        expect(screen.getByText('Test Badge')).toBeInTheDocument();
    });

    it('applies default classes', () => {
        const { container } = render(<Badge>Default</Badge>);
        expect(container.firstChild).toHaveClass('bg-gray-100');
    });

    it('applies primary variant classes', () => {
        const { container } = render(<Badge variant="primary">Primary</Badge>);
        expect(container.firstChild).toHaveClass('bg-blue-100');
    });

    it('applies custom className', () => {
        const { container } = render(<Badge className="custom-class">Custom</Badge>);
        expect(container.firstChild).toHaveClass('custom-class');
    });
});
