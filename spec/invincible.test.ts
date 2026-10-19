import { describe, expect, it } from "vitest";
import { createCar, INVINCIBLE_SECONDS, stepCar } from "../client/src/car.ts";
import type { Obstacle } from "../client/src/track.ts";

// Post-trick invincibility (doc/adr/0017): while `invincibleT` is above zero a
// barrier no longer crashes the car, but coins, oil and ramps behave as they
// always did. Pure `stepCar` tests, same client-module-direct style as
// spec/trick.test.ts — no three.js, no HTTP.
const barrierAt = (distance: number, kind: "barrier" | "moving-barrier" = "barrier"): Obstacle => ({
  kind,
  lane: 0,
  x: 0,
  z: -distance,
});

describe("a barrier crashes the car unless it is invincible", () => {
  it("crashes into a barrier at the car's position when not invincible", () => {
    const car = createCar();
    car.distance = 100;
    expect(stepCar(car, 0, [barrierAt(100)]).crashed).toBe(true);
    expect(car.crashed).toBe(true);
  });

  it("passes through the same barrier while invincibleT is above zero", () => {
    const car = createCar();
    car.distance = 100;
    car.invincibleT = INVINCIBLE_SECONDS;
    const result = stepCar(car, 0, [barrierAt(100)]);
    expect(result.crashed).toBe(false);
    expect(car.crashed).toBe(false);
  });

  it("passes through a moving barrier too", () => {
    const car = createCar();
    car.distance = 100;
    car.invincibleT = 0.5;
    expect(stepCar(car, 0, [barrierAt(100, "moving-barrier")]).crashed).toBe(false);
  });

  it("is mortal again the moment invincibleT reaches zero", () => {
    const car = createCar();
    car.distance = 100;
    car.invincibleT = 0;
    expect(stepCar(car, 0, [barrierAt(100)]).crashed).toBe(true);
  });
});

describe("invincibility only lets barriers through", () => {
  it("still collects a coin in the car's lane", () => {
    const car = createCar();
    car.distance = 100;
    car.invincibleT = INVINCIBLE_SECONDS;
    const coin: Obstacle = { kind: "coin", lane: 0, x: 0, z: -100 };
    expect(stepCar(car, 0, [coin]).coinsCollected).toEqual([-100]);
  });

  it("still starts a forced drift on oil", () => {
    const car = createCar();
    car.distance = 100;
    car.invincibleT = INVINCIBLE_SECONDS;
    const oil: Obstacle = { kind: "oil", lane: 0, x: 0, z: -100 };
    stepCar(car, 0, [oil]);
    expect(car.driftT).toBeLessThan(0.5); // mid-drift: driftT only starts below OIL_SLIDE_SECONDS
  });

  it("starts with no invincibility on a fresh car", () => {
    expect(createCar().invincibleT).toBe(0);
  });
});
