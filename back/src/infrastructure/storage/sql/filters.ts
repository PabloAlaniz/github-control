export interface ActiveRepoFilterOptions {
  includeArchived?: boolean;
  includeDeleted?: boolean;
  includePaused?: boolean;
}

export function activeRepoConditions(
  options: ActiveRepoFilterOptions = {},
  alias = 'r'
): string[] {
  const conditions: string[] = [];
  const t = alias ? `${alias}.` : '';
  if (!options.includeDeleted)  conditions.push(`(${t}is_deleted = false OR ${t}is_deleted IS NULL)`);
  if (!options.includeArchived) conditions.push(`(${t}is_archived = false OR ${t}is_archived IS NULL)`);
  if (!options.includePaused)   conditions.push(`(${t}priority != 'paused' OR ${t}priority IS NULL)`);
  return conditions;
}
