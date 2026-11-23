import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SavedViews } from '@/components/molecules/SavedViews';

describe('SavedViews', () => {
    const views = [
        { id: 1, name: 'Prod sin CI', query: 'health=needs-ci&groups=prod' },
        { id: 2, name: 'Stale', query: 'stale=1' },
    ];
    let props;

    beforeEach(() => {
        props = {
            views,
            currentQuery: '',
            onApply: vi.fn(),
            onSave: vi.fn().mockResolvedValue(true),
            onDelete: vi.fn(),
            onReset: vi.fn(),
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows an empty state without views', () => {
        render(<SavedViews {...props} views={[]} />);
        expect(screen.getByText('No saved views yet')).toBeInTheDocument();
    });

    it('applies a view on click', () => {
        render(<SavedViews {...props} />);
        fireEvent.click(screen.getByText('Stale'));
        expect(props.onApply).toHaveBeenCalledWith(views[1]);
    });

    it('marks the view matching the current query as active, regardless of param order', () => {
        render(<SavedViews {...props} currentQuery="health=needs-ci&groups=prod" views={[
            { id: 1, name: 'Prod sin CI', query: 'groups=prod&health=needs-ci' },
            views[1],
        ]} />);
        expect(screen.getByText('Prod sin CI').closest('button')).toHaveAttribute('aria-current', 'true');
        expect(screen.getByText('Stale').closest('button')).not.toHaveAttribute('aria-current');
    });

    it('only offers reset when filters differ from the default', () => {
        const { rerender } = render(<SavedViews {...props} />);
        expect(screen.queryByTitle('Reset filters')).not.toBeInTheDocument();

        rerender(<SavedViews {...props} currentQuery="stale=1" />);
        fireEvent.click(screen.getByTitle('Reset filters'));
        expect(props.onReset).toHaveBeenCalled();
    });

    it('saves the current query under a trimmed name and closes the form', async () => {
        render(<SavedViews {...props} currentQuery="stale=1" />);

        fireEvent.click(screen.getByTitle('Save current view'));
        fireEvent.change(screen.getByPlaceholderText('View name'), { target: { value: '  Viejos  ' } });
        fireEvent.click(screen.getByText('Save current filters'));

        expect(props.onSave).toHaveBeenCalledWith('Viejos', 'stale=1');
        await waitFor(() => expect(screen.queryByPlaceholderText('View name')).not.toBeInTheDocument());
    });

    it('keeps the form open when saving fails', async () => {
        props.onSave.mockResolvedValue(false);
        render(<SavedViews {...props} />);

        fireEvent.click(screen.getByTitle('Save current view'));
        fireEvent.change(screen.getByPlaceholderText('View name'), { target: { value: 'X' } });
        fireEvent.click(screen.getByText('Save current filters'));

        await waitFor(() => expect(props.onSave).toHaveBeenCalled());
        expect(screen.getByPlaceholderText('View name')).toBeInTheDocument();
    });

    it('does not save a blank name', () => {
        render(<SavedViews {...props} />);
        fireEvent.click(screen.getByTitle('Save current view'));
        fireEvent.submit(screen.getByPlaceholderText('View name').closest('form'));
        expect(props.onSave).not.toHaveBeenCalled();
    });

    it('deletes a view only after confirmation', () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        render(<SavedViews {...props} />);

        fireEvent.click(screen.getAllByTitle('Delete view')[0]);
        expect(props.onDelete).not.toHaveBeenCalled();

        confirmSpy.mockReturnValue(true);
        fireEvent.click(screen.getAllByTitle('Delete view')[0]);
        expect(props.onDelete).toHaveBeenCalledWith(1);
    });
});
