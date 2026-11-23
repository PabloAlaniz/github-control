import type { AppContext } from '../application/context';
import { detectRepoApps } from '../lib/github';
import { appSlugify } from '../lib/slugify';

/** Detect monorepo apps and optionally persist them. */
export async function detectAndPersistApps(ctx: AppContext, owner: string, repo: string, persist: boolean) {
  const fullName = `${owner}/${repo}`;
  const detectedApps = await detectRepoApps(ctx.config, owner, repo);

  if (persist && detectedApps.length > 0) {
    for (const app of detectedApps) {
      const slug = appSlugify(fullName, app.app_name);
      await ctx.storage.apps.upsertApp({
        repo_full_name: fullName, app_path: app.app_path, app_name: app.app_name,
        slug, stack: app.stack || null, detection_source: app.detection_source,
      });
    }
  }

  return { repo: fullName, detected: detectedApps.length, persisted: persist, apps: detectedApps };
}
