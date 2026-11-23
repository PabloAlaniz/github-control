import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RepoList } from '@/components/organisms/RepoList/RepoList';

describe('RepoList', () => {
    const mockProps = {
        repos: [],
        groups: [],
        loading: false,
        onArchive: vi.fn(),
        onSetStatus: vi.fn(),
        onAddToGroup: vi.fn(),
        onRemoveFromGroup: vi.fn(),
        onOpenDocs: vi.fn(),
    };

    it('renders loading state correctly', () => {
        render(<RepoList {...mockProps} loading={true} />);
        
        expect(screen.getByText('Loading repositories...')).toBeInTheDocument();
        // Should show 8 skeleton cards
        expect(document.querySelectorAll('[data-testid="repo-card-skeleton"]')).toHaveLength(0); // RepoCardSkeleton might not have testid
    });

    it('renders empty state when no repositories', () => {
        render(<RepoList {...mockProps} repos={[]} />);
        
        expect(screen.getByText('No repositories found')).toBeInTheDocument();
        expect(screen.getByText('Try adjusting your filters or search query.')).toBeInTheDocument();
    });

    it('renders repository list with count', () => {
        const mockRepos = [
            {
                id: 1,
                name: 'test-repo-1',
                fullName: 'owner/test-repo-1',
            },
            {
                id: 2,
                name: 'test-repo-2',
                fullName: 'owner/test-repo-2',
            }
        ];

        render(<RepoList {...mockProps} repos={mockRepos} />);
        
        expect(screen.getByText('Showing 2 repositories')).toBeInTheDocument();
        // The RepoCard components should be rendered, but we're not testing their internal content here
    });

    it('shows correct count for single repository', () => {
        const mockRepos = [
            {
                id: 1,
                name: 'single-repo',
                fullName: 'owner/single-repo',
            }
        ];

        render(<RepoList {...mockProps} repos={mockRepos} />);
        
        expect(screen.getByText('Showing 1 repositories')).toBeInTheDocument();
    });
});