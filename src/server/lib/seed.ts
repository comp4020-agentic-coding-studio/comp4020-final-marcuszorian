// A "track seed" is a UTC calendar date (YYYY-MM-DD). Every client derives
// today's seed locally from Date — no server round-trip needed for that — so
// this module only has to validate seeds the client sends back, not generate
// them. See doc/adr/0002-daily-seeded-archive.md.
const SEED_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// A seed is valid if it's a real calendar date, in YYYY-MM-DD shape, that
// isn't in the future — you can replay or race history, you can't post a run
// against a day that hasn't happened yet.
export function isValidPastSeed(seed: unknown): seed is string {
  if (typeof seed !== "string" || !SEED_RE.test(seed)) return false;
  const parsed = new Date(`${seed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // Round-trip check: catches nonsense like 2026-02-31, which Date() rolls
  // over into March rather than rejecting.
  if (parsed.toISOString().slice(0, 10) !== seed) return false;
  return seed <= todayUtc();
}
