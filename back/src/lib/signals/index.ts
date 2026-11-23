import type { SignalCollector } from './types';
import { collectStandards } from './standards';
import { collectDependencies } from './dependencies';
import { collectSecurity } from './security';
import { collectRelease } from './release';
import { collectBranches } from './branches';
import { collectCi } from './ci';
import { collectConfig } from './config';
import { collectInbox } from './inbox';
import { collectPolicy } from './policy';
import { collectScorecard } from './scorecard';

export * from './types';

/** Collector registry. Adding a signal type = adding an entry here. */
export const SIGNAL_COLLECTORS = {
  standards: collectStandards,
  dependencies: collectDependencies,
  security: collectSecurity,
  release: collectRelease,
  branches: collectBranches,
  ci: collectCi,
  config: collectConfig,
  inbox: collectInbox,
  policy: collectPolicy,
  scorecard: collectScorecard,
} satisfies Record<string, SignalCollector>;

export type SignalKind = keyof typeof SIGNAL_COLLECTORS;
export const SIGNAL_KINDS = Object.keys(SIGNAL_COLLECTORS) as SignalKind[];

export function isSignalKind(value: string): value is SignalKind {
  return (SIGNAL_KINDS as string[]).includes(value);
}
