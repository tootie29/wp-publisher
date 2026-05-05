// scripts/_env.ts
// Tiny .env.local / .env loader for standalone scripts (ts-node).
// Next.js loads these automatically inside the dev server; CLI scripts don't.
import { existsSync, readFileSync } from 'node:fs';

function parse(content: string) {
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) parse(readFileSync(file, 'utf8'));
}
