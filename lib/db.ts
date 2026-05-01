// lib/db.ts
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR
  ? path.isAbsolute(process.env.DATA_DIR)
    ? process.env.DATA_DIR
    : path.join(process.cwd(), process.env.DATA_DIR)
  : path.join(process.cwd(), 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'wp-publisher.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  _db = db;
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT,
      image         TEXT,
      created_at    INTEGER NOT NULL,
      last_login_at INTEGER
    );
  `);
}

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  created_at: number;
  last_login_at: number | null;
}

export function upsertUser(input: {
  email: string;
  name?: string | null;
  image?: string | null;
}): UserRow {
  const db = getDb();
  const now = Date.now();
  const existing = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(input.email) as UserRow | undefined;

  if (existing) {
    const name = input.name ?? existing.name;
    const image = input.image ?? existing.image;
    db.prepare('UPDATE users SET name = ?, image = ?, last_login_at = ? WHERE id = ?').run(
      name,
      image,
      now,
      existing.id,
    );
    return { ...existing, name, image, last_login_at: now };
  }

  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO users (id, email, name, image, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, input.email, input.name ?? null, input.image ?? null, now, now);

  return {
    id,
    email: input.email,
    name: input.name ?? null,
    image: input.image ?? null,
    created_at: now,
    last_login_at: now,
  };
}

export function getUserById(id: string): UserRow | null {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ?? null;
}

export function getUserByEmail(email: string): UserRow | null {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email) as UserRow | undefined;
  return row ?? null;
}
