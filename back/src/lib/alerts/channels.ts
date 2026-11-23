/**
 * Alert channels: where a message can be sent and how. Every channel type is
 * one HTTP request, so it works on Node and on Cloudflare Workers alike.
 *
 * Adding a type = adding an entry to CHANNEL_TYPES.
 */
export interface OutgoingMessage {
  /** One line: what happened. */
  title: string;
  /** Extra lines (may be empty). */
  lines: string[];
  /** Where to look. */
  url: string | null;
  /** Machine-readable copy, sent as is by the generic webhook. */
  payload: Record<string, unknown>;
}

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface ChannelField {
  key: string;
  label: string;
  placeholder: string;
  /** Shown masked and never sent back to the browser. */
  secret: boolean;
  optional?: boolean;
}

export interface ChannelType {
  label: string;
  fields: ChannelField[];
  /** Null when the configuration is usable, otherwise what is wrong with it. */
  validate(config: Record<string, string>): string | null;
  request(config: Record<string, string>, message: OutgoingMessage): HttpRequest;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function httpsUrl(value: string | undefined, what: string): string | null {
  if (!value) return `${what} is required`;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? null : `${what} must be an http(s) URL`;
  } catch {
    return `${what} is not a valid URL`;
  }
}

const plainText = (message: OutgoingMessage) =>
  [message.title, ...message.lines, message.url].filter(Boolean).join('\n');

export const CHANNEL_TYPES: Record<string, ChannelType> = {
  webhook: {
    label: 'Webhook (JSON)',
    fields: [{ key: 'url', label: 'URL', placeholder: 'https://example.com/hooks/github-control', secret: true }],
    validate: (config) => httpsUrl(config.url, 'URL'),
    request: (config, message) => ({
      url: config.url, headers: JSON_HEADERS,
      body: JSON.stringify({ ...message.payload, text: plainText(message) }),
    }),
  },
  slack: {
    label: 'Slack',
    fields: [{ key: 'url', label: 'Incoming webhook URL', placeholder: 'https://hooks.slack.com/services/...', secret: true }],
    validate: (config) => httpsUrl(config.url, 'Webhook URL'),
    request: (config, message) => ({
      url: config.url, headers: JSON_HEADERS, body: JSON.stringify({ text: plainText(message) }),
    }),
  },
  discord: {
    label: 'Discord',
    fields: [{ key: 'url', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/...', secret: true }],
    validate: (config) => httpsUrl(config.url, 'Webhook URL'),
    request: (config, message) => ({
      // Discord rejects messages over 2000 characters.
      url: config.url, headers: JSON_HEADERS, body: JSON.stringify({ content: plainText(message).slice(0, 1900) }),
    }),
  },
  telegram: {
    label: 'Telegram',
    fields: [
      { key: 'botToken', label: 'Bot token', placeholder: '123456:ABC-DEF...', secret: true },
      { key: 'chatId', label: 'Chat ID', placeholder: '-1001234567890', secret: false },
    ],
    validate: (config) => {
      if (!/^\d+:[\w-]+$/.test(config.botToken ?? '')) return 'Bot token does not look like a Telegram bot token';
      return config.chatId ? null : 'Chat ID is required';
    },
    request: (config, message) => ({
      url: `https://api.telegram.org/bot${config.botToken}/sendMessage`,
      headers: JSON_HEADERS,
      body: JSON.stringify({ chat_id: config.chatId, text: plainText(message).slice(0, 4000), disable_web_page_preview: true }),
    }),
  },
  ntfy: {
    label: 'ntfy',
    fields: [
      { key: 'url', label: 'Topic URL', placeholder: 'https://ntfy.sh/my-topic', secret: true },
      { key: 'token', label: 'Access token', placeholder: 'tk_...', secret: true, optional: true },
    ],
    validate: (config) => httpsUrl(config.url, 'Topic URL'),
    request: (config, message) => ({
      url: config.url,
      headers: {
        // Header values must be ASCII.
        Title: message.title.replace(/[^\x20-\x7e]/g, '?').slice(0, 200),
        ...(message.url && { Click: message.url }),
        ...(config.token && { Authorization: `Bearer ${config.token}` }),
      },
      body: [...message.lines, message.url].filter(Boolean).join('\n') || message.title,
    }),
  },
};

export function isChannelType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(CHANNEL_TYPES, type);
}

/** The configuration as it may be shown: secrets replaced by their last characters. */
export function maskConfig(type: string, config: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const field of CHANNEL_TYPES[type]?.fields ?? []) {
    const value = config[field.key];
    if (!value) continue;
    masked[field.key] = field.secret ? `••••${value.slice(-4)}` : value;
  }
  return masked;
}

/**
 * Merges what a form sent into the stored configuration: a secret field left
 * empty keeps its stored value, so editing a channel does not need the secret again.
 */
export function mergeConfig(
  type: string, stored: Record<string, string>, incoming: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const field of CHANNEL_TYPES[type]?.fields ?? []) {
    const value = incoming[field.key]?.trim();
    const kept = field.secret && !value ? stored[field.key] : value;
    if (kept) merged[field.key] = kept;
  }
  return merged;
}

const TIMEOUT_MS = 10_000;

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Sends the message. Returns null when the destination accepted it, otherwise why not. */
export async function deliver(
  type: string, config: Record<string, string>, message: OutgoingMessage, fetcher: Fetcher = fetch,
): Promise<string | null> {
  const channelType = CHANNEL_TYPES[type];
  if (!channelType) return `Unknown channel type "${type}"`;
  const invalid = channelType.validate(config);
  if (invalid) return invalid;

  const { url, headers, body } = channelType.request(config, message);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(url, { method: 'POST', headers, body, signal: controller.signal });
    return response.ok ? null : `The destination answered HTTP ${response.status}`;
  } catch (error: any) {
    // Never echo the URL: it is the secret.
    return error?.name === 'AbortError' ? 'The destination did not answer in time' : 'Could not reach the destination';
  } finally {
    clearTimeout(timeout);
  }
}
