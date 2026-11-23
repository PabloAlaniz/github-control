#!/usr/bin/env node
/**
 * Check if repo_metrics_history table exists.
 * Usage: node back/scripts/check-table.js
 * Uses back/config/snapshot.json for DATABASE_URL (or env DATABASE_URL).
 */
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  try {
    const configPath = path.join(__dirname, '../config/snapshot.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    connectionString = config.DATABASE_URL;
  } catch {
    console.error('Missing DATABASE_URL. Set env or create back/config/snapshot.json');
    process.exit(1);
  }
}

const client = new pg.Client({ connectionString });

async function check() {
  await client.connect();
  const { rows } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'repo_metrics_history') as "exists"`
  );
  console.log('Tabla repo_metrics_history:', rows[0].exists ? 'SÍ existe' : 'NO existe');
  if (rows[0].exists) {
    const count = await client.query('SELECT COUNT(*) as c FROM repo_metrics_history');
    console.log('Registros:', count.rows[0].c);
  }
  await client.end();
}

check().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
