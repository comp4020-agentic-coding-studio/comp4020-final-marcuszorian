/**
 * Pure QTE state machine for a ramp trick (doc/adr/0013). No three.js, no
 * DOM — `main.ts` drives this from the frame loop and the keydown handler,
 * and reads `outcome`/`stepIndex` to update the HUD and camera-rig zoom.
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

/** Seconds allowed per step before it times out. One constant for every
 * step of every sequence, in the spirit of `SLIDE_SECONDS`/
 * `OIL_SLIDE_SECONDS` in car.ts — simplest thing that could work until a
 * trick actually needs per-step pacing. */
export const STEP_TIMEOUT_SECONDS = 1.5;

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

export type TrickOutcome = "prompt" | "ok" | "error" | "done";

export interface TrickState {
  active: boolean;
  sequenceId: string;
  /** The sequence being attempted. Carried on the state (rather than looked
   * up elsewhere by `sequenceId`) so `TrickState` is self-contained — a
   * caller can read `state.sequence.steps[state.stepIndex]` for the HUD
   * prompt without needing the catalogue in scope. */
  sequence: TrickSequence;
  stepIndex: number;
  /** Seconds elapsed on the current step. */
  stepElapsed: number;
  outcome: TrickOutcome;
}

/** An idle/inactive state, returned by `submitInput`/`advanceTrick` no-ops
 * and usable as the initial state before any ramp is hit. */
const IDLE_SEQUENCE: TrickSequence = { id: "", name: "", steps: [], bonusMetres: 0 };

export function createIdleTrick(): TrickState {
  return { active: false, sequenceId: "", sequence: IDLE_SEQUENCE, stepIndex: 0, stepElapsed: 0, outcome: "done" };
}

/** Begins a QTE at step 0. */
export function startTrick(sequence: TrickSequence): TrickState {
  return {
    active: true,
    sequenceId: sequence.id,
    sequence,
    stepIndex: 0,
    stepElapsed: 0,
    outcome: "prompt",
  };
}

/**
 * Advances the step timer. A step that runs past `STEP_TIMEOUT_SECONDS`
 * ends the whole sequence in "error" — a timeout and a wrong input
 * (`submitInput`) are two different paths to the same outcome (doc/adr/0013:
 * "a wrong input or a timeout" both end the sequence).
 *
 * Also carries a brief "ok" outcome (set by `submitInput` on a
 * correct-but-not-final input) back to "prompt" for the next step, so the
 * HUD sees one frame of acknowledgment before the next prompt appears.
 */
export function advanceTrick(state: TrickState, dt: number): TrickState {
  if (!state.active) return state;

  if (state.outcome === "ok") {
    return { ...state, stepElapsed: 0, outcome: "prompt" };
  }

  const stepElapsed = state.stepElapsed + dt;
  if (stepElapsed > STEP_TIMEOUT_SECONDS) {
    return { ...state, stepElapsed, active: false, outcome: "error" };
  }
  return { ...state, stepElapsed };
}

/**
 * Compares `key` against the expected token for the current step. A no-op
 * (state returned unchanged) unless a QTE is active and currently showing a
 * fresh prompt — in particular, input during the one-frame "ok" pulse is
 * ignored rather than racing the next step's prompt.
 */
export function submitInput(state: TrickState, key: string): TrickState {
  if (!state.active || state.outcome !== "prompt") return state;

  const expected = state.sequence.steps[state.stepIndex];
  if (key !== expected) {
    return { ...state, active: false, outcome: "error" };
  }

  const nextIndex = state.stepIndex + 1;
  if (nextIndex >= state.sequence.steps.length) {
    return { ...state, active: false, outcome: "done" };
  }
  return { ...state, stepIndex: nextIndex, stepElapsed: 0, outcome: "ok" };
}

/** The free default trick, always available with no purchase (doc/adr/0013:
 * "a free default trick ... is always available without purchase"). Client-
 * side fallback used until the shop/catalogue integration lands. */
export const DEFAULT_TRICK: TrickSequence = {
  id: "default-flip",
  name: "Quick Flip",
  steps: ["up", "down", "up"],
  bonusMetres: 20,
};
