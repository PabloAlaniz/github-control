import type { AppContext } from '../application/context';
import { getRepoReadme } from '../lib/github';
import Anthropic from '@anthropic-ai/sdk';

/** Fetch README: return from cache if available, otherwise fetch from GitHub and cache. */
export async function fetchReadme(ctx: AppContext, owner: string, repo: string) {
  const fullName = `${owner}/${repo}`;

  const cached = await ctx.storage.health.getReadmeContent(fullName);
  if (cached?.readme_content) {
    return { content: cached.readme_content, source: 'cache' as const };
  }

  const readme = await getRepoReadme(ctx.config, owner, repo);
  if (!readme) return null;

  const lines = readme.content.split('\n').length;
  await ctx.storage.health.cacheReadme(fullName, readme.content, lines);
  return { content: readme.content, source: 'github' as const };
}

const SUMMARY_MODEL = 'claude-opus-4-7';
const SUMMARY_MAX_TOKENS = 1024;
const README_TRUNCATE_CHARS = 40_000;

const SUMMARY_SYSTEM = `You analyze GitHub repository READMEs and produce a concise, structured summary.

Output rules:
- title: a short title for the repo (≤6 words)
- description: one sentence (≤200 chars) explaining what it does
- keyFeatures: 3-6 bullet phrases (each ≤80 chars), most distinctive first
- primaryUseCase: one sentence describing the main user/task it serves
- audience: who this is for (e.g. "Node.js backend devs", "data scientists")

Be specific. Avoid marketing fluff. If the README is sparse, infer from filenames and structure mentions.`;

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    keyFeatures: { type: 'array', items: { type: 'string' } },
    primaryUseCase: { type: 'string' },
    audience: { type: 'string' },
  },
  required: ['title', 'description', 'keyFeatures', 'primaryUseCase', 'audience'],
  additionalProperties: false,
};

export interface AiSummary {
  title: string;
  description: string;
  keyFeatures: string[];
  primaryUseCase: string;
  audience: string;
  source: 'ai';
  model: string;
  generated_at: string;
  tokens_in: number;
  tokens_out: number;
  cache_read_input_tokens?: number;
}

/**
 * Generate a structured summary of a repo's README using the Anthropic SDK.
 * Uses prompt caching on the system prompt (1h TTL) so repeated calls amortize.
 * If a summary already exists in DB and `force` is false, returns the cached version.
 */
export async function generateSummary(
  ctx: AppContext,
  owner: string,
  repo: string,
  options: { force?: boolean } = {},
): Promise<AiSummary | null> {
  const fullName = `${owner}/${repo}`;
  const { force = false } = options;

  if (!ctx.config.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  // Reuse stored summary unless forced
  if (!force) {
    const row = await ctx.storage.health.getSummary(fullName);
    if (row?.summary?.source === 'ai' && row.summary.generated_at) {
      return row.summary as AiSummary;
    }
  }

  const readmeRow = await ctx.storage.health.getReadmeContent(fullName);
  if (!readmeRow?.readme_content) return null;

  const readmeText = readmeRow.readme_content.slice(0, README_TRUNCATE_CHARS);

  const client = new Anthropic({ apiKey: ctx.config.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: SUMMARY_MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: SUMMARY_SYSTEM,
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
    ],
    output_config: {
      format: { type: 'json_schema', schema: SUMMARY_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `Repo: ${fullName}\n\nREADME:\n\n${readmeText}`,
      },
    ],
  });

  // Find the text block carrying the JSON payload
  const textBlock = response.content.find(b => b.type === 'text') as
    | { type: 'text'; text: string }
    | undefined;
  if (!textBlock) {
    throw new Error('No text block in summary response');
  }

  let parsed: Omit<AiSummary, 'source' | 'model' | 'generated_at' | 'tokens_in' | 'tokens_out' | 'cache_read_input_tokens'>;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (err: any) {
    throw new Error(`Failed to parse summary JSON: ${err.message}`);
  }

  const summary: AiSummary = {
    ...parsed,
    source: 'ai',
    model: response.model,
    generated_at: new Date().toISOString(),
    tokens_in: response.usage.input_tokens,
    tokens_out: response.usage.output_tokens,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
  };

  await ctx.storage.health.saveAiSummary(fullName, { ...summary });
  return summary;
}
