// The one seam a future real-time feature (C9 — a change reaching every open
// session in about a second) hooks into. Every write that should eventually
// broadcast goes through here. Today it's a no-op: ghost sync is polling, on
// purpose (see doc/adr/0001-stack.md) — this function is what changes, not
// the callers, when that becomes a `ws` broadcast.
export interface ScoreChange {
  userId: number;
  username: string;
  trackSeed: string;
  distance: number;
  lane: number | null;
}

export function scoreChanged(change: ScoreChange): void {
  void change; // no-op for now
}
