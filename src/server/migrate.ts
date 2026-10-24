#!/usr/bin/env node
// Runs schema migrations against the volume-backed SQLite file. This has to
// run on the real machine, at boot, inside the app's own CMD — NOT as a Fly
// release_command, because release-phase machines don't have the volume
// attached (fly.toml says so). Idempotent: safe to run on every boot/restart.
import { readdirSync, readFileSync } from "node:fs";
import { db } from "./db.ts";

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const applied = new Set(
  db
    .prepare("SELECT version FROM schema_migrations")
    .all()
    .map((row) => (row as { version: number }).version),
);

const files = readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  const version = parseInt(file, 10);
  if (applied.has(version)) continue;

  const sql = readFileSync(`migrations/${file}`, "utf8");
  db.transaction(() => {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(version);
  })();
  console.log(`applied migration ${file}`);
}

db.close();
