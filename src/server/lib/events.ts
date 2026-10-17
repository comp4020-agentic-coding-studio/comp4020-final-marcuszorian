// The one seam a real-time feature hooks into. Every write that should reach
// other open sessions goes through here, and ADR 0001 planned it this way:
// "a single `scoreChanged()` seam in the server where a `ws` broadcast gets
// added later without touching anything else." That's now cashed in — and
// note that runs.ts, the only caller, did not change.
//
// This is a plain in-process topic, not a broker. ADR 0001 fixes the app at
// one Fly machine, so every open socket is in this process and an in-memory
// Set reaches all of them. A second machine would need a shared broker
// (Redis, Postgres LISTEN/NOTIFY); that is a different decision, for a
// different deployment.
export interface ScoreChange {
  userId: number;
  username: string;
  trackSeed: string;
  distance: number;
  lane: number | null;
  /**
   * The author's crew, or null. Carried on the change rather than looked up
   * by the broadcaster: the run's audience is decided by who the author was
   * AT THE MOMENT THEY FINISHED, and a lookup at broadcast time would read a
   * crew they might already have left (ADR 0011).
   */
  crewId: number | null;
}

type Listener = (change: ScoreChange) => void;

const listeners = new Set<Listener>();

/** Subscribes to score changes. Returns the unsubscribe function. */
export function onScoreChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function scoreChanged(change: ScoreChange): void {
  for (const listener of listeners) {
    try {
      listener(change);
    } catch {
      // One broken subscriber (a socket that died between the readyState
      // check and the send) must not stop the others getting the change, and
      // must not fail the HTTP request that triggered it — the run is already
      // committed by the time we get here.
    }
  }
}
