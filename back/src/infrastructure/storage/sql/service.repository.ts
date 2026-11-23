import type { SqlClient } from './client';
import { serviceFromRepo } from '../../../domain/services';

export async function listServices(db: SqlClient, filters: {
  provider?: string; env?: string; sourceRepo?: string; isActive?: string;
}) {
  const conditions: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (filters.provider) { conditions.push(`s.provider = $${paramIndex++}`); values.push(filters.provider); }
  if (filters.env) { conditions.push(`s.env = $${paramIndex++}`); values.push(filters.env); }
  if (filters.sourceRepo) { conditions.push(`s.source_repo_full_name = $${paramIndex++}`); values.push(filters.sourceRepo); }
  if (filters.isActive !== undefined) { conditions.push(`s.is_active = $${paramIndex++}`); values.push(filters.isActive === 'true'); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.query(`
    SELECT s.*, r.language as repo_language, r.stack as repo_stack
    FROM services s
    LEFT JOIN repos r ON s.source_repo_full_name = r.full_name
    ${whereClause}
    ORDER BY s.name
  `, values);
}

export async function getService(db: SqlClient, slug: string) {
  return db.queryOne(`
    SELECT s.*, r.language as repo_language, r.stack as repo_stack, r.description as repo_description
    FROM services s
    LEFT JOIN repos r ON s.source_repo_full_name = r.full_name
    WHERE s.slug = $1
  `, [slug]);
}

export async function getServiceBasic(db: SqlClient, slug: string) {
  return db.queryOne<{ id: number; url: string; name: string }>(
    'SELECT id, url, name FROM services WHERE slug = $1', [slug]);
}

export async function createService(db: SqlClient, data: {
  name: string; slug: string; url?: string; provider: string;
  project?: string; region?: string; env?: string;
  source_repo_full_name?: string; source_path?: string; description?: string;
}) {
  return db.queryOne<{ id: number; slug: string }>(`
    INSERT INTO services (name, slug, url, provider, project, region, env, source_repo_full_name, source_path, description)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id, slug
  `, [data.name, data.slug, data.url || null, data.provider,
      data.project || null, data.region || null, data.env || 'production',
      data.source_repo_full_name || null, data.source_path || null, data.description || null]);
}

export async function updateService(db: SqlClient, slug: string, fields: Record<string, any>): Promise<void> {
  const { name, url, provider, project, region, env: serviceEnv, source_repo_full_name, source_path, description, is_active } = fields;
  await db.query(`
    UPDATE services SET
      name = COALESCE($1, name), url = COALESCE($2, url),
      provider = COALESCE($3, provider), project = COALESCE($4, project),
      region = COALESCE($5, region), env = COALESCE($6, env),
      source_repo_full_name = COALESCE($7, source_repo_full_name),
      source_path = COALESCE($8, source_path),
      description = COALESCE($9, description),
      is_active = COALESCE($10, is_active)
    WHERE slug = $11
  `, [name || null, url || null, provider || null, project || null,
      region || null, serviceEnv || null, source_repo_full_name || null,
      source_path || null, description || null, is_active ?? null, slug]);
}

export async function deleteService(db: SqlClient, slug: string): Promise<void> {
  await db.query(`DELETE FROM services WHERE slug = $1`, [slug]);
}

export async function getServiceForDelete(db: SqlClient, slug: string) {
  return db.queryOne(`SELECT id, name FROM services WHERE slug = $1`, [slug]);
}

export async function updateHealthCheck(db: SqlClient, slug: string, status: string, responseMs: number | null, httpCode: number | null): Promise<void> {
  await db.query(`
    UPDATE services SET
      last_check_at = ${db.dialect.now}, last_check_status = $1,
      last_check_response_ms = $2, last_check_http_code = $3
    WHERE slug = $4
  `, [status, responseMs, httpCode, slug]);
}

export async function listActiveServices(db: SqlClient) {
  return db.query<{ slug: string; url: string; name: string }>(
    'SELECT slug, url, name FROM services WHERE is_active = true AND url IS NOT NULL');
}

export async function syncFromRepos(db: SqlClient) {
  // Services already linked to a repo but missing a URL take the repo's homepage.
  const updated = await db.query(`
    UPDATE services SET url = (SELECT r.homepage FROM repos r WHERE r.full_name = services.source_repo_full_name)
    WHERE url IS NULL
      AND EXISTS (
        SELECT 1 FROM repos r
        WHERE r.full_name = services.source_repo_full_name
          AND r.homepage IS NOT NULL AND r.homepage != ''
      )
    RETURNING id
  `);

  // Repos with a homepage and no service yet get one, derived by the domain rules.
  const candidates = await db.query(`
    SELECT r.full_name, r.name, r.homepage FROM repos r
    WHERE r.homepage IS NOT NULL AND r.homepage != ''
      AND (r.is_deleted = false OR r.is_deleted IS NULL)
      AND NOT EXISTS (SELECT 1 FROM services s WHERE s.source_repo_full_name = r.full_name)
    ORDER BY r.id
  `);

  let createdCount = 0;
  for (const repo of candidates) {
    const service = serviceFromRepo(repo);
    const inserted = await db.query(`
      INSERT INTO services (name, slug, url, provider, region, source_repo_full_name, env)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (slug) DO NOTHING
      RETURNING id
    `, [service.name, service.slug, service.url, service.provider, service.region,
        service.source_repo_full_name, service.env]);
    createdCount += inserted.length;
  }

  return { updatedCount: updated.length, createdCount };
}

export async function listServicesByRepo(db: SqlClient, fullName: string) {
  return db.query(`
    SELECT * FROM services
    WHERE source_repo_full_name = $1 AND is_active = true
    ORDER BY name
  `, [fullName]);
}
