import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { PolicyPage } from '@/pages/PolicyPage';
import * as router from 'react-router-dom';
import * as api from '@/lib/api';

vi.mock('react-router-dom', () => ({ useNavigate: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const current = { source: 'saved', editable: true, text: 'alerts:\n  stale_days: 90\n', yaml: 'version: 1\n', errors: [] };
const plan = {
    valid: true, yaml: 'version: 1\n',
    changes: [
        { section: 'alerts', key: 'stale_days', from: 90, to: 30 },
        { section: 'health.checks', key: 'codeowners', from: null, to: { id: 'codeowners', label: 'CODEOWNERS file' } },
        { section: 'baseline', key: 'has_wiki', from: false, to: null },
    ],
    impact: {
        repos: 12, averageBefore: 63, averageAfter: 59, scoreUp: 1, scoreDown: 8, driftBefore: 22, driftAfter: 19, alertsBefore: 5, alertsAfter: 7,
        affected: [{ repo: 'me/api', scoreBefore: 70, scoreAfter: 64, driftBefore: 3, driftAfter: 2 }, { repo: 'me/web', scoreBefore: 50, scoreAfter: 50, driftBefore: null, driftAfter: null }],
    },
    notes: ['New checks (codeowners) count once each repo is synced again.'],
};
const respond = (body, ok = true, status = ok ? 200 : 422) => Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
function mockApi({ policy = current, onPlan = () => respond(plan), onApply = () => respond({ ...plan, applied: true, policy: { ...current, text: 'x' } }) } = {}) {
    api.apiFetch.mockImplementation((path, options = {}) => {
        if (options.method === 'POST') return onPlan(options);
        if (options.method === 'PUT') return onApply(options);
        return respond(policy);
    });
}
const editor = () => screen.getByLabelText('Policy document (YAML)');
const calls = (method) => api.apiFetch.mock.calls.filter(([, o]) => o?.method === method);

describe('PolicyPage', () => {
    const navigate = vi.fn();
    beforeEach(() => {
        vi.clearAllMocks();
        router.useNavigate.mockReturnValue(navigate);
    });

    it('shows the document as written, or the complete defaults when there is none', async () => {
        mockApi();
        const { unmount } = render(<PolicyPage />);
        await waitFor(() => expect(editor()).toHaveValue('alerts:\n  stale_days: 90\n'));
        expect(screen.getByText('Saved from this page.')).toBeInTheDocument();
        unmount();

        mockApi({ policy: { ...current, source: 'default', text: '' } });
        render(<PolicyPage />);
        await waitFor(() => expect(editor()).toHaveValue('version: 1\n'));
        expect(screen.getByText(/these are the defaults/)).toBeInTheDocument();
    });

    it('previews what a change would do before anything can be applied', async () => {
        mockApi();
        render(<PolicyPage />);
        await waitFor(() => expect(editor()).toHaveValue(current.text));
        expect(screen.getByRole('button', { name: /Apply/ })).toBeDisabled();

        fireEvent.change(editor(), { target: { value: 'alerts:\n  stale_days: 30\n' } });
        fireEvent.click(screen.getByRole('button', { name: /Preview changes/ }));

        expect(await screen.findByText('What it would do to 12 repos')).toBeInTheDocument();
        expect(JSON.parse(calls('POST')[0][1].body)).toEqual({ yaml: 'alerts:\n  stale_days: 30\n' });
        expect(screen.getByText('stale_days').closest('li')).toHaveTextContent('Alert threshold · stale_days: 90 30');
        expect(screen.getByText('codeowners').closest('li')).toHaveTextContent('added codeowners (CODEOWNERS file)');
        expect(screen.getByText('has_wiki').closest('li')).toHaveTextContent('has_wiki: false not set');

        expect(screen.getByText('Average health').nextSibling).toHaveTextContent('59-4');
        expect(screen.getByText('Settings out of line').nextSibling).toHaveTextContent('19-3');
        expect(screen.getByText('Alerts that would be open').nextSibling).toHaveTextContent('7+2');
        expect(screen.getByText('1 repos score higher, 8 lower.')).toBeInTheDocument();
        expect(within(screen.getByRole('row', { name: /me\/api/ })).getByText('64')).toBeInTheDocument();
        expect(screen.getByText(/New checks \(codeowners\)/)).toBeInTheDocument();

        expect(screen.getByRole('button', { name: /Apply/ })).toBeEnabled();
    });

    it('applies only the text that was previewed', async () => {
        mockApi();
        render(<PolicyPage />);
        await waitFor(() => expect(editor()).toHaveValue(current.text));

        fireEvent.change(editor(), { target: { value: 'a: 1' } });
        fireEvent.click(screen.getByRole('button', { name: /Preview changes/ }));
        await screen.findByText('What changes');

        fireEvent.change(editor(), { target: { value: 'a: 2' } });
        expect(screen.getByRole('button', { name: /Apply/ })).toBeDisabled();
        expect(screen.getByText('The document changed since this preview.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Preview changes/ }));
        await waitFor(() => expect(screen.getByRole('button', { name: /Apply/ })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: /Apply/ }));

        expect(await screen.findByRole('status')).toHaveTextContent('Applied.');
        expect(JSON.parse(calls('PUT')[0][1].body)).toEqual({ yaml: 'a: 2' });
        expect(screen.getByRole('button', { name: /Apply/ })).toBeDisabled();
    });

    it('lists what is wrong with a document that is not valid', async () => {
        mockApi({ onPlan: () => respond({ valid: false, errors: ['health.weights: Unrecognized key: "speed"'] }, false) });
        render(<PolicyPage />);
        await waitFor(() => expect(editor()).toHaveValue(current.text));

        fireEvent.click(screen.getByRole('button', { name: /Preview changes/ }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Not a valid policy');
        expect(screen.getByText('health.weights: Unrecognized key: "speed"')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Apply/ })).toBeDisabled();
    });

    it('says when a preview finds nothing to change', async () => {
        mockApi({ onPlan: () => respond({ ...plan, changes: [], notes: [], impact: { ...plan.impact, affected: [] } }) });
        render(<PolicyPage />);
        await waitFor(() => expect(editor()).toHaveValue(current.text));

        fireEvent.click(screen.getByRole('button', { name: /Preview changes/ }));
        expect(await screen.findByText(/this is the policy already in force/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Apply/ })).toBeDisabled();
    });

    it('only previews when the policy comes from a file', async () => {
        mockApi({ policy: { ...current, source: 'file', editable: false } });
        render(<PolicyPage />);
        await waitFor(() => expect(editor()).toHaveValue(current.text));

        expect(screen.getByText(/read from the file POLICY_FILE points to/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Apply/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Preview changes/ })).toBeEnabled();
    });

    it('warns when the stored policy is broken', async () => {
        mockApi({ policy: { ...current, errors: ['baseline.nope: not a setting'] } });
        render(<PolicyPage />);
        expect(await screen.findByRole('alert')).toHaveTextContent('the defaults are in force: baseline.nope: not a setting');
    });

    it('reports a request that failed', async () => {
        mockApi({ onPlan: () => respond({ error: 'Not available in the demo' }, false, 403) });
        render(<PolicyPage />);
        await waitFor(() => expect(editor()).toHaveValue(current.text));

        fireEvent.click(screen.getByRole('button', { name: /Preview changes/ }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Not available in the demo');
    });

    it('offers a retry when it cannot load, and goes back', async () => {
        api.apiFetch.mockImplementationOnce(() => respond({ error: 'boom' }, false, 500));
        render(<PolicyPage />);
        expect(await screen.findByText('boom')).toBeInTheDocument();

        mockApi();
        fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
        fireEvent.click(await screen.findByRole('button', { name: /Back/ }));
        expect(navigate).toHaveBeenCalledWith('/');
    });
});
