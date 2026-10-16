// Almacén de puntuaciones: Postgres si hay DATABASE_URL (App Platform), SQLite local si no.
import path from 'node:path';
import fs from 'node:fs';

export const TOP_N = 20;

export async function createStore() {
  if (process.env.DATABASE_URL) {
    try {
      return await createPostgresStore(process.env.DATABASE_URL);
    } catch (e) {
      console.error('Postgres no disponible, se usa SQLite temporal:', e.message);
      lastPgError = e;
    }
  }
  return createSqliteStore(process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'scores.db'));
}

let lastPgError = null;

/** Diagnóstico de permisos de la base (solo si DEBUG_DB=1). */
export async function diagnosePostgres(url) {
  const { default: pg } = await import('pg');
  const u = new URL(url); u.searchParams.delete('sslmode');
  const ca = process.env.DATABASE_CA_CERT?.trim();
  const client = new pg.Client({ connectionString: u.toString(), ssl: ca ? { ca } : { rejectUnauthorized: false } });
  await client.connect();
  const q = async (sql) => (await client.query(sql)).rows;
  const info = {
    lastError: lastPgError?.message ?? null,
    who: await q('SELECT current_user, current_database(), version()'),
    role: await q('SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolinherit FROM pg_roles WHERE rolname = current_user'),
    memberOf: await q('SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)'),
    dbPriv: await q("SELECT has_database_privilege(current_database(), 'CREATE') AS create_db, has_database_privilege(current_database(), 'TEMP') AS temp"),
    schemas: await q("SELECT n.nspname, r.rolname AS owner, has_schema_privilege(n.nspname, 'CREATE') AS can_create, has_schema_privilege(n.nspname, 'USAGE') AS can_use FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'"),
    dbOwner: await q('SELECT d.datname, r.rolname AS owner FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE d.datname = current_database()'),
    tables: await q("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') LIMIT 20"),
  };
  await client.end();
  return info;
}

async function createPostgresStore(url) {
  const { default: pg } = await import('pg');
  // Las bases gestionadas de DigitalOcean exigen TLS con una CA propia. Se quita `sslmode` de la URL
  // (el driver lo interpretaría como verify-full) y se pasa la CA que App Platform inyecta en DATABASE_CA_CERT.
  const u = new URL(url);
  const wantsSsl = u.searchParams.get('sslmode') !== 'disable' && (u.searchParams.has('sslmode') || /ondigitalocean\.com/.test(u.hostname));
  u.searchParams.delete('sslmode');
  const ca = process.env.DATABASE_CA_CERT?.trim();
  const ssl = wantsSsl ? (ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }) : undefined;
  const pool = new pg.Pool({ connectionString: u.toString(), ssl, max: 5 });
  // En Postgres 15+ el usuario de una base gestionada puede no tener permiso de CREATE en `public`
  // (es el caso de las bases de desarrollo de App Platform). Se usa un esquema propio, del que sí es dueño.
  const schema = process.env.DATABASE_SCHEMA ?? 'flappy';
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  const T = `${schema}.scores`;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T} (
      id BIGSERIAL PRIMARY KEY,
      nickname TEXT NOT NULL,
      score INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_scores_score ON ${T} (score DESC, created_at ASC)`);
  return {
    kind: 'postgres',
    label: url.replace(/\/\/[^@]*@/, '//***@'),
    async top() {
      const { rows } = await pool.query(`SELECT nickname, score, created_at FROM ${T} ORDER BY score DESC, created_at ASC LIMIT ${TOP_N}`);
      return rows;
    },
    async rank(score) {
      const { rows } = await pool.query(`SELECT COUNT(*)::int + 1 AS rank FROM ${T} WHERE score > $1`, [score]);
      return rows[0].rank;
    },
    async insert(nickname, score) {
      await pool.query(`INSERT INTO ${T} (nickname, score) VALUES ($1, $2)`, [nickname, score]);
    },
    async close() { await pool.end(); },
  };
}

async function createSqliteStore(file) {
  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL,
      score INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scores_score ON scores (score DESC, created_at ASC);
  `);
  // Sentencias preparadas por llamada: en Node 22 una sentencia preparada al arrancar
  // puede quedar finalizada cuando el recolector libera la referencia a la base.
  return {
    kind: 'sqlite',
    label: file,
    async top() { return db.prepare(`SELECT nickname, score, created_at FROM scores ORDER BY score DESC, created_at ASC LIMIT ${TOP_N}`).all(); },
    async rank(score) { return db.prepare('SELECT COUNT(*) + 1 AS rank FROM scores WHERE score > ?').get(score).rank; },
    async insert(nickname, score) { db.prepare('INSERT INTO scores (nickname, score) VALUES (?, ?)').run(nickname, score); },
    async close() { db.close(); },
  };
}
