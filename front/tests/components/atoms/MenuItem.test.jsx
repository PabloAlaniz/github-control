import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MenuItem } from '@/components/atoms/MenuItem/MenuItem';
import { Archive } from 'lucide-react';

describe('MenuItem', () => {
    it('renders children text', () => {
        render(<MenuItem>Click me</MenuItem>);
        expect(screen.getByText('Click me')).toBeInTheDocument();
    });

    it('renders with an icon', () => {
        const { container } = render(<MenuItem icon={Archive}>Archive</MenuItem>);
        expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('calls onClick when clicked', async () => {
        const user = userEvent.setup();
        const handleClick = vi.fn();
        render(<MenuItem onClick={handleClick}>Click me</MenuItem>);
        await user.click(screen.getByRole('button'));
        expect(handleClick).toHaveBeenCalledOnce();
    });

    it('applies danger variant styles', () => {
        render(<MenuItem variant="danger">Delete</MenuItem>);
        expect(screen.getByRole('button')).toHaveClass('text-red-600');
    });

    it('applies default variant styles', () => {
        render(<MenuItem>Normal</MenuItem>);
        expect(screen.getByRole('button')).toHaveClass('text-gray-700');
    });

    it('accepts custom className', () => {
        render(<MenuItem className="border-t">Item</MenuItem>);
        expect(screen.getByRole('button')).toHaveClass('border-t');
    });
});
