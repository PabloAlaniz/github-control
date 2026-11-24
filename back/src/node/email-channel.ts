/**
 * Email as an alert channel, over SMTP. Node only (it needs a socket), so it
 * is registered from here instead of living with the HTTP channel types.
 */
import nodemailer from 'nodemailer';
import { registerChannelType, type OutgoingMessage } from '../lib/alerts/channels';

const EMAIL = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;
const TIMEOUT_MS = 10_000;

export const recipients = (to: string | undefined) => (to ?? '').split(',').map((address) => address.trim()).filter(Boolean);

/** Port from the form, or the submission port. 465 is the one that starts in TLS. */
function portOf(config: Record<string, string>): number {
  return Number(config.port?.trim() || 587);
}

export function validateEmailConfig(config: Record<string, string>): string | null {
  if (!config.host?.trim()) return 'SMTP host is required';
  const port = portOf(config);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Port must be a number between 1 and 65535';
  if (!EMAIL.test(config.from?.trim() ?? '')) return '"From" must be an email address';
  const to = recipients(config.to);
  if (to.length === 0) return 'At least one recipient is required';
  const bad = to.find((address) => !EMAIL.test(address));
  if (bad) return `Not an email address: ${bad}`;
  if (to.length > 20) return 'At most 20 recipients';
  if (config.password && !config.username) return 'A password needs a username';
  return null;
}

/** The message as an email: subject, plain text, and the same as minimal HTML. */
export function emailContent(message: OutgoingMessage) {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const lines = [...message.lines, ...(message.url ? [message.url] : [])];
  return {
    subject: message.title.replace(/[\r\n]+/g, ' ').slice(0, 200),
    text: [message.title, ...lines].join('\n'),
    html: [
      `<p><strong>${escape(message.title)}</strong></p>`,
      ...message.lines.map((line) => `<p>${escape(line)}</p>`),
      ...(message.url ? [`<p><a href="${escape(message.url)}">${escape(message.url)}</a></p>`] : []),
    ].join('\n'),
  };
}

type Transport = { sendMail(mail: Record<string, unknown>): Promise<unknown> };
type CreateTransport = (options: Record<string, unknown>) => Transport;

export function createEmailChannel(createTransport: CreateTransport = nodemailer.createTransport) {
  return {
    label: 'Email (SMTP)',
    fields: [
      { key: 'host', label: 'SMTP host', placeholder: 'smtp.example.com', secret: false },
      { key: 'port', label: 'Port', placeholder: '587 (465 for implicit TLS)', secret: false, optional: true },
      { key: 'username', label: 'Username', placeholder: 'alerts@example.com', secret: false, optional: true },
      { key: 'password', label: 'Password', placeholder: 'SMTP password or app password', secret: true, optional: true },
      { key: 'from', label: 'From', placeholder: 'alerts@example.com', secret: false },
      { key: 'to', label: 'To', placeholder: 'you@example.com, team@example.com', secret: false },
    ],
    validate: validateEmailConfig,
    async send(config: Record<string, string>, message: OutgoingMessage): Promise<void> {
      const port = portOf(config);
      const transport = createTransport({
        host: config.host.trim(),
        port,
        // 465 speaks TLS from the first byte; other ports upgrade with STARTTLS when the server offers it.
        secure: port === 465,
        ...(config.username && { auth: { user: config.username, pass: config.password ?? '' } }),
        connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS,
      });
      await transport.sendMail({
        from: `GitHub Control <${config.from.trim()}>`,
        to: recipients(config.to),
        ...emailContent(message),
      });
    },
  };
}

registerChannelType('email', createEmailChannel());
