import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from '@/pages/LoginPage';
import * as router from 'react-router-dom';
import * as auth from '@/lib/auth';

vi.mock('react-router-dom', () => ({
    useNavigate: vi.fn(),
    useLocation: vi.fn(() => ({ state: null })),
    Navigate: ({ to }) => <div data-testid="navigate" data-to={to} />,
}));

vi.mock('@/lib/auth', () => ({
    login: vi.fn(),
    isAuthenticated: vi.fn(),
}));

describe('LoginPage', () => {
    const mockNavigate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        router.useNavigate.mockReturnValue(mockNavigate);
        auth.isAuthenticated.mockReturnValue(false);
    });

    it('renders login form with username, password and submit button', () => {
        render(<LoginPage />);

        expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('redirects to / when already authenticated', () => {
        auth.isAuthenticated.mockReturnValue(true);
        render(<LoginPage />);

        const navigate = screen.getByTestId('navigate');
        expect(navigate).toHaveAttribute('data-to', '/');
    });

    it('shows error message when login fails', async () => {
        auth.login.mockRejectedValue(new Error('Invalid credentials'));
        render(<LoginPage />);

        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'admin' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } });
        fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

        await waitFor(() => {
            expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
        });
    });

    it('navigates to / on successful login', async () => {
        auth.login.mockResolvedValue(undefined);
        render(<LoginPage />);

        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'admin' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'correct' } });
        fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/');
        });
    });

    it('returns to the page the visitor came from after signing in', async () => {
        router.useLocation.mockReturnValue({ state: { from: '/metrics/acme/api' } });
        auth.login.mockResolvedValue(undefined);
        render(<LoginPage />);

        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'admin' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'correct' } });
        fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('/metrics/acme/api');
        });
        router.useLocation.mockReturnValue({ state: null });
    });

    it('shows loading state during login', async () => {
        let resolveLogin;
        auth.login.mockReturnValue(new Promise(resolve => { resolveLogin = resolve; }));
        render(<LoginPage />);

        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'admin' } });
        fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pass' } });
        fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

        expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();

        resolveLogin();
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled();
        });
    });
});
