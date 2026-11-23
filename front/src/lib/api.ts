import { getToken, removeToken } from './auth';
import { getDemo, notifyDemoBlocked } from './demo';

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
    // A demo instance refuses whatever needs GitHub; the banner explains why.
    if (res.status === 403 && getDemo()) notifyDemoBlocked();
    return res;
  });
}
