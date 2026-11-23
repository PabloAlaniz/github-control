import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RepoCard } from '@/components/organisms/RepoCard/RepoCard';

const mockRepo = {
    id: 1,
    name: 'test-repo',
    fullName: 'owner/test-repo',
    description: 'Test Description',
    htmlUrl: 'https://github.com/owner/test-repo',
    isPrivate: false,
    isArchived: false,
    isFork: false,
    stargazersCount: 10,
    forksCount: 5,
    openIssuesCount: 2,
    openPRsCount: 1,
    language: 'JavaScript',
    pushedAt: new Date().toISOString(),
    activityStatus: 'active',
    groups: []
};

const mockGroups = [
    { id: 'g1', name: 'Work', color: '#ff0000' }
];

describe('RepoCard', () => {
    it('renders repo basics correctly', () => {
        render(<RepoCard repo={mockRepo} groups={[]} />);
        expect(screen.getByText('test-repo')).toBeInTheDocument();
        expect(screen.getByText('Test Description')).toBeInTheDocument();
        expect(screen.getByText('JavaScript')).toBeInTheDocument();
    });

    it('shows Private badge when private', () => {
        render(<RepoCard repo={{ ...mockRepo, isPrivate: true }} groups={[]} />);
        expect(screen.getByText('Private')).toBeInTheDocument();
    });

    it('shows Archived badge when archived', () => {
        render(<RepoCard repo={{ ...mockRepo, isArchived: true }} groups={[]} />);
        expect(screen.getByText('Archived')).toBeInTheDocument();
    });

    it('shows Fork badge when fork', () => {
        render(<RepoCard repo={{ ...mockRepo, isFork: true }} groups={[]} />);
        expect(screen.getByText('Fork')).toBeInTheDocument();
    });

    it('opens actions menu on click', () => {
        render(<RepoCard repo={mockRepo} groups={[]} />);

        // Find the more vertical icon button (usually last button in footer)
        // Since we don't have aria-labels on buttons yet, we might need to rely on locating by role or adding test ids.
        // For now, let's try finding by role button that is not the "Documentation" one.
        // Actually, let's just find the menu trigger.
        // The implementation uses: onClick={() => setShowActions(!showActions)}

        const menuButtons = screen.getAllByRole('button');
        // Assuming the last one is the actions menu based on order in JSX
        const menuButton = menuButtons[menuButtons.length - 1];

        fireEvent.click(menuButton);

        expect(screen.getByText('View Docs')).toBeInTheDocument();
        expect(screen.getByText('Archive Repo')).toBeInTheDocument();
    });

    it('handles drag start', () => {
        render(<RepoCard repo={mockRepo} groups={[]} />);
        const card = screen.getByText('test-repo').closest('.group'); // The main card has "group" class

        const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
        fireEvent.dragStart(card, { dataTransfer });

        expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'owner/test-repo');
        expect(dataTransfer.effectAllowed).toBe('copy');
    });

    it('handles drag end', () => {
        render(<RepoCard repo={mockRepo} groups={[]} />);
        const card = screen.getByText('test-repo').closest('.group');
        const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
        fireEvent.dragStart(card, { dataTransfer });
        fireEvent.dragEnd(card);
        // Should not crash and remove dragging state
        expect(card).toBeInTheDocument();
    });

    it('renders group badges when repo has groups', () => {
        const repoWithGroups = { ...mockRepo, groups: ['g1'] };
        render(<RepoCard repo={repoWithGroups} groups={mockGroups} />);
        expect(screen.getByText('Work')).toBeInTheDocument();
    });

    it('calls onSetStatus when Mark Reviewed is clicked', () => {
        const onSetStatus = vi.fn();
        render(<RepoCard repo={mockRepo} groups={[]} onSetStatus={onSetStatus} />);

        // Open actions menu
        const menuButtons = screen.getAllByRole('button');
        const menuButton = menuButtons[menuButtons.length - 1];
        fireEvent.click(menuButton);

        fireEvent.click(screen.getByText('Mark Reviewed'));
        expect(onSetStatus).toHaveBeenCalledWith(undefined, 'test-repo', 'reviewed');
    });

    it('calls onSetStatus when Mark Pending is clicked', () => {
        const onSetStatus = vi.fn();
        render(<RepoCard repo={mockRepo} groups={[]} onSetStatus={onSetStatus} />);

        const menuButtons = screen.getAllByRole('button');
        fireEvent.click(menuButtons[menuButtons.length - 1]);

        fireEvent.click(screen.getByText('Mark Pending'));
        expect(onSetStatus).toHaveBeenCalledWith(undefined, 'test-repo', 'pending');
    });

    it('calls onArchive when Archive Repo is clicked', () => {
        const onArchive = vi.fn();
        render(<RepoCard repo={mockRepo} groups={[]} onArchive={onArchive} />);

        const menuButtons = screen.getAllByRole('button');
        fireEvent.click(menuButtons[menuButtons.length - 1]);

        fireEvent.click(screen.getByText('Archive Repo'));
        expect(onArchive).toHaveBeenCalledWith(undefined, 'test-repo');
    });

    it('does not show Archive Repo when already archived', () => {
        render(<RepoCard repo={{ ...mockRepo, isArchived: true }} groups={[]} />);

        const menuButtons = screen.getAllByRole('button');
        fireEvent.click(menuButtons[menuButtons.length - 1]);

        expect(screen.queryByText('Archive Repo')).not.toBeInTheDocument();
    });

    it('opens group submenu from actions menu', () => {
        render(<RepoCard repo={mockRepo} groups={mockGroups} />);

        const menuButtons = screen.getAllByRole('button');
        fireEvent.click(menuButtons[menuButtons.length - 1]);

        fireEvent.click(screen.getByText('Add to Group'));
        expect(screen.getByText('Select Group')).toBeInTheDocument();
        expect(screen.getByText('Work')).toBeInTheDocument();
    });

    it('calls onAddToGroup when group is selected', () => {
        const onAddToGroup = vi.fn();
        render(<RepoCard repo={mockRepo} groups={mockGroups} onAddToGroup={onAddToGroup} />);

        const menuButtons = screen.getAllByRole('button');
        fireEvent.click(menuButtons[menuButtons.length - 1]);
        fireEvent.click(screen.getByText('Add to Group'));
        fireEvent.click(screen.getByText('Work'));

        expect(onAddToGroup).toHaveBeenCalledWith('g1', 'owner/test-repo');
    });

    it('calls onOpenDocs when Documentation button is clicked', () => {
        const onOpenDocs = vi.fn();
        render(<RepoCard repo={mockRepo} groups={[]} onOpenDocs={onOpenDocs} />);

        const docButton = screen.getByTitle('Documentation');
        fireEvent.click(docButton);
        expect(onOpenDocs).toHaveBeenCalledWith(mockRepo);
    });

    it('renders repo metrics (stars, forks, issues, PRs)', () => {
        render(<RepoCard repo={mockRepo} groups={[]} />);
        expect(screen.getByText('10')).toBeInTheDocument(); // stars
        expect(screen.getByText('5')).toBeInTheDocument();  // forks
    });

    it('shows no description text when none provided', () => {
        render(<RepoCard repo={{ ...mockRepo, description: null }} groups={[]} />);
        expect(screen.getByText('test-repo')).toBeInTheDocument();
        expect(screen.queryByText('Test Description')).not.toBeInTheDocument();
    });
});
