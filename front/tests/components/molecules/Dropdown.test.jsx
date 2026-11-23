import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dropdown } from '@/components/molecules/Dropdown/Dropdown';

describe('Dropdown', () => {
    it('renders nothing when closed', () => {
        const { container } = render(
            <Dropdown open={false} onClose={() => {}}>
                <div>Content</div>
            </Dropdown>
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders children when open', () => {
        render(
            <Dropdown open={true} onClose={() => {}}>
                <div>Menu content</div>
            </Dropdown>
        );
        expect(screen.getByText('Menu content')).toBeInTheDocument();
    });

    it('calls onClose when backdrop is clicked', async () => {
        const user = userEvent.setup();
        const handleClose = vi.fn();
        const { container } = render(
            <div>
                <Dropdown open={true} onClose={handleClose}>
                    <div>Content</div>
                </Dropdown>
            </div>
        );
        // The backdrop is the fixed inset-0 div
        const backdrop = container.querySelector('.fixed.inset-0');
        await user.click(backdrop);
        expect(handleClose).toHaveBeenCalledOnce();
    });

    it('applies position classes', () => {
        const { container } = render(
            <Dropdown open={true} onClose={() => {}} position="bottom-left">
                <div>Content</div>
            </Dropdown>
        );
        const menu = container.querySelector('.bg-white.rounded-lg');
        expect(menu).toHaveClass('left-0');
    });

    it('accepts custom className', () => {
        const { container } = render(
            <Dropdown open={true} onClose={() => {}} className="w-64">
                <div>Content</div>
            </Dropdown>
        );
        const menu = container.querySelector('.bg-white.rounded-lg');
        expect(menu).toHaveClass('w-64');
    });
});
