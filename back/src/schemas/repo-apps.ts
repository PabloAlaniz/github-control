import { z } from 'zod';

export const createRepoAppBody = z.object({
  repo_full_name: z.string().min(1),
  app_path: z.string().min(1),
  app_name: z.string().min(1),
  stack: z.string().optional(),
  detection_source: z.string().optional(),
  slug: z.string().optional(),
});
