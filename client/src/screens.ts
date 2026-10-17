// Which full-screen surface is showing, and what that implies.
//
// The game used to have exactly one state worth naming — `running` — because
// everything that wasn't the road was a widget layered over it. With a title
// screen, a pause menu and three dedicated destinations, "what is on screen"
// and "is a run alive" are genuinely different questions, and conflating them
// is how a pause ends up recording a run or a menu ends up stealing arrow
// keys. So: one enum here, and `running` keeps its narrower meaning in
// main.ts (a run exists and has not crashed).

export type Screen =
  /** Waiting for GET /api/me. Nothing but the scene — see showsAttract below. */
  | "boot"
  /** A new player picking a name. The title screen waits behind this. */
  | "username"
  | "title"
  | "racing"
  | "paused"
  | "crew"
  | "shop"
  | "cosmetics";

/** The three destinations reached from the title screen's buttons. */
export const DESTINATIONS = ["crew", "shop", "cosmetics"] as const;
export type Destination = (typeof DESTINATIONS)[number];

/**
 * Whether the attract-mode demo is driving — the car steering itself down the
 * real road behind the menu, rather than a player driving it.
 *
 * True everywhere except an actual run, including `boot`, so the very first
 * frame is already the shot the title screen wants and there is no swing into
 * place once identity resolves.
 */
export function showsAttract(screen: Screen): boolean {
  return screen !== "racing" && screen !== "paused";
}

/** Whether the simulation should advance. Paused and crashed both say no. */
export function simulates(screen: Screen): boolean {
  return screen === "racing";
}

export interface ScreenElements {
  /** The race HUD: score, leaderboard, ghost labels, the crashed panel. */
  hud: HTMLElement;
  title: HTMLElement;
  username: HTMLElement;
  pause: HTMLElement;
  crew: HTMLElement;
  shop: HTMLElement;
  cosmetics: HTMLElement;
}

export class ScreenManager {
  #current: Screen = "boot";
  #elements: ScreenElements;
  #onChange: ((next: Screen, previous: Screen) => void) | undefined;

  constructor(
    elements: ScreenElements,
    onChange?: (next: Screen, previous: Screen) => void,
  ) {
    this.#elements = elements;
    this.#onChange = onChange;
    this.#apply();
  }

  get current(): Screen {
    return this.#current;
  }

  is(...screens: Screen[]): boolean {
    return screens.includes(this.#current);
  }

  go(next: Screen): void {
    if (next === this.#current) return;
    const previous = this.#current;
    this.#current = next;
    this.#apply();
    this.#onChange?.(next, previous);
  }

  #apply(): void {
    const s = this.#current;
    const e = this.#elements;
    // The HUD stays up while paused: the pause overlay sits on top of the
    // road rather than replacing it, so the run you are about to resume is
    // still visibly there behind it.
    e.hud.hidden = s !== "racing" && s !== "paused";
    e.pause.hidden = s !== "paused";
    e.title.hidden = s !== "title";
    e.username.hidden = s !== "username";
    e.crew.hidden = s !== "crew";
    e.shop.hidden = s !== "shop";
    e.cosmetics.hidden = s !== "cosmetics";
  }
}
