import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { GroupPanel } from '@/components/organisms/GroupPanel/GroupPanel';

describe('GroupPanel', () => {
    const mockGroups = [
        { id: 'g1', slug: 'frontend', name: 'Frontend', color: '#000000', description: 'FE Repos' }
    ];
    // Repos need 'groups' array property (groups contains slugs, not IDs)
    const mockRepos = [
        { id: 1, full_name: 'user/repo1', groups: ['frontend'] },
        { id: 2, full_name: 'user/repo2', groups: [] }
    ];

    const mockOnCreateGroup = vi.fn();
    const mockOnDeleteGroup = vi.fn();
    const mockOnSelectGroup = vi.fn();
    const mockOnAddToGroup = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders groups and counts correctly', () => {
        render(
            <GroupPanel
                groups={mockGroups}
                repos={mockRepos}
                selectedGroup="all"
            />
        );

        // All Repos count (2)
        // Find the "All Repos" text, go up to button, verify it has "2"
        const allReposBtn = screen.getByText('All Repos').closest('button');
        expect(within(allReposBtn).getByText('2')).toBeInTheDocument();

        // Ungrouped count (1)
        const ungroupedBtn = screen.getByText('Ungrouped').closest('button');
        expect(within(ungroupedBtn).getByText('1')).toBeInTheDocument();

        // Custom group
        expect(screen.getByText('Frontend')).toBeInTheDocument();

        // Count for custom group (1)
        const groupButton = screen.getByText('Frontend').closest('button');
        expect(within(groupButton).getByText('1')).toBeInTheDocument();
    });

    it('handles group selection', () => {
        render(
            <GroupPanel
                groups={mockGroups}
                repos={mockRepos}
                selectedGroup="all"
                onSelectGroup={mockOnSelectGroup}
            />
        );

        fireEvent.click(screen.getByText('Frontend'));
        expect(mockOnSelectGroup).toHaveBeenCalledWith('frontend');

        fireEvent.click(screen.getByText('Ungrouped'));
        expect(mockOnSelectGroup).toHaveBeenCalledWith('ungrouped');
    });

    it('handles group creation', () => {
        render(
            <GroupPanel
                groups={mockGroups}
                repos={mockRepos}
                onCreateGroup={mockOnCreateGroup}
            />
        );

        // Open form
        const createBtn = screen.getByTitle('Create New Group');
        fireEvent.click(createBtn);

        // Fill form
        fireEvent.change(screen.getByPlaceholderText('Group name'), { target: { value: 'Backend' } });
        fireEvent.change(screen.getByPlaceholderText('Description (optional)'), { target: { value: 'BE Repos' } });

        // Submit
        fireEvent.click(screen.getByText('Create Group')); // Submit button inside form

        expect(mockOnCreateGroup).toHaveBeenCalledWith('Backend', 'BE Repos', expect.any(String)); // Color is default
    });

    it('handles group deletion', () => {
        // Mock window.confirm
        const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);

        render(
            <GroupPanel
                groups={mockGroups}
                repos={mockRepos}
                onDeleteGroup={mockOnDeleteGroup}
            />
        );

        const deleteBtn = screen.getByTitle('Delete group');
        fireEvent.click(deleteBtn);

        expect(confirmSpy).toHaveBeenCalled();
        expect(mockOnDeleteGroup).toHaveBeenCalledWith('g1');

        confirmSpy.mockRestore();
    });

    it('handles drag and drop to add repo', () => {
        render(
            <GroupPanel
                groups={mockGroups}
                repos={mockRepos}
                onAddToGroup={mockOnAddToGroup}
            />
        );

        const groupDropZone = screen.getByText('Frontend').closest('div');

        // Mock dataTransfer
        const dataTransfer = {
            getData: vi.fn().mockReturnValue('user/repo2'),
            setData: vi.fn(),
            dropEffect: ''
        };

        fireEvent.drop(groupDropZone, {
            dataTransfer
        });

        expect(mockOnAddToGroup).toHaveBeenCalledWith('g1', 'user/repo2');
    });
});
