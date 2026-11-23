
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'github-control',
    user: process.env.DB_USER || process.env.USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
});

async function check() {
    const res = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE priority IS NOT NULL) as with_priority,
      COUNT(*) FILTER (WHERE has_ci IS NOT NULL) as with_health_info,
      COUNT(*) FILTER (WHERE last_health_check IS NOT NULL) as checked,
      COUNT(*) FILTER (WHERE summary IS NOT NULL) as with_summary
    FROM repos;
  `);
    console.log('Counts:', res.rows[0]);

    const meta = await pool.query(`
    SELECT full_name, priority, has_ci
    FROM repos 
    WHERE priority IS NOT NULL OR has_ci IS NOT NULL
  `);
    console.log('\nRepos with meta:', meta.rows.length);
    meta.rows.forEach(r => {
        console.log(`- ${r.full_name}: Priority=${r.priority}, CI=${r.has_ci}`);
    });

    pool.end();
}

check().catch(console.error);
