import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkActionBar } from '@/components/organisms/BulkActionBar';

const groups = [
    { id: 1, name: 'Production', slug: 'prod', color: '#22c55e' },
    { id: 2, name: 'Side projects', slug: 'side', color: '#3b82f6' },
];

describe('BulkActionBar', () => {
    const baseProps = {
        count: 3,
        onArchive: vi.fn(),
        onSetPriority: vi.fn(),
        onAddToGroup: vi.fn(),
        onClear: vi.fn(),
        groups,
    };

    beforeEach(() => vi.clearAllMocks());

    it('renders nothing when count is 0', () => {
        const { container } = render(<BulkActionBar {...baseProps} count={0} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders count indicator when there is a selection', () => {
        render(<BulkActionBar {...baseProps} count={5} />);
        expect(screen.getByText('5 selected')).toBeInTheDocument();
    });

    it('calls onArchive after confirm', () => {
        const onArchive = vi.fn();
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<BulkActionBar {...baseProps} onArchive={onArchive} />);
        fireEvent.click(screen.getByText('Archive').closest('button'));
        expect(onArchive).toHaveBeenCalledOnce();
    });

    it('does NOT call onArchive when user cancels confirm', () => {
        const onArchive = vi.fn();
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        render(<BulkActionBar {...baseProps} onArchive={onArchive} />);
        fireEvent.click(screen.getByText('Archive').closest('button'));
        expect(onArchive).not.toHaveBeenCalled();
    });

    it('opens priority menu and selects a priority', () => {
        const onSetPriority = vi.fn();
        render(<BulkActionBar {...baseProps} onSetPriority={onSetPriority} />);
        fireEvent.click(screen.getByText('Priority').closest('button'));
        fireEvent.click(screen.getByText('High'));
        expect(onSetPriority).toHaveBeenCalledWith('high');
    });

    it('"Clear" priority passes null', () => {
        const onSetPriority = vi.fn();
        render(<BulkActionBar {...baseProps} onSetPriority={onSetPriority} />);
        fireEvent.click(screen.getByText('Priority').closest('button'));
        // First "Clear" is the priority menu option; second is the clear-selection toolbar button.
        const clearOptions = screen.getAllByText('Clear');
        fireEvent.click(clearOptions[0]);
        expect(onSetPriority).toHaveBeenCalledWith(null);
    });

    it('opens group menu and selects a group', () => {
        const onAddToGroup = vi.fn();
        render(<BulkActionBar {...baseProps} onAddToGroup={onAddToGroup} />);
        fireEvent.click(screen.getByText('Group').closest('button'));
        fireEvent.click(screen.getByText('Production'));
        expect(onAddToGroup).toHaveBeenCalledWith(groups[0]);
    });

    it('shows empty state in group menu when no groups available', () => {
        render(<BulkActionBar {...baseProps} groups={[]} />);
        fireEvent.click(screen.getByText('Group').closest('button'));
        expect(screen.getByText('No groups available')).toBeInTheDocument();
    });

    it('calls onClear when Clear button is clicked', () => {
        const onClear = vi.fn();
        render(<BulkActionBar {...baseProps} onClear={onClear} />);
        // Use getAllByText since "Clear" priority option uses the same word.
        const buttons = screen.getAllByText('Clear');
        // The clear-selection button is the last one (rightmost in toolbar).
        fireEvent.click(buttons[buttons.length - 1].closest('button'));
        expect(onClear).toHaveBeenCalledOnce();
    });

    it('disables action buttons when busy=true', () => {
        render(<BulkActionBar {...baseProps} busy />);
        expect(screen.getByText('Archive').closest('button')).toBeDisabled();
        expect(screen.getByText('Priority').closest('button')).toBeDisabled();
        expect(screen.getByText('Group').closest('button')).toBeDisabled();
    });
});
