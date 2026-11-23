import React from 'react';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/atoms/Button/Button';
import { describe, it, expect } from 'vitest';

describe('Button', () => {
    it('renders children correctly', () => {
        render(<Button>Click me</Button>);
        expect(screen.getByText('Click me')).toBeInTheDocument();
    });

    it('renders with primary variant by default', () => {
        render(<Button>Primary</Button>);
        const button = screen.getByRole('button');
        expect(button).toHaveClass('bg-blue-600');
    });

    it('applies custom className', () => {
        render(<Button className="custom-class">Custom</Button>);
        const button = screen.getByRole('button');
        expect(button).toHaveClass('custom-class');
    });
});
