import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ColorDot } from '@/components/atoms/ColorDot/ColorDot';

describe('ColorDot', () => {
    it('renders with the given color', () => {
        const { container } = render(<ColorDot color="#ff0000" />);
        expect(container.firstChild).toHaveStyle({ backgroundColor: '#ff0000' });
    });

    it('renders with sm size', () => {
        const { container } = render(<ColorDot color="#00ff00" size="sm" />);
        expect(container.firstChild).toHaveClass('w-2', 'h-2');
    });

    it('renders with md size (default)', () => {
        const { container } = render(<ColorDot color="#00ff00" />);
        expect(container.firstChild).toHaveClass('w-3', 'h-3');
    });

    it('renders with lg size', () => {
        const { container } = render(<ColorDot color="#00ff00" size="lg" />);
        expect(container.firstChild).toHaveClass('w-3', 'h-3');
    });

    it('applies rounded-full class', () => {
        const { container } = render(<ColorDot color="#0000ff" />);
        expect(container.firstChild).toHaveClass('rounded-full');
    });

    it('accepts custom className', () => {
        const { container } = render(<ColorDot color="#0000ff" className="custom-class" />);
        expect(container.firstChild).toHaveClass('custom-class');
    });
});
