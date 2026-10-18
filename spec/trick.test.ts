import { describe, expect, it } from "vitest";
import {
  advanceTrick,
  startTrick,
  swipeToTrickInput,
  TRICK_SWIPE_MIN_PX,
  TRICK_WINDOW_SECONDS,
  submitInput,
} from "../client/src/trick.ts";
import type { TrickSequence } from "../client/src/trick.ts";

// Pure state-machine tests for the QTE a ramp starts (doc/adr/0013,
// doc/adr/0014) — same client-module-direct style as spec/trim.test.ts, since
// nothing here needs three.js or HTTP.
const sequence: TrickSequence = { id: "test", name: "test trick", steps: ["up", "down", "left"], bonusMetres: 50 };

describe("a correct full sequence completes", () => {
  it("advances through every step and lands on done, marking each step correct", () => {
    let state = startTrick(sequence);
    expect(state.active).toBe(true);
    expect(state.outcome).toBe("active");
    expect(state.results).toEqual(["pending", "pending", "pending"]);

    state = submitInput(state, "up");
    expect(state.active).toBe(true);
    expect(state.stepIndex).toBe(1);
    expect(state.results).toEqual(["correct", "pending", "pending"]);

    state = submitInput(state, "down");
    expect(state.stepIndex).toBe(2);
    expect(state.results).toEqual(["correct", "correct", "pending"]);

    state = submitInput(state, "left");
    expect(state.outcome).toBe("done");
    expect(state.active).toBe(false);
    expect(state.results).toEqual(["correct", "correct", "correct"]);
  });
});

describe("a wrong input ends the sequence early", () => {
  it("marks the current step wrong, sets outcome to error, and stops without crediting a bonus", () => {
    let state = startTrick(sequence);
    state = submitInput(state, "down"); // sequence expects "up" first
    expect(state.outcome).toBe("error");
    expect(state.active).toBe(false);
    expect(state.results).toEqual(["wrong", "pending", "pending"]);
  });
});

describe("running out of the whole-sequence window ends it the same way a wrong input does", () => {
  it("marks the step that was pending wrong once windowElapsed exceeds TRICK_WINDOW_SECONDS", () => {
    let state = startTrick(sequence);
    state = submitInput(state, "up"); // first step correct, second still pending
    state = advanceTrick(state, TRICK_WINDOW_SECONDS + 0.01);
    expect(state.outcome).toBe("error");
    expect(state.active).toBe(false);
    expect(state.results).toEqual(["correct", "wrong", "pending"]);
  });
});

describe("input is ignored outside an active sequence", () => {
  it("no-ops on a settled (inactive) state", () => {
    let state = startTrick(sequence);
    state = submitInput(state, "down"); // wrong — settles to error
    const settled = state;
    state = submitInput(state, "up");
    expect(state).toEqual(settled);
  });

  it("advanceTrick no-ops once the sequence has settled", () => {
    let state = startTrick(sequence);
    state = submitInput(state, "down"); // wrong — settles to error
    const settled = state;
    state = advanceTrick(state, 1);
    expect(state).toEqual(settled);
  });
});

// A swipe answers the QTE as a direction, the same token an arrow key sends.
// The mapping is pure, so it is pinned here rather than through a DOM event.
describe("a swipe maps to the one token it answers", () => {
  it("reads the dominant axis and its sign, with screen y growing downward", () => {
    expect(swipeToTrickInput(-80, 0)).toBe("left");
    expect(swipeToTrickInput(80, 0)).toBe("right");
    expect(swipeToTrickInput(0, -80)).toBe("up");
    expect(swipeToTrickInput(0, 80)).toBe("down");
  });

  it("a diagonal drag still answers one direction, the dominant axis", () => {
    expect(swipeToTrickInput(-70, 40)).toBe("left");
    expect(swipeToTrickInput(30, -90)).toBe("up");
  });

  it("a drag shorter than the threshold answers nothing, so a tap's jitter is not a step", () => {
    expect(swipeToTrickInput(TRICK_SWIPE_MIN_PX - 1, 0)).toBeNull();
    expect(swipeToTrickInput(0, -(TRICK_SWIPE_MIN_PX - 1))).toBeNull();
    expect(swipeToTrickInput(0, 0)).toBeNull();
  });

  it("drives a whole trick containing vertical steps, which a lane swipe can never produce", () => {
    const flip: TrickSequence = { id: "flip", name: "flip", steps: ["up", "down", "up"], bonusMetres: 150 };
    let state = startTrick(flip);
    for (const [dx, dy] of [
      [0, -80],
      [0, 80],
      [0, -80],
    ] as const) {
      const input = swipeToTrickInput(dx, dy);
      if (input === null) throw new Error("expected a token");
      state = submitInput(state, input);
    }
    expect(state.outcome).toBe("done");
    expect(state.results).toEqual(["correct", "correct", "correct"]);
  });
});
