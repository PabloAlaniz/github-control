import { getToken, removeToken } from './auth';

const API_BASE = import.meta.env.VITE_API_URL || '';
const API_KEY = import.meta.env.VITE_API_KEY || '';

export function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);

  const jwt = getToken();
  if (jwt) {
    headers.set('Authorization', `Bearer ${jwt}`);
  } else if (API_KEY) {
    headers.set('Authorization', `Bearer ${API_KEY}`);
  }

  return fetch(`${API_BASE}${path}`, { ...options, headers }).then((res) => {
    if (res.status === 401 && jwt) {
      removeToken();
    }
    return res;
  });
}
