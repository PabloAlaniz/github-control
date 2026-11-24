import { createServer, type Server } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn().mockResolvedValue([]), getRepoDetails: vi.fn(), getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));

import { createEmailChannel, emailContent, recipients, validateEmailConfig } from '@back/node/email-channel';
import { CHANNEL_TYPES, deliver, maskConfig, type OutgoingMessage } from '@back/lib/alerts/channels';
import { createServerApp } from '@back/node/server-app';

const message: OutgoingMessage = {
  title: '🔴 CI is failing on acme/api', lines: ['• <first> & second'], url: 'https://github.com/acme/api/actions?a=1&b=2', payload: {},
};
const config = { host: 'smtp.example.com', username: 'alerts@example.com', password: 's3cret-pass', from: 'alerts@example.com', to: 'me@example.com, team@example.com' };

const dirs: string[] = [];
const servers: Server[] = [];
afterAll(() => {
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  servers.forEach((server) => server.close());
});

/** A tiny SMTP server that accepts one message per connection and keeps what it was sent. */
function smtpSink(): Promise<{ port: number; received: string[] }> {
  const received: string[] = [];
  const server = createServer((socket) => {
    let data = '';
    let inBody = false;
    socket.write('220 sink ESMTP\r\n');
    socket.on('data', (chunk) => {
      data += chunk.toString();
      if (inBody) {
        if (!data.includes('\r\n.\r\n')) return;
        received.push(data);
        data = '';
        inBody = false;
        socket.write('250 queued\r\n');
        return;
      }
      for (let end = data.indexOf('\r\n'); end !== -1; end = data.indexOf('\r\n')) {
        const line = data.slice(0, end);
        data = data.slice(end + 2);
        if (/^EHLO/i.test(line)) socket.write('250-sink\r\n250 8BITMIME\r\n');
        else if (/^DATA/i.test(line)) { inBody = true; socket.write('354 go ahead\r\n'); }
        else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  servers.push(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as any).port, received })));
}

describe('email channel', () => {
  it('is registered next to the HTTP channels on Node', () => {
    expect(Object.keys(CHANNEL_TYPES)).toContain('email');
    expect(CHANNEL_TYPES.email.fields.map((field) => field.key)).toEqual(['host', 'port', 'username', 'password', 'from', 'to']);
    expect(maskConfig('email', config)).toEqual({ ...config, password: '••••pass' });
  });

  it('validates the configuration', () => {
    expect(validateEmailConfig(config)).toBeNull();
    expect(validateEmailConfig({ ...config, port: '465' })).toBeNull();
    expect(validateEmailConfig({ ...config, host: ' ' })).toMatch(/host is required/);
    expect(validateEmailConfig({ ...config, port: 'smtp' })).toMatch(/Port must be/);
    expect(validateEmailConfig({ ...config, from: 'Alerts' })).toMatch(/"From" must be/);
    expect(validateEmailConfig({ ...config, to: '' })).toMatch(/At least one recipient/);
    expect(validateEmailConfig({ ...config, to: 'me@example.com, nope' })).toMatch(/Not an email address: nope/);
    expect(validateEmailConfig({ ...config, to: Array.from({ length: 21 }, (_, i) => `a${i}@example.com`).join(',') })).toMatch(/At most 20/);
    expect(validateEmailConfig({ ...config, username: '' })).toMatch(/needs a username/);
    expect(recipients(' a@x.io ,, b@x.io ')).toEqual(['a@x.io', 'b@x.io']);
  });

  it('writes the message as a subject, plain text and escaped HTML', () => {
    expect(emailContent(message)).toEqual({
      subject: '🔴 CI is failing on acme/api',
      text: '🔴 CI is failing on acme/api\n• <first> & second\nhttps://github.com/acme/api/actions?a=1&b=2',
      html: '<p><strong>🔴 CI is failing on acme/api</strong></p>\n<p>• &lt;first&gt; &amp; second</p>\n'
        + '<p><a href="https://github.com/acme/api/actions?a=1&amp;b=2">https://github.com/acme/api/actions?a=1&amp;b=2</a></p>',
    });
    expect(emailContent({ ...message, title: 'a\r\nBcc: x@y.z', lines: [], url: null }).subject).toBe('a Bcc: x@y.z');
  });

  it('hands the message to the SMTP transport with the right connection settings', async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    const createTransport = vi.fn().mockReturnValue({ sendMail });
    const channel = createEmailChannel(createTransport);

    await channel.send(config, message);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com', port: 587, secure: false, auth: { user: 'alerts@example.com', pass: 's3cret-pass' },
    }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'GitHub Control <alerts@example.com>', to: ['me@example.com', 'team@example.com'], subject: message.title,
    }));

    await channel.send({ host: 'mail.internal', port: '465', from: 'a@b.co', to: 'c@d.co' }, message);
    const options = createTransport.mock.calls[1][0];
    expect(options).toMatchObject({ port: 465, secure: true });
    expect(options.auth).toBeUndefined();
  });

  it('delivers a real message over SMTP', async () => {
    const sink = await smtpSink();
    const error = await deliver('email', { host: '127.0.0.1', port: String(sink.port), from: 'alerts@example.com', to: 'me@example.com' }, message);

    expect(error).toBeNull();
    expect(sink.received).toHaveLength(1);
    expect(sink.received[0]).toContain('From: GitHub Control <alerts@example.com>');
    expect(sink.received[0]).toContain('To: me@example.com');
    expect(sink.received[0]).toMatch(/Subject: =\?UTF-8\?/);   // the emoji is encoded, not dropped
  });

  it('reports why a message could not be sent, without sending when the configuration is unusable', async () => {
    const refused = await deliver('email', { host: '127.0.0.1', port: '1', from: 'a@b.co', to: 'c@d.co' }, message);
    expect(refused).toMatch(/^Could not send: /);
    expect(await deliver('email', { ...config, to: 'nope' }, message)).toBe('Not an email address: nope');
  });

  it('can be set up and tested through the API', async () => {
    const sink = await smtpSink();
    const dataDir = mkdtempSync(join(tmpdir(), 'ghc-email-'));
    dirs.push(dataDir);
    const app = createServerApp({ env: { GITHUB_TOKEN: 'x', DISABLE_AUTH: 'true', STORAGE_DRIVER: 'json' }, dataDir, log: () => undefined });
    const send = (method: string, path: string, body?: unknown) => app.request(path, {
      method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });

    const listed = await (await send('GET', '/api/alerts/channels')).json() as any;
    expect(listed.types.map((type: any) => type.type)).toContain('email');

    const created = await send('POST', '/api/alerts/channels', {
      name: 'Mail', type: 'email',
      config: { host: '127.0.0.1', port: String(sink.port), username: 'u', password: 'hunter22', from: 'alerts@example.com', to: 'me@example.com' },
    });
    expect(created.status).toBe(201);
    const { channel } = await created.json() as any;
    expect(channel.config).toMatchObject({ host: '127.0.0.1', password: '••••er22', to: 'me@example.com' });

    expect((await send('POST', '/api/alerts/channels', { name: 'Bad', type: 'email', config: { host: 'x', from: 'nope', to: 'a@b.co' } })).status).toBe(400);

    expect(await (await send('POST', `/api/alerts/channels/${channel.id}/test`)).json()).toEqual({ ok: true, error: null });
    expect(sink.received[0]).toContain('test message');
  });
});
