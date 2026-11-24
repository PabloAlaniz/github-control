import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '@/App';

// Mock the pages
vi.mock('@/pages', () => ({
  HomePage: () => <div data-testid="home-page">Home Page</div>,
  ActivityPage: () => <div data-testid="activity-page">Activity Page</div>,
  LoginPage: () => <div data-testid="login-page">Login Page</div>,
  MetricsPage: () => <div data-testid="metrics-page">Metrics Page</div>,
  RepoMetricsPage: () => <div data-testid="repo-metrics-page">Repo Metrics Page</div>,
  DependenciesPage: () => <div data-testid="dependencies-page">Dependencies Page</div>,
  AlertsPage: () => <div data-testid="alerts-page">Alerts Page</div>,
  InboxPage: () => <div data-testid="inbox-page">Inbox Page</div>,
  EmbedsPage: () => <div data-testid="embeds-page">Embeds Page</div>,
  StatusPage: () => <div data-testid="status-page">Status Page</div>,
  PolicyPage: () => <div data-testid="policy-page">Policy Page</div>,
  SearchPage: () => <div data-testid="search-page">Search Page</div>,
}));

// Mock ProtectedRoute to render children for testing
vi.mock('@/components/templates/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }) => <div data-testid="protected-route">{children}</div>,
}));

describe('App', () => {
  it('renders login page for /login route', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    );
    
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
  });

  it('renders home page for / route', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );
    
    expect(screen.getByTestId('protected-route')).toBeInTheDocument();
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
  });

  it('redirects /health to / route', () => {
    render(
      <MemoryRouter initialEntries={['/health']}>
        <App />
      </MemoryRouter>
    );
    
    // After redirect, should show protected home page
    expect(screen.getByTestId('protected-route')).toBeInTheDocument();
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
  });

  it('renders activity page for /activity route', () => {
    render(
      <MemoryRouter initialEntries={['/activity']}>
        <App />
      </MemoryRouter>
    );
    
    expect(screen.getByTestId('protected-route')).toBeInTheDocument();
    expect(screen.getByTestId('activity-page')).toBeInTheDocument();
  });

  it('renders alerts page for /alerts route', () => {
    render(
      <MemoryRouter initialEntries={['/alerts']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByTestId('alerts-page')).toBeInTheDocument();
  });

  it('renders dependencies page for /dependencies route', () => {
    render(
      <MemoryRouter initialEntries={['/dependencies']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByTestId('dependencies-page')).toBeInTheDocument();
  });

  it('renders metrics page for /metrics route', () => {
    render(
      <MemoryRouter initialEntries={['/metrics']}>
        <App />
      </MemoryRouter>
    );
    
    expect(screen.getByTestId('protected-route')).toBeInTheDocument();
    expect(screen.getByTestId('metrics-page')).toBeInTheDocument();
  });
});
describe('App shell', () => {
  it('wraps the pages of a signed-in person in the navigation', async () => {
    const auth = await import('@/lib/auth');
    auth.setAuthDisabled(true);
    render(<MemoryRouter initialEntries={['/inbox']}><App /></MemoryRouter>);
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByTestId('inbox-page')).toBeInTheDocument();
    auth.setAuthDisabled(false);
  });

  it('leaves the login and the public status page bare', async () => {
    const auth = await import('@/lib/auth');
    auth.setAuthDisabled(true);
    for (const path of ['/login', '/status']) {
      const { unmount } = render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
      expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
      unmount();
    }
    auth.setAuthDisabled(false);
  });

  it('shows no navigation to someone who is not signed in', () => {
    localStorage.clear();
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });
});
