const API_BASE = import.meta.env.VITE_API_URL || '';

export interface SetupStatus {
  configured: boolean;
  /** False when the server runs with sign-in turned off. */
  authRequired?: boolean;
  /** Present when the server is a demo instance with fictional data. */
  demo?: { readOnly: boolean; resetMinutes: number };
  /** Which sections the wizard has to ask for (absent once configured). */
  needs?: { storage: boolean; github: boolean; admin: boolean };
  storageOptions?: { id: string; label: string; description: string }[];
}

export interface SetupAnswers {
  setupCode: string;
  storage?: { driver: string };
  github?: { token: string; orgs: string[] };
  admin?: { username: string; password: string };
}

/**
 * Asks the server whether it still needs first-run setup. Any failure counts
 * as "configured": the wizard must never get in the way of a working app.
 */
export async function fetchSetupStatus(): Promise<SetupStatus> {
  try {
    const res = await fetch(`${API_BASE}/api/setup/status`);
    if (!res.ok) return { configured: true, authRequired: true };
    const status = await res.json();
    if (status?.configured === false) return status;
    return { configured: true, authRequired: status?.authRequired !== false, demo: status?.demo };
  } catch {
    return { configured: true, authRequired: true };
  }
}

export async function submitSetup(answers: SetupAnswers): Promise<{ githubLogin: string | null }> {
  const res = await fetch(`${API_BASE}/api/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(answers),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fieldErrors = Object.values(body.details?.fieldErrors ?? {}).flat();
    throw new Error([body.error, ...fieldErrors].filter(Boolean).join(': ') || 'Setup failed');
  }
  return body;
}
