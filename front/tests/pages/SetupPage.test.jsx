import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SetupPage } from '@/pages/SetupPage';

const mockFetchStatus = vi.fn();
const mockSubmit = vi.fn();
const mockLogin = vi.fn();

vi.mock('@/lib/setup', () => ({
  fetchSetupStatus: (...args) => mockFetchStatus(...args),
  submitSetup: (...args) => mockSubmit(...args),
}));
vi.mock('@/lib/auth', () => ({
  login: (...args) => mockLogin(...args),
}));

const STORAGE_OPTIONS = [
  { id: 'json', label: 'JSON files', description: 'Readable files' },
  { id: 'csv', label: 'CSV files', description: 'Spreadsheet friendly' },
];
const unconfigured = (needs = { storage: true, github: true, admin: true }) => ({
  configured: false, needs, storageOptions: STORAGE_OPTIONS,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/setup']}>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/" element={<div>home page</div>} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillEverything(user) {
  await user.type(await screen.findByLabelText('Setup code'), ' code-123 ');
  await user.click(screen.getByLabelText(/CSV files/));
  await user.type(screen.getByLabelText('Personal access token'), 'ghp_token');
  await user.type(screen.getByLabelText('Organizations (optional)'), 'org-a, org-b,');
  await user.type(screen.getByLabelText('Username'), 'admin');
  await user.type(screen.getByLabelText('Password'), 'correct horse');
  await user.type(screen.getByLabelText('Confirm password'), 'correct horse');
}

describe('SetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmit.mockResolvedValue({ githubLogin: 'octocat' });
    mockLogin.mockResolvedValue(undefined);
  });

  it('sends the answers, signs in and opens the app', async () => {
    mockFetchStatus.mockResolvedValue(unconfigured());
    const user = userEvent.setup();
    renderPage();
    await fillEverything(user);
    await user.click(screen.getByRole('button', { name: 'Finish setup' }));

    await screen.findByText('home page');
    expect(mockSubmit).toHaveBeenCalledWith({
      setupCode: 'code-123',
      storage: { driver: 'csv' },
      github: { token: 'ghp_token', orgs: ['org-a', 'org-b'] },
      admin: { username: 'admin', password: 'correct horse' },
    });
    expect(mockLogin).toHaveBeenCalledWith('admin', 'correct horse');
  });

  it('asks only for what the server still needs', async () => {
    mockFetchStatus.mockResolvedValue(unconfigured({ storage: false, github: false, admin: true }));
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText('Setup code');
    expect(screen.queryByLabelText('Personal access token')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/JSON files/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Setup code'), 'code');
    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'correct horse');
    await user.type(screen.getByLabelText('Confirm password'), 'correct horse');
    await user.click(screen.getByRole('button', { name: 'Finish setup' }));

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledWith({
      setupCode: 'code', admin: { username: 'admin', password: 'correct horse' },
    }));
  });

  it('goes to the login page when no account had to be created', async () => {
    mockFetchStatus.mockResolvedValue(unconfigured({ storage: true, github: false, admin: false }));
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText('Setup code'), 'code');
    await user.click(screen.getByRole('button', { name: 'Finish setup' }));

    await screen.findByText('login page');
    expect(mockSubmit).toHaveBeenCalledWith({ setupCode: 'code', storage: { driver: 'json' } });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('does not submit when the passwords differ', async () => {
    mockFetchStatus.mockResolvedValue(unconfigured());
    const user = userEvent.setup();
    renderPage();
    await fillEverything(user);
    await user.type(screen.getByLabelText('Confirm password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Finish setup' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match');
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('shows the server error and stays on the wizard', async () => {
    mockFetchStatus.mockResolvedValue(unconfigured());
    mockSubmit.mockRejectedValue(new Error('Invalid setup code. Check the server log for the current code.'));
    const user = userEvent.setup();
    renderPage();
    await fillEverything(user);
    await user.click(screen.getByRole('button', { name: 'Finish setup' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid setup code');
    expect(screen.getByRole('button', { name: 'Finish setup' })).toBeEnabled();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('leaves immediately when the server is already configured', async () => {
    mockFetchStatus.mockResolvedValue({ configured: true });
    renderPage();
    await screen.findByText('home page');
  });
});
