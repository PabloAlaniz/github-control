import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ProtectedRoute } from '@/components/templates/ProtectedRoute/ProtectedRoute';

// Mock the auth module
vi.mock('@/lib/auth', () => ({
  isAuthenticated: vi.fn(),
}));

const mockIsAuthenticated = vi.mocked(await import('@/lib/auth')).isAuthenticated;

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children when user is authenticated', () => {
    mockIsAuthenticated.mockReturnValue(true);

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div data-testid="protected-content">Protected Content</div>
        </ProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
  });

  it('sends unauthenticated visitors to /login, remembering where they were going', () => {
    mockIsAuthenticated.mockReturnValue(false);
    const Login = () => <div data-testid="login">from: {useLocation().state?.from}</div>;

    render(
      <MemoryRouter initialEntries={['/metrics/acme/api?days=90']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/metrics/:owner/:repo"
            element={<ProtectedRoute><div data-testid="protected-content">Protected Content</div></ProtectedRoute>}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('login')).toHaveTextContent('from: /metrics/acme/api?days=90');
  });
});
