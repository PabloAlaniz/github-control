import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CiStatusBadge } from '@/components/atoms/CiStatusBadge';

describe('CiStatusBadge', () => {
    it('renders success state with green checkmark when ciStatus=success', () => {
        const { container } = render(<CiStatusBadge ciStatus="success" />);
        expect(container.querySelector('[aria-label="CI passing"]')).not.toBeNull();
    });

    it('renders failure state when ciStatus=failure', () => {
        const { container } = render(<CiStatusBadge ciStatus="failure" />);
        expect(container.querySelector('[aria-label="CI failed"]')).not.toBeNull();
    });

    it('renders in-progress state when ciStatus=in_progress', () => {
        const { container } = render(<CiStatusBadge ciStatus="in_progress" />);
        expect(container.querySelector('[aria-label="CI in progress"]')).not.toBeNull();
    });

    it('wraps the icon in a link when ciStatusUrl is provided', () => {
        const { container } = render(
            <CiStatusBadge ciStatus="success" ciStatusUrl="https://github.com/o/r/actions/runs/1" />
        );
        const link = container.querySelector('a');
        expect(link).not.toBeNull();
        expect(link.getAttribute('href')).toBe('https://github.com/o/r/actions/runs/1');
        expect(link.getAttribute('target')).toBe('_blank');
    });

    it('falls back to "CI configured" when no ciStatus but hasCi=true', () => {
        const { container } = render(<CiStatusBadge ciStatus={null} hasCi={true} />);
        expect(container.querySelector('[aria-label="CI configured (no recent run)"]')).not.toBeNull();
    });

    it('falls back to "No CI" when ciStatus null and hasCi=false', () => {
        const { container } = render(<CiStatusBadge ciStatus={null} hasCi={false} />);
        expect(container.querySelector('[aria-label="No CI"]')).not.toBeNull();
    });

    it('falls back to "CI unknown" when both ciStatus and hasCi are null', () => {
        const { container } = render(<CiStatusBadge ciStatus={null} hasCi={null} />);
        expect(container.querySelector('[aria-label="CI unknown"]')).not.toBeNull();
    });

    it('renders unknown status with neutral icon', () => {
        const { container } = render(<CiStatusBadge ciStatus="some_unknown_status" hasCi={true} />);
        // Falls back to hasCi indicator since status is not in map.
        expect(container.querySelector('[aria-label="CI configured (no recent run)"]')).not.toBeNull();
    });
});
