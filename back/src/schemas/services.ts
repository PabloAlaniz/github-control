import { z } from 'zod';

export const createServiceBody = z.object({
  name: z.string().min(1),
  provider: z.string().min(1),
  url: z.string().url().optional(),
  project: z.string().optional(),
  region: z.string().optional(),
  env: z.string().optional(),
  source_repo_full_name: z.string().optional(),
  source_path: z.string().optional(),
  description: z.string().optional(),
  slug: z.string().optional(),
});

export const updateServiceBody = createServiceBody.partial().extend({
  is_active: z.boolean().optional(),
});
