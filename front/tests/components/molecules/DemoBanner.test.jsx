import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { DemoBanner } from '@/components/molecules/DemoBanner';
import { notifyDemoBlocked, setDemo } from '@/lib/demo';

describe('DemoBanner', () => {
    beforeEach(() => act(() => setDemo(null)));
    afterEach(() => vi.useRealTimers());

    it('renders nothing on a normal instance', () => {
        const { container } = render(<DemoBanner />);
        expect(container).toBeEmptyDOMElement();
    });

    it('says the data is fictional and when it resets', () => {
        act(() => setDemo({ readOnly: false, resetMinutes: 60 }));
        render(<DemoBanner />);
        expect(screen.getByRole('status')).toHaveTextContent('Demo with fictional data. Changes reset every hour.');
        expect(screen.getByRole('link', { name: 'Run your own' })).toHaveAttribute('href', expect.stringContaining('github.com'));
    });

    it('describes other reset intervals and read-only demos', () => {
        act(() => setDemo({ readOnly: false, resetMinutes: 10 }));
        const { unmount } = render(<DemoBanner />);
        expect(screen.getByRole('status')).toHaveTextContent('Changes reset every 10 minutes.');
        unmount();

        act(() => setDemo({ readOnly: true, resetMinutes: 60 }));
        render(<DemoBanner />);
        expect(screen.getByRole('status')).toHaveTextContent('Read-only.');
    });

    it('explains a refused action for a few seconds', () => {
        vi.useFakeTimers();
        act(() => setDemo({ readOnly: false, resetMinutes: 60 }));
        render(<DemoBanner />);

        act(() => notifyDemoBlocked());
        expect(screen.getByRole('status')).toHaveTextContent('not available in the demo');

        act(() => vi.advanceTimersByTime(4000));
        expect(screen.getByRole('status')).toHaveTextContent('Demo with fictional data');
    });
});
