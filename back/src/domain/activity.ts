/** Activity log vocabulary and row formatting. Pure: no storage or HTTP imports. */

// ── Action constants ────────────────────────────────

export const ACTIONS = {
  GROUP_ADD: 'group.add',
  GROUP_REMOVE: 'group.remove',
  GROUP_CREATE: 'group.create',
  GROUP_DELETE: 'group.delete',
  PRIORITY_SET: 'priority.set',
  COMPLETION_SET: 'completion.set',
  NEXT_ACTION_SET: 'nextAction.set',
  BLOCKER_ADD: 'blocker.add',
  BLOCKER_REMOVE: 'blocker.remove',
  HEALTH_UPDATE: 'health.update',
  CI_SET: 'health.ci',
  TESTS_SET: 'health.tests',
  README_SET: 'health.readme',
  COVERAGE_SET: 'health.coverage',
  COVERAGE_CI_PUSH: 'coverage.ci_push',
  CLIENT_SET: 'meta.client',
  NOTES_SET: 'meta.notes',
  URLS_SET: 'meta.urls',
  SUMMARY_UPDATE: 'docs.summary',
  ARCHIVE_SET: 'repo.archive',
  REPO_DELETED: 'repo.deleted',
  REPO_REMOVED: 'repo.removed',
  SERVICE_CREATE: 'service.create',
  SERVICE_UPDATE: 'service.update',
  SERVICE_DELETE: 'service.delete',
  SERVICE_HEALTH_CHECK: 'service.health_check',
  BRANCH_DELETE: 'repo.branch_delete',
  CONFIG_APPLY: 'repo.config_apply',
  POLICY_UPDATE: 'policy.update',
  PR_MERGE: 'repo.pr_merge',
  PR_REVIEW: 'repo.pr_review',
  ISSUE_COMMENT: 'repo.issue_comment',
  ALERT_CHANNEL_CREATE: 'alert_channel.create',
  ALERT_CHANNEL_UPDATE: 'alert_channel.update',
  ALERT_CHANNEL_DELETE: 'alert_channel.delete',
};

// ── Log activity ────────────────────────────────────

export function formatLogRow(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    fieldChanged: row.field_changed,
    oldValue: row.old_value,
    newValue: row.new_value,
    actorType: row.actor_type,
    actorName: row.actor_name,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
    createdAt: row.created_at,
  };
}
