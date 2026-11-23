import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RepoCardSkeleton } from '@/components/molecules/RepoCardSkeleton/RepoCardSkeleton';

describe('RepoCardSkeleton', () => {
    it('renders without crashing', () => {
        const { container } = render(<RepoCardSkeleton />);
        expect(container).toBeTruthy();
    });

    it('renders Card component', () => {
        const { container } = render(<RepoCardSkeleton />);
        const card = container.querySelector('.p-5');
        expect(card).toBeInTheDocument();
    });

    it('has animate-pulse class for loading animation', () => {
        const { container } = render(<RepoCardSkeleton />);
        const animatedElement = container.querySelector('.animate-pulse');
        expect(animatedElement).toBeInTheDocument();
    });

    it('renders skeleton header section', () => {
        const { container } = render(<RepoCardSkeleton />);
        const skeletonBars = container.querySelectorAll('.bg-gray-200');
        expect(skeletonBars.length).toBeGreaterThan(0);
    });

    it('renders skeleton in correct structure', () => {
        const { container } = render(<RepoCardSkeleton />);
        // Should have multiple skeleton bars
        const skeletonBars = container.querySelectorAll('.bg-gray-200');
        expect(skeletonBars.length).toBe(12); // Based on structure: 1 title + 2 badges + 1 dot + 2 desc + 4 grid + 1 footer text + 1 footer icon
    });

    it('renders grid section', () => {
        const { container } = render(<RepoCardSkeleton />);
        const gridSection = container.querySelector('.grid-cols-2');
        expect(gridSection).toBeInTheDocument();
    });

    it('renders footer section with border', () => {
        const { container } = render(<RepoCardSkeleton />);
        const footer = container.querySelector('.border-t');
        expect(footer).toBeInTheDocument();
    });
});
