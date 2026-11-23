import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExternalLink } from '@/components/atoms/ExternalLink/ExternalLink';

describe('ExternalLink', () => {
    it('renders with href', () => {
        render(<ExternalLink href="https://example.com">Link</ExternalLink>);
        const link = screen.getByText('Link');
        expect(link).toHaveAttribute('href', 'https://example.com');
    });

    it('always sets target="_blank"', () => {
        render(<ExternalLink href="https://example.com">Link</ExternalLink>);
        const link = screen.getByText('Link');
        expect(link).toHaveAttribute('target', '_blank');
    });

    it('always sets rel="noopener noreferrer"', () => {
        render(<ExternalLink href="https://example.com">Link</ExternalLink>);
        const link = screen.getByText('Link');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders children', () => {
        render(<ExternalLink href="https://example.com">Click me</ExternalLink>);
        expect(screen.getByText('Click me')).toBeInTheDocument();
    });

    it('accepts custom className', () => {
        render(<ExternalLink href="https://example.com" className="custom">Link</ExternalLink>);
        expect(screen.getByText('Link')).toHaveClass('custom');
    });

    it('passes additional props', () => {
        render(<ExternalLink href="https://example.com" title="My title">Link</ExternalLink>);
        expect(screen.getByText('Link')).toHaveAttribute('title', 'My title');
    });
});
