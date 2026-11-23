import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AlertsPage } from '@/pages/AlertsPage';
import * as router from 'react-router-dom';
import * as api from '@/lib/api';

vi.mock('react-router-dom', () => ({ useNavigate: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const now = new Date().toISOString();
const alertsPayload = {
    open: 2,
    kinds: { ci_failing: 'CI failing', security: 'Security alerts', service_down: 'Service down' },
    rules: { staleDays: 90, healthBelow: 40 },
    alerts: [
        { id: 3, key: 'security:me/api', kind: 'security', entity: 'me/api', title: '2 serious security alerts on me/api (2 high)', detail: { top: ['lodash: prototype pollution'] }, url: 'https://github.com/me/api/security', status: 'open', opened_at: now, resolved_at: null },
        { id: 2, key: 'ci_failing:me/api', kind: 'ci_failing', entity: 'me/api', title: 'CI is failing on me/api', detail: {}, url: null, status: 'open', opened_at: now, resolved_at: null },
        { id: 1, key: 'service_down:web', kind: 'service_down', entity: 'web', title: 'Web is down', detail: {}, url: null, status: 'resolved', opened_at: now, resolved_at: now },
    ],
};
const types = [
    { type: 'slack', label: 'Slack', fields: [{ key: 'url', label: 'Incoming webhook URL', placeholder: 'https://hooks.slack.com/services/...', secret: true }] },
    { type: 'telegram', label: 'Telegram', fields: [
        { key: 'botToken', label: 'Bot token', placeholder: '123456:ABC', secret: true },
        { key: 'chatId', label: 'Chat ID', placeholder: '-100', secret: false },
    ] },
];
const kinds = [{ kind: 'ci_failing', label: 'CI failing' }, { kind: 'security', label: 'Security alerts' }, { kind: 'service_down', label: 'Service down' }];
const channel = {
    id: 7, name: 'Ops', type: 'telegram', config: { botToken: '••••abcd', chatId: '-100' }, kinds: ['ci_failing'],
    is_enabled: true, digest: 'daily', last_sent_at: null, last_error: null,
};

const respond = (body, ok = true, status = ok ? 200 : 400) => Promise.resolve({ ok, status, json: () => Promise.resolve(body) });

/** Routes the mocked API by method and path; `extra` handles the calls a test cares about. */
function mockApi({ channels = [], alerts = alertsPayload, extra = () => null } = {}) {
    api.apiFetch.mockImplementation((path, options = {}) => {
        const handled = extra(path, options);
        if (handled) return handled;
        if (path.startsWith('/api/alerts/channels')) return respond({ channels, types, kinds });
        return respond(alerts);
    });
}
const calls = (method) => api.apiFetch.mock.calls.filter(([, options]) => (options?.method ?? 'GET') === method);

describe('AlertsPage', () => {
    const navigate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        router.useNavigate.mockReturnValue(navigate);
    });

    it('lists open alerts with their detail, and the resolved ones apart', async () => {
        mockApi();
        render(<AlertsPage />);

        expect(await screen.findByText('2 serious security alerts on me/api (2 high)')).toBeInTheDocument();
        expect(screen.getByText('lodash: prototype pollution')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /2 serious security alerts/ })).toHaveAttribute('href', 'https://github.com/me/api/security');
        expect(screen.getByText('(2)')).toBeInTheDocument();

        const resolved = screen.getByText('Recently resolved').closest('div').parentElement;
        expect(within(resolved).getByText('Web is down')).toBeInTheDocument();
        expect(within(resolved).queryByText('CI is failing on me/api')).not.toBeInTheDocument();
    });

    it('describes the rules in force', async () => {
        mockApi({ alerts: { ...alertsPayload, rules: { staleDays: 0, healthBelow: 55 } } });
        render(<AlertsPage />);

        const text = await screen.findByText(/^Alerts open for:/);
        expect(text).toHaveTextContent('a health score under 55');
        expect(text).not.toHaveTextContent('without commits');
    });

    it('says so when nothing is open and there are no channels', async () => {
        mockApi({ alerts: { ...alertsPayload, open: 0, alerts: [] } });
        render(<AlertsPage />);

        expect(await screen.findByText('Nothing needs attention.')).toBeInTheDocument();
        expect(screen.getByText(/No channels yet/)).toBeInTheDocument();
        expect(screen.queryByText('Recently resolved')).not.toBeInTheDocument();
    });

    it('adds a channel with the fields of its type', async () => {
        mockApi({ extra: (path, { method }) => (method === 'POST' && path === '/api/alerts/channels' ? respond({ success: true }) : null) });
        render(<AlertsPage />);

        fireEvent.click(await screen.findByRole('button', { name: /Add channel/ }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ops' } });
        fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'telegram' } });
        fireEvent.change(screen.getByLabelText('Bot token'), { target: { value: '123:abc' } });
        fireEvent.change(screen.getByLabelText('Chat ID'), { target: { value: '-100' } });
        fireEvent.click(screen.getByLabelText('Security alerts'));       // everything but security
        fireEvent.change(screen.getByLabelText('Digest'), { target: { value: 'weekly' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add channel' }));

        await waitFor(() => expect(calls('POST')).toHaveLength(1));
        const [path, options] = calls('POST')[0];
        expect(path).toBe('/api/alerts/channels');
        expect(JSON.parse(options.body)).toEqual({
            name: 'Ops', type: 'telegram', config: { botToken: '123:abc', chatId: '-100' },
            kinds: ['ci_failing', 'service_down'], is_enabled: true, digest: 'weekly',
        });
        await waitFor(() => expect(screen.queryByLabelText('Name')).not.toBeInTheDocument());
    });

    it('shows why a channel could not be saved and keeps the form open', async () => {
        mockApi({ extra: (path, { method }) => (method === 'POST' ? respond({ error: 'Webhook URL is not a valid URL' }, false) : null) });
        render(<AlertsPage />);

        fireEvent.click(await screen.findByRole('button', { name: /Add channel/ }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Chat' } });
        fireEvent.change(screen.getByLabelText('Incoming webhook URL'), { target: { value: 'nope' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add channel' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Webhook URL is not a valid URL');
        expect(screen.getByLabelText('Name')).toHaveValue('Chat');
    });

    it('edits a channel without asking for its secret again', async () => {
        mockApi({ channels: [channel], extra: (path, { method }) => (method === 'PUT' ? respond({ success: true }) : null) });
        render(<AlertsPage />);

        expect(await screen.findByText(/CI failing · Daily digest/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Edit Ops' }));

        expect(screen.getByLabelText('Bot token')).toHaveValue('');
        expect(screen.getByLabelText('Bot token')).not.toBeRequired();
        expect(screen.getByLabelText('Bot token')).toHaveAttribute('placeholder', '••••abcd (leave empty to keep)');
        expect(screen.getByLabelText('Chat ID')).toHaveValue('-100');

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ops team' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(calls('PUT')).toHaveLength(1));
        const [path, options] = calls('PUT')[0];
        expect(path).toBe('/api/alerts/channels/7');
        expect(JSON.parse(options.body)).toMatchObject({ name: 'Ops team', type: 'telegram', config: {}, kinds: ['ci_failing'], digest: 'daily' });
    });

    it('sends a test message and shows how it went', async () => {
        let ok = true;
        mockApi({
            channels: [channel],
            extra: (path, { method }) => (method === 'POST' && path.endsWith('/test')
                ? respond(ok ? { ok: true, error: null } : { ok: false, error: 'The destination answered HTTP 403' })
                : null),
        });
        render(<AlertsPage />);

        fireEvent.click(await screen.findByRole('button', { name: /Test/ }));
        expect(await screen.findByText('Test message sent')).toBeInTheDocument();

        ok = false;
        fireEvent.click(screen.getByRole('button', { name: /Test/ }));
        expect(await screen.findByText('Last delivery failed: The destination answered HTTP 403')).toBeInTheDocument();
    });

    it('shows the last delivery failure of a channel', async () => {
        mockApi({ channels: [{ ...channel, last_error: 'Could not reach the destination', is_enabled: false }] });
        render(<AlertsPage />);

        expect(await screen.findByText('Last delivery failed: Could not reach the destination')).toBeInTheDocument();
        expect(screen.getByText(/· disabled/)).toBeInTheDocument();
    });

    it('deletes a channel after confirming', async () => {
        mockApi({ channels: [channel], extra: (path, { method }) => (method === 'DELETE' ? respond({ success: true }) : null) });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        render(<AlertsPage />);

        fireEvent.click(await screen.findByRole('button', { name: 'Delete Ops' }));
        expect(calls('DELETE')).toHaveLength(0);
        fireEvent.click(screen.getByRole('button', { name: 'Delete Ops' }));
        await waitFor(() => expect(calls('DELETE')).toHaveLength(1));
        expect(calls('DELETE')[0][0]).toBe('/api/alerts/channels/7');
        confirm.mockRestore();
    });

    it('checks again on demand', async () => {
        mockApi({ extra: (path, { method }) => (method === 'POST' && path === '/api/alerts/evaluate' ? respond({ opened: 0 }) : null) });
        render(<AlertsPage />);

        fireEvent.click(await screen.findByRole('button', { name: /Check now/ }));
        await waitFor(() => expect(calls('POST')).toHaveLength(1));
        // Loaded once on mount (alerts + channels) and once more after the check.
        await waitFor(() => expect(calls('GET')).toHaveLength(4));
    });

    it('offers a retry when it cannot load, and goes back', async () => {
        api.apiFetch.mockImplementationOnce(() => respond({ error: 'boom' }, false, 500)).mockImplementationOnce(() => respond({}));
        render(<AlertsPage />);
        expect(await screen.findByText('boom')).toBeInTheDocument();

        mockApi();
        fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
        fireEvent.click(await screen.findByRole('button', { name: /Back/ }));
        expect(navigate).toHaveBeenCalledWith('/');
    });
});
