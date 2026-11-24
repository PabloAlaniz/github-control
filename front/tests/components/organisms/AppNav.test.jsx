import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AppNav } from '@/components/organisms/AppNav';
import { alertsChanged } from '@/hooks/useAlertCount';
import * as api from '@/lib/api';
import * as auth from '@/lib/auth';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/auth', () => ({ logout: vi.fn() }));

const Where = () => <span data-testid="where">{useLocation().pathname}</span>;
const renderAt = (path = '/') => render(
    <MemoryRouter initialEntries={[path]}>
        <AppNav />
        <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
);
const open = (count) => api.apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ open: count }) });
const rail = () => screen.getByRole('navigation', { name: 'Main' });

describe('AppNav', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        open(0);
    });

    it('lists every destination and marks where you are', () => {
        renderAt('/inbox');
        const labels = within(rail()).getAllByRole('button').map((button) => button.getAttribute('aria-label'));
        expect(labels.slice(0, 10)).toEqual(['Repos', 'Inbox', 'Alerts', 'Search', 'Metrics', 'Deps', 'Activity', 'Policy', 'Badges', 'Settings']);
        expect(within(rail()).getByRole('button', { name: 'Inbox' })).toHaveAttribute('aria-current', 'page');
        expect(within(rail()).getByRole('button', { name: 'Repos' })).not.toHaveAttribute('aria-current');
    });

    it('keeps a section lit on its inner pages, and Repos only on the dashboard itself', () => {
        renderAt('/metrics/acme/api');
        expect(within(rail()).getByRole('button', { name: 'Metrics' })).toHaveAttribute('aria-current', 'page');
        expect(within(rail()).getByRole('button', { name: 'Repos' })).not.toHaveAttribute('aria-current');
    });

    it('takes you there', () => {
        renderAt('/');
        fireEvent.click(within(rail()).getByRole('button', { name: 'Policy' }));
        expect(screen.getByTestId('where')).toHaveTextContent('/policy');
    });

    it('shows how many alerts are open and keeps the count fresh', async () => {
        open(5);
        renderAt('/');
        expect(await within(rail()).findByRole('button', { name: 'Alerts: 5 open' })).toHaveTextContent('5');

        // Going to another page, or being told alerts changed, asks again.
        open(2);
        fireEvent.click(within(rail()).getByRole('button', { name: 'Search' }));
        expect(await within(rail()).findByRole('button', { name: 'Alerts: 2 open' })).toBeInTheDocument();
        open(0);
        alertsChanged();
        expect(await within(rail()).findByRole('button', { name: 'Alerts' })).toBeInTheDocument();
    });

    it('works without the count', async () => {
        api.apiFetch.mockRejectedValue(new Error('offline'));
        renderAt('/');
        await waitFor(() => expect(api.apiFetch).toHaveBeenCalled());
        expect(within(rail()).getByRole('button', { name: 'Alerts' })).toBeInTheDocument();
    });

    it('changes the theme and signs out', () => {
        renderAt('/');
        fireEvent.click(within(rail()).getByRole('button', { name: /Change theme/ }));
        expect(document.documentElement.dataset.theme).toBe('light');

        fireEvent.click(within(rail()).getByRole('button', { name: 'Logout' }));
        expect(auth.logout).toHaveBeenCalled();
        expect(screen.getByTestId('where')).toHaveTextContent('/login');
    });

    it('offers the same destinations in a menu on narrow screens, closed until asked for', () => {
        renderAt('/alerts');
        expect(screen.queryByRole('navigation', { name: 'Main menu' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
        const menu = screen.getByRole('navigation', { name: 'Main menu' });
        expect(within(menu).getByRole('button', { name: 'Alerts' })).toHaveAttribute('aria-current', 'page');

        fireEvent.click(within(menu).getByRole('button', { name: 'Inbox' }));
        expect(screen.getByTestId('where')).toHaveTextContent('/inbox');
        expect(screen.queryByRole('navigation', { name: 'Main menu' })).not.toBeInTheDocument();
    });
});
