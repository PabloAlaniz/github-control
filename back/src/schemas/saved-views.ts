import { z } from 'zod';

/**
 * A saved view is a name + the dashboard's query string (without "?").
 * The back does not interpret the filters: the front owns the format.
 */
export const SavedViewSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(80),
  query: z.string().max(2000).default('').transform(q => q.replace(/^\?/, '')),
});

export type SavedViewInput = z.infer<typeof SavedViewSchema>;
