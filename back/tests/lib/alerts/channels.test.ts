import { describe, expect, it, vi } from 'vitest';
import { CHANNEL_TYPES, deliver, isChannelType, maskConfig, mergeConfig, type OutgoingMessage } from '@back/lib/alerts/channels';

const message: OutgoingMessage = {
  title: '🔴 CI is failing on acme/api',
  lines: ['• first', '• second'],
  url: 'https://github.com/acme/api/actions',
  payload: { source: 'github-control', event: 'opened', kind: 'ci_failing' },
};
const text = '🔴 CI is failing on acme/api\n• first\n• second\nhttps://github.com/acme/api/actions';

describe('channel types', () => {
  it('knows its types', () => {
    expect(Object.keys(CHANNEL_TYPES)).toEqual(['webhook', 'slack', 'discord', 'telegram', 'ntfy']);
    expect(isChannelType('slack')).toBe(true);
    expect(isChannelType('toString')).toBe(false);
  });

  it('webhook posts the payload plus a readable text', () => {
    const request = CHANNEL_TYPES.webhook.request({ url: 'https://example.com/hook' }, message);
    expect(request.url).toBe('https://example.com/hook');
    expect(request.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(request.body)).toEqual({ source: 'github-control', event: 'opened', kind: 'ci_failing', text });
  });

  it('slack and discord post the text in their own field', () => {
    expect(JSON.parse(CHANNEL_TYPES.slack.request({ url: 'https://hooks.slack.com/x' }, message).body)).toEqual({ text });
    expect(JSON.parse(CHANNEL_TYPES.discord.request({ url: 'https://discord.com/api/webhooks/x' }, message).body)).toEqual({ content: text });
  });

  it('discord messages stay under its length limit', () => {
    const long = { ...message, lines: ['x'.repeat(5000)] };
    expect(JSON.parse(CHANNEL_TYPES.discord.request({ url: 'https://discord.com/x' }, long).body).content.length).toBeLessThanOrEqual(2000);
  });

  it('telegram calls the bot API with the chat', () => {
    const request = CHANNEL_TYPES.telegram.request({ botToken: '123:abc', chatId: '-100' }, message);
    expect(request.url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    expect(JSON.parse(request.body)).toMatchObject({ chat_id: '-100', text });
  });

  it('ntfy sends the title as an ASCII header and the rest as the body', () => {
    const request = CHANNEL_TYPES.ntfy.request({ url: 'https://ntfy.sh/topic', token: 'tk_1' }, message);
    expect(request.url).toBe('https://ntfy.sh/topic');
    expect(request.headers).toEqual({
      Title: '?? CI is failing on acme/api', Click: 'https://github.com/acme/api/actions', Authorization: 'Bearer tk_1',
    });
    expect(request.body).toBe('• first\n• second\nhttps://github.com/acme/api/actions');

    const bare = CHANNEL_TYPES.ntfy.request({ url: 'https://ntfy.sh/topic' }, { ...message, lines: [], url: null });
    expect(bare.headers).toEqual({ Title: '?? CI is failing on acme/api' });
    expect(bare.body).toBe(message.title);
  });

  it('validates the configuration of each type', () => {
    expect(CHANNEL_TYPES.slack.validate({ url: 'https://hooks.slack.com/x' })).toBeNull();
    expect(CHANNEL_TYPES.slack.validate({})).toMatch(/required/);
    expect(CHANNEL_TYPES.webhook.validate({ url: 'not a url' })).toMatch(/not a valid URL/);
    expect(CHANNEL_TYPES.webhook.validate({ url: 'file:///etc/passwd' })).toMatch(/http\(s\)/);
    expect(CHANNEL_TYPES.telegram.validate({ botToken: '123:abc', chatId: '1' })).toBeNull();
    expect(CHANNEL_TYPES.telegram.validate({ botToken: 'nope', chatId: '1' })).toMatch(/Bot token/);
    expect(CHANNEL_TYPES.telegram.validate({ botToken: '123:abc' })).toMatch(/Chat ID/);
  });
});

describe('channel secrets', () => {
  it('masks secrets and shows the rest', () => {
    expect(maskConfig('telegram', { botToken: '123456:ABCDEF', chatId: '-100', extra: 'x' }))
      .toEqual({ botToken: '••••CDEF', chatId: '-100' });
    expect(maskConfig('slack', {})).toEqual({});
    expect(maskConfig('unknown', { url: 'x' })).toEqual({});
  });

  it('keeps a stored secret when the form leaves it empty', () => {
    const stored = { botToken: '123:old', chatId: '-100' };
    expect(mergeConfig('telegram', stored, { botToken: '', chatId: '-200' })).toEqual({ botToken: '123:old', chatId: '-200' });
    expect(mergeConfig('telegram', stored, { botToken: ' 456:new ', chatId: '-100' })).toEqual({ botToken: '456:new', chatId: '-100' });
    // A non-secret field left empty is cleared, and unknown fields are dropped.
    expect(mergeConfig('telegram', stored, { other: 'x' })).toEqual({ botToken: '123:old' });
  });
});

describe('deliver', () => {
  it('posts the request and reports success', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('ok'));
    expect(await deliver('slack', { url: 'https://hooks.slack.com/x' }, message, fetcher)).toBeNull();
    expect(fetcher).toHaveBeenCalledWith('https://hooks.slack.com/x', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ text }),
    }));
  });

  it('reports a refusal, a network failure and a timeout without leaking the URL', async () => {
    const config = { url: 'https://hooks.slack.com/secret-path' };
    const refused = await deliver('slack', config, message, vi.fn().mockResolvedValue(new Response('no', { status: 404 })));
    const unreachable = await deliver('slack', config, message, vi.fn().mockRejectedValue(new Error('getaddrinfo hooks.slack.com/secret-path')));
    const timedOut = await deliver('slack', config, message, vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })));

    expect(refused).toBe('The destination answered HTTP 404');
    expect(unreachable).toBe('Could not reach the destination');
    expect(timedOut).toBe('The destination did not answer in time');
  });

  it('does not send with an unknown type or an unusable configuration', async () => {
    const fetcher = vi.fn();
    expect(await deliver('pager', {}, message, fetcher)).toMatch(/Unknown channel type/);
    expect(await deliver('slack', {}, message, fetcher)).toMatch(/required/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
