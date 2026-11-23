import { z } from 'zod';

export const coverageReportBody = z.object({
  coverage: z.number().min(0).max(100),
  label: z.string().optional(),
  commit_sha: z.string().optional(),
});
