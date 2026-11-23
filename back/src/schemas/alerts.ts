import { z } from 'zod';
import { ALERT_KINDS } from '../domain/alerts';
import { CHANNEL_TYPES } from '../lib/alerts/channels';

export const AlertChannelSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  type: z.string().refine((type) => Object.prototype.hasOwnProperty.call(CHANNEL_TYPES, type), 'Unknown channel type'),
  // A secret field left empty keeps the stored value when editing.
  config: z.record(z.string().max(40), z.string().max(2000)).default({}),
  kinds: z.array(z.enum(ALERT_KINDS)).max(ALERT_KINDS.length).default([]),
  is_enabled: z.boolean().default(true),
  digest: z.enum(['off', 'daily', 'weekly']).default('off'),
});

export type AlertChannelBody = z.infer<typeof AlertChannelSchema>;
