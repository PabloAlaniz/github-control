import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ctxFor } from '../helpers';

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
vi.mock('@back/infrastructure/storage/sql/neon', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  getDb: vi.fn(),
}));

const mockGetRepoReadme = vi.fn();
vi.mock('@back/lib/github', () => ({
  getRepoReadme: (...args: any[]) => mockGetRepoReadme(...args),
}));

const mockMessagesCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () { return {
    messages: { create: (...args: any[]) => mockMessagesCreate(...args) },
  }; }),
}));

import { generateSummary, fetchReadme } from '@back/services/readme.service';

const env = {
  DATABASE_URL: 'x',
  GITHUB_TOKEN: 'x',
  API_KEY: 'x',
  ENVIRONMENT: 'test',
  AUTH_USERNAME: 'a',
  AUTH_PASSWORD: 'p',
  JWT_SECRET: 's',
  ANTHROPIC_API_KEY: 'sk-test',
} as any;

function makeAnthropicResponse(payload: object, usage = { input_tokens: 1200, output_tokens: 220, cache_read_input_tokens: 800 }) {
  return {
    model: 'claude-opus-4-7',
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    usage,
  };
}

describe('generateSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the cached summary when present and force=false', async () => {
    const stored = {
      title: 'Cached', description: 'Old', keyFeatures: [], primaryUseCase: 'x', audience: 'y',
      source: 'ai', generated_at: '2026-05-01T00:00:00Z',
    };
    mockQueryOne.mockResolvedValueOnce({ summary: stored });

    const result = await generateSummary(ctxFor(env), 'o', 'r');
    expect(result).toEqual(stored);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('throws if ANTHROPIC_API_KEY is missing', async () => {
    await expect(generateSummary(ctxFor({ ...env, ANTHROPIC_API_KEY: undefined }), 'o', 'r'))
      .rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('returns null when there is no README cached', async () => {
    mockQueryOne.mockResolvedValueOnce(null);       // no existing summary
    mockQueryOne.mockResolvedValueOnce(null);       // getReadmeContent → null
    const result = await generateSummary(ctxFor(env), 'o', 'r');
    expect(result).toBeNull();
  });

  it('calls Anthropic, parses JSON, persists, and returns the summary', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    mockQueryOne.mockResolvedValueOnce({ readme_content: '# Test\nA cool repo' });
    const payload = {
      title: 'Test Repo',
      description: 'A demonstration repository.',
      keyFeatures: ['fast', 'simple', 'minimal'],
      primaryUseCase: 'learning Claude SDK',
      audience: 'developers',
    };
    mockMessagesCreate.mockResolvedValueOnce(makeAnthropicResponse(payload));
    mockQuery.mockResolvedValueOnce(undefined);  // persistSummary UPDATE

    const result = await generateSummary(ctxFor(env), 'o', 'r');
    expect(result?.title).toBe('Test Repo');
    expect(result?.source).toBe('ai');
    expect(result?.model).toBe('claude-opus-4-7');
    expect(result?.tokens_in).toBe(1200);
    expect(result?.tokens_out).toBe(220);
    expect(result?.cache_read_input_tokens).toBe(800);

    // Verify cache_control set on system prompt
    const callArgs = mockMessagesCreate.mock.calls[0][0];
    expect(callArgs.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(callArgs.model).toBe('claude-opus-4-7');
    expect(callArgs.output_config.format.type).toBe('json_schema');
  });

  it('force=true bypasses stored summary', async () => {
    mockQueryOne.mockResolvedValueOnce({ readme_content: '# Test' });
    const payload = {
      title: 'X', description: 'Y', keyFeatures: ['a'], primaryUseCase: 'z', audience: 'w',
    };
    mockMessagesCreate.mockResolvedValueOnce(makeAnthropicResponse(payload));
    mockQuery.mockResolvedValueOnce(undefined);

    const result = await generateSummary(ctxFor(env), 'o', 'r', { force: true });
    expect(result?.title).toBe('X');
    // queryOne should have been called once (for readme), not for cached summary check
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
  });

  it('throws when the model returns non-JSON text', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    mockQueryOne.mockResolvedValueOnce({ readme_content: '# Test' });
    mockMessagesCreate.mockResolvedValueOnce({
      model: 'claude-opus-4-7',
      content: [{ type: 'text', text: 'not json' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
    });

    await expect(generateSummary(ctxFor(env), 'o', 'r')).rejects.toThrow(/parse summary JSON/);
  });

  it('throws when response has no text block', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    mockQueryOne.mockResolvedValueOnce({ readme_content: '# Test' });
    mockMessagesCreate.mockResolvedValueOnce({
      model: 'claude-opus-4-7',
      content: [{ type: 'thinking', thinking: '...' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
    });

    await expect(generateSummary(ctxFor(env), 'o', 'r')).rejects.toThrow(/No text block/);
  });
});

describe('fetchReadme', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns cached content when present', async () => {
    mockQueryOne.mockResolvedValueOnce({ readme_content: '# Hello' });
    const result = await fetchReadme(ctxFor(env), 'o', 'r');
    expect(result).toEqual({ content: '# Hello', source: 'cache' });
  });

  it('fetches from GitHub and caches when no cached content', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    mockGetRepoReadme.mockResolvedValueOnce({ content: '# Live\nfresh' });
    mockQuery.mockResolvedValueOnce(undefined);
    const result = await fetchReadme(ctxFor(env), 'o', 'r');
    expect(result?.source).toBe('github');
    expect(result?.content).toContain('Live');
  });

  it('returns null when neither cache nor GitHub has the README', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    mockGetRepoReadme.mockResolvedValueOnce(null);
    const result = await fetchReadme(ctxFor(env), 'o', 'r');
    expect(result).toBeNull();
  });
});
