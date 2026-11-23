/**
 * POLICY_FILE: a policy kept as a file (in a repo, mounted into the
 * container). The file is the source of truth: it is read at startup and again
 * whenever it changes, and the policy cannot be edited from the app.
 */
import { readFileSync, watchFile } from 'node:fs';
import type { AppConfig } from '../config';
import { parsePolicyDocument } from '../domain/policy';

const POLL_MS = 5000;

/** Returns the file's text when it is a valid policy; otherwise logs why and returns null. */
export function readPolicyFile(path: string, log: (message: string) => void): string | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error: any) {
    log(`Policy file ${path} could not be read: ${error.message}`);
    return null;
  }
  const { errors } = parsePolicyDocument(text);
  if (errors.length > 0) {
    log(`Policy file ${path} is not valid and was ignored: ${errors.join('; ')}`);
    return null;
  }
  return text;
}

/** Loads the file into `config` and keeps it in step. A broken edit keeps the last good policy. */
export function followPolicyFile(path: string, config: AppConfig, log: (message: string) => void): void {
  config.POLICY_SOURCE = 'file';
  const load = (reason: string) => {
    const text = readPolicyFile(path, log);
    if (text === null || text === config.POLICY) return;
    config.POLICY = text;
    log(`Policy ${reason} from ${path}.`);
  };
  load('loaded');
  watchFile(path, { interval: POLL_MS, persistent: false }, () => load('reloaded'));
}
