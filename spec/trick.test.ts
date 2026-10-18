import { describe, expect, it } from "vitest";
import { advanceTrick, startTrick, STEP_TIMEOUT_SECONDS, submitInput } from "../client/src/trick.ts";
import type { TrickSequence } from "../client/src/trick.ts";

// Pure state-machine tests for the QTE a ramp starts (doc/adr/0013) — same
// client-module-direct style as spec/trim.test.ts, since nothing here needs
// three.js or HTTP.
const sequence: TrickSequence = { id: "test", name: "test trick", steps: ["up", "down", "left"], bonusMetres: 50 };

describe("a correct full sequence completes", () => {
  it("advances through every step and lands on done", () => {
    let state = startTrick(sequence);
    expect(state.active).toBe(true);
    expect(state.outcome).toBe("prompt");

    state = submitInput(state, "up");
    expect(state.outcome).toBe("ok");
    expect(state.active).toBe(true);

    state = advanceTrick(state, 0.01); // "ok" settles back to "prompt" for the next step
    expect(state.outcome).toBe("prompt");
    expect(state.stepIndex).toBe(1);

    state = submitInput(state, "down");
    state = advanceTrick(state, 0.01);
    expect(state.stepIndex).toBe(2);

    state = submitInput(state, "left");
    expect(state.outcome).toBe("done");
    expect(state.active).toBe(false);
  });
});

describe("a wrong input ends the sequence", () => {
  it("sets outcome to error and stops, without crediting a bonus", () => {
    let state = startTrick(sequence);
    state = submitInput(state, "down"); // sequence expects "up" first
    expect(state.outcome).toBe("error");
    expect(state.active).toBe(false);
  });
});

describe("a timed-out step ends the sequence the same way a wrong input does", () => {
  it("sets outcome to error once the step timer exceeds STEP_TIMEOUT_SECONDS", () => {
    let state = startTrick(sequence);
    state = advanceTrick(state, STEP_TIMEOUT_SECONDS + 0.01);
    expect(state.outcome).toBe("error");
    expect(state.active).toBe(false);
  });
});

describe("input is ignored outside an active prompt", () => {
  it("no-ops on a settled (inactive) state", () => {
    let state = startTrick(sequence);
    state = submitInput(state, "down"); // wrong — settles to error
    const settled = state;
    state = submitInput(state, "up");
    expect(state).toEqual(settled);
  });

  it("no-ops during the one-frame 'ok' pulse between steps", () => {
    let state = startTrick(sequence);
    state = submitInput(state, "up"); // correct, not final — outcome becomes "ok"
    const pulse = state;
    state = submitInput(state, "down"); // would be correct for the *next* step, but "ok" isn't a prompt
    expect(state).toEqual(pulse);
  });
});
