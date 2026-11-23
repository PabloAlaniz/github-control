import type { AlertChannel, AlertChannelInput } from '../../../application/ports/storage';
import { isoTimestamp, type SqlClient } from './client';

const COLUMNS = 'id, name, type, config, kinds, is_enabled, digest, last_sent_at, last_error, last_digest_at, created_at, updated_at';

function toChannel(row: AlertChannel): AlertChannel {
  return {
    ...row,
    config: row.config ?? {},
    kinds: row.kinds ?? [],
    last_sent_at: isoTimestamp(row.last_sent_at),
    last_digest_at: isoTimestamp(row.last_digest_at),
    created_at: isoTimestamp(row.created_at)!,
    updated_at: isoTimestamp(row.updated_at)!,
  };
}

const values = (input: AlertChannelInput) => [
  input.name, input.type, JSON.stringify(input.config), JSON.stringify(input.kinds), input.is_enabled, input.digest,
];

export async function listChannels(db: SqlClient): Promise<AlertChannel[]> {
  return (await db.query<AlertChannel>(`SELECT ${COLUMNS} FROM alert_channels ORDER BY id`)).map(toChannel);
}

export async function getChannel(db: SqlClient, id: number): Promise<AlertChannel | null> {
  const row = await db.queryOne<AlertChannel>(`SELECT ${COLUMNS} FROM alert_channels WHERE id = $1`, [id]);
  return row ? toChannel(row) : null;
}

export async function createChannel(db: SqlClient, input: AlertChannelInput): Promise<AlertChannel> {
  const row = await db.queryOne<AlertChannel>(`
    INSERT INTO alert_channels (name, type, config, kinds, is_enabled, digest)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING ${COLUMNS}
  `, values(input));
  return toChannel(row!);
}

export async function updateChannel(db: SqlClient, id: number, input: AlertChannelInput): Promise<AlertChannel | null> {
  const row = await db.queryOne<AlertChannel>(`
    UPDATE alert_channels SET
      name = $1, type = $2, config = $3, kinds = $4, is_enabled = $5, digest = $6,
      updated_at = ${db.dialect.now}
    WHERE id = $7
    RETURNING ${COLUMNS}
  `, [...values(input), id]);
  return row ? toChannel(row) : null;
}

export async function deleteChannel(db: SqlClient, id: number): Promise<boolean> {
  return (await db.query(`DELETE FROM alert_channels WHERE id = $1 RETURNING id`, [id])).length > 0;
}

export async function recordDelivery(
  db: SqlClient, id: number, outcome: { error: string | null; digest?: boolean },
): Promise<void> {
  const sets = ['last_error = $1'];
  if (outcome.error === null) sets.push(`last_sent_at = ${db.dialect.now}`);
  if (outcome.digest) sets.push(`last_digest_at = ${db.dialect.now}`);
  await db.query(`UPDATE alert_channels SET ${sets.join(', ')} WHERE id = $2`, [outcome.error, id]);
}
