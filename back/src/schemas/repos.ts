import { z } from 'zod';

export const prioritySchema = z.enum(['high', 'medium', 'low', 'paused']);

export const statusSchema = z.enum(['reviewed', 'pending', 'archived']);

export const updatePriorityBody = z.object({
  priority: prioritySchema,
});

export const updateStatusBody = z.object({
  status: statusSchema,
});

export const healthUpdateBody = z.object({
  has_ci: z.boolean(),
  has_tests: z.boolean(),
  has_readme: z.boolean(),
  has_gitignore: z.boolean(),
  test_coverage: z.number().min(0).max(100).optional(),
  readme_lines: z.number().int().min(0),
  stack: z.string().optional(),
  has_roadmap: z.boolean(),
});

export const blockerBody = z.object({
  blocker: z.string().min(1),
});
