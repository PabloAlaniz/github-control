import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EmbedsPage } from '@/pages/EmbedsPage';
import * as router from 'react-router-dom';
import * as api from '@/lib/api';

vi.mock('react-router-dom', () => ({ useNavigate: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const embeds = { badges: true, status: true, metrics: ['stars', 'ci', 'downloads'], themes: ['auto', 'light', 'dark'] };
const repos = [
    { full_name: 'me/web', is_private: false }, { full_name: 'me/api', is_private: false }, { full_name: 'me/secret', is_private: true },
];
const respond = (body, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });
function mockApi(info = embeds, list = repos) {
    api.apiFetch.mockImplementation((path) => respond(path === '/api/embeds' ? info : list));
}
const origin = window.location.origin;

describe('EmbedsPage', () => {
    const navigate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        router.useNavigate.mockReturnValue(navigate);
        window.history.replaceState(null, '', '/embeds');
    });

    it('offers the summary card with its Markdown', async () => {
        mockApi();
        render(<EmbedsPage />);

        const preview = await screen.findByAltText('Summary card preview');
        expect(preview).toHaveAttribute('src', `${origin}/api/badges/summary.svg`);
        expect(screen.getByText(`![Open source at a glance](${origin}/api/badges/summary.svg)`)).toBeInTheDocument();
    });

    it('applies the title and theme to the summary and the repo card', async () => {
        mockApi();
        render(<EmbedsPage />);
        await screen.findByAltText('Summary card preview');

        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Acme & co' } });
        fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });

        expect(screen.getByAltText('Summary card preview')).toHaveAttribute('src', `${origin}/api/badges/summary.svg?title=Acme%20%26%20co&theme=dark`);
        expect(screen.getByAltText('Card preview for me/api')).toHaveAttribute('src', `${origin}/api/badges/me/api/card.svg?theme=dark`);
    });

    it('lists the badges of a public repo and lets another be picked', async () => {
        mockApi();
        render(<EmbedsPage />);

        expect(await screen.findByAltText('stars badge preview')).toHaveAttribute('src', `${origin}/api/badges/me/api/stars.svg`);
        expect(screen.getByText(`![ci](${origin}/api/badges/me/api/ci.svg)`)).toBeInTheDocument();
        expect(screen.getByText(`[![me/api](${origin}/api/badges/me/api/card.svg)](https://github.com/me/api)`)).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'me/secret' })).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Repo'), { target: { value: 'me/web' } });
        expect(screen.getByAltText('downloads badge preview')).toHaveAttribute('src', `${origin}/api/badges/me/web/downloads.svg`);
    });

    it('opens on the repo named in the URL', async () => {
        window.history.replaceState(null, '', '/embeds?repo=me/web');
        mockApi();
        render(<EmbedsPage />);
        expect(await screen.findByAltText('Card preview for me/web')).toBeInTheDocument();
    });

    it('links the status page and its badge', async () => {
        mockApi();
        render(<EmbedsPage />);

        expect(await screen.findByRole('link', { name: `${origin}/status` })).toHaveAttribute('href', '/status');
        expect(screen.getByText(`[![status](${origin}/api/status/badge.svg)](${origin}/status)`)).toBeInTheDocument();
    });

    it('copies a snippet', async () => {
        const writeText = vi.fn().mockResolvedValue();
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        mockApi();
        render(<EmbedsPage />);

        fireEvent.click(await screen.findByRole('button', { name: 'Copy Stars' }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(`![stars](${origin}/api/badges/me/api/stars.svg)`));
        expect(await screen.findByText('Copied')).toBeInTheDocument();
    });

    it('explains how to turn on what is off', async () => {
        mockApi({ ...embeds, badges: false, status: false });
        render(<EmbedsPage />);

        expect(await screen.findByText(/The status page and its badges are switched off/)).toBeInTheDocument();
        expect(screen.getAllByText(/Badges and cards are switched off/)).toHaveLength(2);
        expect(screen.getByText('PUBLIC_STATUS=true')).toBeInTheDocument();
        expect(screen.queryByAltText('Summary card preview')).not.toBeInTheDocument();
    });

    it('says so when there are no public repos, and goes back', async () => {
        mockApi(embeds, [{ full_name: 'me/secret', is_private: true }]);
        render(<EmbedsPage />);

        expect(await screen.findByText('No public repos yet.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Back/ }));
        expect(navigate).toHaveBeenCalledWith('/');
    });

    it('offers a retry when it cannot load', async () => {
        api.apiFetch.mockImplementation(() => respond({ error: 'boom' }, false));
        render(<EmbedsPage />);
        expect(await screen.findByText('boom')).toBeInTheDocument();
    });
});
