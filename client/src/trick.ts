/**
 * Pure QTE state machine for a ramp trick (doc/adr/0013, doc/adr/0014). No
 * three.js, no DOM — `main.ts` drives this from the frame loop and the
 * keydown handler, and reads `outcome`/`results` to update the HUD and
 * camera-rig zoom.
 *
 * Unlike `car.ts`'s `stepCar`/`shiftLane`, these functions return a new
 * `TrickState` rather than mutating in place. A trick's state is small,
 * short-lived (one ramp's QTE at a time), and the caller needs to tell apart
 * "nothing changed" (e.g. `submitInput` while not active) from "the state
 * advanced" without re-deriving that itself — returning the same vs. a new
 * object makes that distinction free. `car.distance` accumulates every
 * frame regardless of outcome, so there's no equivalent reason to mutate
 * trick state in place the way `stepCar` does for the car.
 */

/** One QTE input token. A trick is additive on top of existing left/right
 * steering (doc/adr/0013), so it needs all four directions — unlike
 * `shiftLane`'s `-1 | 1`, which only ever moves one lane at a time. */
export type TrickInput = "up" | "down" | "left" | "right";

/** Seconds allowed for the WHOLE sequence, shown on the HUD as a depleting
 * bar (doc/adr/0014). Replaces the old per-step timeout: a trick is read and
 * played in one glance at all its steps at once, not one prompt at a time,
 * so the time budget belongs to the attempt as a whole. */
export const TRICK_WINDOW_SECONDS = 2;

/** The longest sequence the HUD can show at once, all steps visible
 * simultaneously (doc/adr/0014) — the catalogue's longest entry today is 4. */
export const MAX_TRICK_STEPS = 4;

/** One QTE's definition: an ordered list of inputs the player must land in
 * sequence, plus the distance bonus awarded on completion. Catalogue data
 * (doc/adr/0013's `tricks` table) maps onto this shape; `main.ts` picks one
 * via `Math.random()` over the player's owned tricks and calls
 * `startTrick`. */
export interface TrickSequence {
  id: string;
  name: string;
  steps: TrickInput[];
  bonusMetres: number;
}

export type TrickOutcome = "active" | "error" | "done";

/** Per-step feedback for the HUD: every step starts `"pending"`, turns
 * `"correct"` the instant it's matched, or `"wrong"` the instant it fails
 * (a bad key, or the window running out while it's still pending) — the
 * green/red-per-step readout doc/adr/0014 asks for. */
export type TrickStepResult = "pending" | "correct" | "wrong";

export interface TrickState {
  active: boolean;
  sequenceId: string;
  /** The sequence being attempted. Carried on the state (rather than looked
   * up elsewhere by `sequenceId`) so `TrickState` is self-contained — a
   * caller can read `state.sequence.steps`/`state.results` for the HUD
   * without needing the catalogue in scope. */
  sequence: TrickSequence;
  stepIndex: number;
  /** Seconds elapsed since the whole sequence started. */
  windowElapsed: number;
  /** One entry per `sequence.steps` entry — see `TrickStepResult`. */
  results: TrickStepResult[];
  outcome: TrickOutcome;
}

/** An idle/inactive state, returned by `submitInput`/`advanceTrick` no-ops
 * and usable as the initial state before any ramp is hit. */
const IDLE_SEQUENCE: TrickSequence = { id: "", name: "", steps: [], bonusMetres: 0 };

export function createIdleTrick(): TrickState {
  return {
    active: false,
    sequenceId: "",
    sequence: IDLE_SEQUENCE,
    stepIndex: 0,
    windowElapsed: 0,
    results: [],
    outcome: "done",
  };
}

/** Begins a QTE at step 0, every step `"pending"`. `sequence.steps` must be
 * no longer than `MAX_TRICK_STEPS` — the HUD has no room to show more at
 * once. */
export function startTrick(sequence: TrickSequence): TrickState {
  return {
    active: true,
    sequenceId: sequence.id,
    sequence,
    stepIndex: 0,
    windowElapsed: 0,
    results: sequence.steps.map(() => "pending"),
    outcome: "active",
  };
}

/**
 * Advances the whole-sequence timer. Running past `TRICK_WINDOW_SECONDS`
 * fails whichever step is still pending and ends the sequence in "error" —
 * a timeout and a wrong input (`submitInput`) are two different paths to the
 * same outcome (doc/adr/0013/0014: "a wrong input or running out of time
 * both end the sequence").
 */
export function advanceTrick(state: TrickState, dt: number): TrickState {
  if (!state.active) return state;

  const windowElapsed = state.windowElapsed + dt;
  if (windowElapsed > TRICK_WINDOW_SECONDS) {
    const results = [...state.results];
    results[state.stepIndex] = "wrong";
    return { ...state, windowElapsed, active: false, outcome: "error", results };
  }
  return { ...state, windowElapsed };
}

/**
 * Compares `key` against the expected token for the current step. A no-op
 * (state returned unchanged) unless a QTE is active.
 */
export function submitInput(state: TrickState, key: string): TrickState {
  if (!state.active) return state;

  const expected = state.sequence.steps[state.stepIndex];
  const results = [...state.results];
  if (key !== expected) {
    results[state.stepIndex] = "wrong";
    return { ...state, active: false, outcome: "error", results };
  }
  results[state.stepIndex] = "correct";

  const nextIndex = state.stepIndex + 1;
  if (nextIndex >= state.sequence.steps.length) {
    return { ...state, active: false, outcome: "done", results };
  }
  return { ...state, stepIndex: nextIndex, results };
}

/** Minimum drag, in px, before a gesture reads as a directional token. Same
 * figure as the lane swipe's `SWIPE_MIN_PX` in `main.ts`, so a tap's jitter
 * never answers a QTE step. */
export const TRICK_SWIPE_MIN_PX = 24;

/**
 * Maps a completed drag to the one QTE token it answers, or `null` when it is
 * too short to count. The dominant axis wins, so a diagonal drag still reads
 * as one direction rather than none. Screen y grows downward, so a drag up
 * has `dy < 0`.
 */
export function swipeToTrickInput(dx: number, dy: number): TrickInput | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < TRICK_SWIPE_MIN_PX) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

/** The free default trick, always available with no purchase (doc/adr/0013:
 * "a free default trick ... is always available without purchase"). Client-
 * side fallback used until the shop/catalogue integration lands. */
export const DEFAULT_TRICK: TrickSequence = {
  id: "default-flip",
  name: "Quick Flip",
  steps: ["up", "down", "up"],
  bonusMetres: 150,
};
