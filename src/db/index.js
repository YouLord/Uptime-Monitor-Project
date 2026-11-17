/**
 * Database abstraction layer supporting SQLite and PostgreSQL
 */

import Database from 'better-sqlite3';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import config from '../config.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

let db = null;
let pgPool = null;
let isPostgres = false;

export function initDatabase() {
  const cfg = config();
  
  if (cfg.DATABASE_URL) {
    // PostgreSQL
    isPostgres = true;
    pgPool = new Pool({
      connectionString: cfg.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    
    pgPool.on('error', (err) => {
      console.error('PostgreSQL pool error:', err);
    });
    
    console.log('📊 Using PostgreSQL database');
    runMigrationsPostgres();
  } else {
    // SQLite
    isPostgres = false;
    const dbPath = resolve(process.cwd(), cfg.DB_PATH);
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    
    console.log(`📊 Using SQLite database: ${dbPath}`);
    runMigrationsSqlite();
  }
  
  return { db, pgPool, isPostgres };
}

function runMigrationsSqlite() {
  const schema = readFileSync(resolve(__dirname, 'schema.sql'), 'utf-8');
  const statements = schema.split(';').filter(s => s.trim());
  
  for (const stmt of statements) {
    try {
      db.exec(stmt);
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.error('Migration error:', err.message);
      }
    }
  }
  
  // Insert default settings
  const defaults = [
    ['retention_days', '30', 'Days to keep detailed check results'],
    ['retention_hourly_days', '90', 'Days to keep hourly aggregates'],
    ['default_check_interval', '60', 'Default check interval in seconds'],
    ['max_concurrent_checks', '50', 'Maximum concurrent monitoring checks'],
  ];
  
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value, description, updated_at) VALUES (?, ?, ?, ?)');
  const now = Date.now();
  for (const [key, value, desc] of defaults) {
    insertSetting.run(key, value, desc, now);
  }
}

async function runMigrationsPostgres() {
  const schema = readFileSync(resolve(__dirname, 'schema.sql'), 'utf-8');
  const statements = schema.split(';').filter(s => s.trim());
  
  const client = await pgPool.connect();
  try {
    for (const stmt of statements) {
      try {
        await client.query(stmt);
      } catch (err) {
        if (!err.message.includes('already exists') && !err.message.includes('duplicate key')) {
          console.error('Postgres migration error:', err.message);
        }
      }
    }
    
    // Insert default settings
    const defaults = [
      ['retention_days', '30', 'Days to keep detailed check results'],
      ['retention_hourly_days', '90', 'Days to keep hourly aggregates'],
      ['default_check_interval', '60', 'Default check interval in seconds'],
      ['max_concurrent_checks', '50', 'Maximum concurrent monitoring checks'],
    ];
    
    const now = Date.now();
    for (const [key, value, desc] of defaults) {
      await client.query(
        'INSERT INTO settings (key, value, description, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING',
        [key, value, desc, now]
      );
    }
  } finally {
    client.release();
  }
}

export function getDb() {
  if (!db && !pgPool) initDatabase();
  return { db, pgPool, isPostgres };
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
  if (pgPool) {
    pgPool.end();
    pgPool = null;
  }
}

// Helper for parameterized queries (handles ? vs $1)
export function sql(strings, ...values) {
  if (isPostgres) {
    // Convert ? to $1, $2, etc.
    let query = strings[0];
    for (let i = 0; i < values.length; i++) {
      query += `$${i + 1}` + strings[i + 1];
    }
    return { text: query, values };
  }
  // SQLite uses ?
  return { text: strings.join('?'), values };
}

// Transaction helper
export async function transaction(fn) {
  if (isPostgres) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    const tx = db.transaction(fn);
    return tx();
  }
}

export function generateId() {
  return randomUUID();
}

export function now() {
  return Date.now();
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}