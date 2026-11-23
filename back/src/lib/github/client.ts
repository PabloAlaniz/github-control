import { Octokit } from '@octokit/rest';
import type { AppConfig } from '../../config';

/**
 * Create and return an authenticated Octokit client
 * @param env - Cloudflare Worker environment containing GITHUB_TOKEN
 * @returns Configured Octokit instance ready for GitHub API calls
 */
export function getOctokit(env: AppConfig) {
  return new Octokit({ auth: env.GITHUB_TOKEN });
}
