/**
 * GitHub webhooks: checking that a delivery really comes from GitHub, and
 * deciding what a delivery means for the dashboard. No storage or HTTP here.
 */
import { constantTimeEqual } from '../password';

const encoder = new TextEncoder();
const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** True when `signature` (the X-Hub-Signature-256 header) is the HMAC of `body` under `secret`. */
export async function verifySignature(secret: string, body: string, signature: string | undefined): Promise<boolean> {
  if (!secret || !signature?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = `sha256=${toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(body)))}`;
  return constantTimeEqual(expected, signature);
}

/** The events worth subscribing the webhook to; anything else is acknowledged and ignored. */
export const WEBHOOK_EVENTS = [
  'workflow_run', 'pull_request', 'pull_request_review', 'issues', 'check_suite', 'release',
  'dependabot_alert', 'code_scanning_alert', 'secret_scanning_alert', 'repository', 'branch_protection_rule',
] as const;

export interface WebhookPlan {
  repo: string;
  /** The CI status the delivery reports for the default branch. */
  ci?: { ci_status: string; ci_status_url: string | null; ci_status_run_at: string | null };
  /** Signals to read again from GitHub. */
  signals: string[];
}

/**
 * What to do about a delivery: which repo it is about, the CI status it
 * carries, and which signals it makes stale. Null when there is nothing to do.
 */
export function planWebhook(event: string, payload: any): WebhookPlan | null {
  const repo = payload?.repository?.full_name;
  if (typeof repo !== 'string' || !repo.includes('/')) return null;
  const plan: WebhookPlan = { repo, signals: [] };
  const action = payload.action;

  switch (event) {
    case 'workflow_run': {
      const run = payload.workflow_run;
      // The dashboard's CI status is the default branch's; runs on other branches say nothing about it.
      if (!run || run.head_branch !== payload.repository.default_branch) return null;
      plan.ci = {
        ci_status: run.status === 'completed' ? run.conclusion ?? 'neutral' : run.status ?? 'unknown',
        ci_status_url: run.html_url ?? null,
        ci_status_run_at: run.run_started_at ?? run.created_at ?? null,
      };
      if (run.status === 'completed') plan.signals.push('ci');
      return plan;
    }
    case 'pull_request':
      plan.signals.push('inbox');
      // A merged pull request leaves a branch behind (or not).
      if (action === 'closed') plan.signals.push('branches');
      return plan;
    case 'pull_request_review':
    case 'issues':
      plan.signals.push('inbox');
      return plan;
    case 'check_suite':
      // Only suites of open pull requests change what the inbox shows.
      if (action !== 'completed' || !(payload.check_suite?.pull_requests?.length > 0)) return null;
      plan.signals.push('inbox');
      return plan;
    case 'release':
      plan.signals.push('release');
      return plan;
    case 'dependabot_alert':
    case 'code_scanning_alert':
    case 'secret_scanning_alert':
      plan.signals.push('security');
      return plan;
    case 'repository':
    case 'branch_protection_rule':
      plan.signals.push('standards', 'config');
      return plan;
    default:
      return null;
  }
}
