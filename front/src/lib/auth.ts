const TOKEN_KEY = 'auth_token';
const API_BASE = import.meta.env.VITE_API_URL || '';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Set from the server's status when it runs with sign-in turned off. */
let authDisabledByServer = false;

export function setAuthDisabled(disabled: boolean): void {
  authDisabledByServer = disabled;
}

export function isAuthenticated(): boolean {
  // Bypass authentication when the build or the server has it disabled
  if (import.meta.env.VITE_DISABLE_AUTH === 'true' || authDisabledByServer) {
    return true;
  }

  const token = getToken();
  if (!token) return false;

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Login failed');
  }

  const { token } = await res.json();
  setToken(token);
}

export function logout(): void {
  removeToken();
}
