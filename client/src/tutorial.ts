// A dismissible guided tour that walks a new player through the game's
// menus (plan.md's "interactive tutorial"). No new rendering: it is a DOM
// overlay with a highlighted-border box around whatever it's pointing at —
// a true spotlight cutout mask was judged too heavy for what this needs to
// communicate.
//
// The tour drives screen navigation itself (via the `goToScreen` handler,
// which main.ts wires to `ScreenManager.go`) rather than asking the player
// to click there manually — reusing screens.ts's existing switch rather than
// reimplementing it.
import type { Screen } from "./screens.ts";
import { ModelPreview, type PreviewKind } from "./tutorial-model-preview.ts";

export interface TutorialStep {
  /** Screen to switch to for this step. `null` leaves whatever is on
   * screen alone (unused today, but keeps the shape honest for a future
   * step that doesn't need a switch). */
  screen: Screen | null;
  /** A `document.querySelector` target to highlight. Omitted for a step
   * describing something in the 3D scene rather than a DOM element (a
   * barrier, a moving barrier) — boxing the whole canvas wouldn't actually
   * highlight anything, so those steps show the caption with no spotlight
   * and let the live road itself do the showing. If given but nothing
   * matches (the element isn't in the DOM yet, or never will be), the
   * caption still shows — same no-box fallback. */
  targetSelector?: string;
  caption: string;
  /** When given, the caption panel grows a small turntable viewport
   * rendering the game's actual obstacle/pickup model (same factory
   * `main.ts` calls to build the live road) instead of describing it in
   * text alone. */
  preview?: PreviewKind;
}

const STEPS: TutorialStep[] = [
  {
    screen: "title",
    targetSelector: ".title-logo",
    caption:
      "Nightly Build is an endless drive: you race until you crash, and that crash point becomes " +
      "your best run of the day. The track is a fresh procedural generation every day, and everyone " +
      "races the same one. Everyone else's best run shows up as a ghost car on your road, so you " +
      "drive past other players rather than just checking a scoreboard. The day resets at UTC " +
      "midnight for everyone, so the track's lifetime is the same no matter where you're playing from.",
  },
  {
    screen: "title",
    targetSelector: ".title-buttons",
    caption: "Start a race, join a crew, or visit the shop and cosmetics from here.",
  },
  {
    screen: "crew",
    targetSelector: "#crewScreen .screen-inner",
    caption: "Form or join a crew: your crew's ghosts are what you race against on the road.",
  },
  {
    screen: "shop",
    targetSelector: ".shop-list",
    caption: "Spend coins earned from a day's top ten on new trim colours.",
  },
  {
    screen: "shop",
    targetSelector: ".shop-tricks",
    caption: "...and on tricks: each one shows the keystrokes it needs to land.",
  },
  {
    screen: "cosmetics",
    targetSelector: "#cosmeticsScreen .screen-inner",
    caption: "Wear a trim and equip a favorite trick (the one that plays when you hit a ramp).",
  },
  {
    screen: "racing",
    targetSelector: "#hud",
    caption: "This is the race HUD: your distance, coins, the leaderboard, and trick prompts on a ramp hit.",
  },
  {
    screen: "racing",
    preview: "barrier",
    caption:
      "Grey barriers block a lane outright. Crash into one and the run ends there. There's always at " +
      "least one open lane, so there's always a way through.",
  },
  {
    screen: "racing",
    preview: "moving-barrier",
    caption: "Some barriers slide sideways across the road. Same rule: dodge the lane it's actually in when you reach it.",
  },
  {
    screen: "racing",
    preview: "oil",
    caption:
      "An oil slick won't crash you outright: it forces a brief, uncommanded drift into the next lane. " +
      "Watch for what that drift carries you into.",
  },
  {
    screen: "racing",
    targetSelector: "#trickPrompt",
    preview: "ramp",
    caption:
      "Hit a ramp and a keystroke sequence pops up here: land it before the timer bar runs out for a " +
      "distance bonus and a few seconds of invincibility. Miss it and you just keep driving, no penalty.",
  },
  {
    screen: "racing",
    targetSelector: "#coinCount",
    preview: "coin",
    caption: "Coins trail through open lanes. Collect them as you pass, and spend the balance in the shop.",
  },
  {
    screen: "paused",
    targetSelector: ".pause-panel",
    caption: "Escape or the pause button brings up this menu mid-race.",
  },
];

/** `localStorage` key marking the tour as seen. The one piece of state in
 * this feature that isn't server-side — see plan.md's decisions-flagged
 * section: it means the tour re-triggers per-browser rather than per-account. */
const SEEN_KEY = "tutorial-seen";

export function hasSeenTutorial(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    // Private browsing / blocked storage: treat as unseen each load rather
    // than throwing, since a missing accessor is not this feature's problem
    // to solve.
    return false;
  }
}

function markTutorialSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Nothing to persist to; the tour just auto-offers again next load.
  }
}

export interface TutorialHandlers {
  /** Switches the visible screen — main.ts wires this to `ScreenManager.go`. */
  goToScreen(screen: Screen): void;
  /** Called once the tour ends, by Skip or by finishing the last step, so
   * main.ts can return to a sane resting screen. */
  onFinish(): void;
}

/** Clearance, in px, between the highlighted element's edge and the box
 * drawn around it. */
const SPOTLIGHT_PAD = 8;

export class Tutorial {
  #overlay: HTMLElement;
  #spotlight: HTMLElement;
  #caption: HTMLElement;
  #previewBox: HTMLElement;
  #preview: ModelPreview;
  #handlers: TutorialHandlers;
  #stepIndex = 0;
  #active = false;
  #rafHandle: number | undefined;

  constructor(root: HTMLElement, handlers: TutorialHandlers) {
    this.#overlay = root;
    this.#spotlight = root.querySelector(".tutorial-spotlight")!;
    this.#caption = root.querySelector(".tutorial-caption-text")!;
    this.#previewBox = root.querySelector(".tutorial-preview")!;
    this.#preview = new ModelPreview(root.querySelector(".tutorial-preview-canvas")!);
    this.#handlers = handlers;

    root.querySelector(".tutorial-next")!.addEventListener("click", () => this.#next());
    root.querySelector(".tutorial-skip")!.addEventListener("click", () => this.#finish());
    window.addEventListener("resize", () => this.#preview.resize());
  }

  get active(): boolean {
    return this.#active;
  }

  /** Starts the tour from its first step, every time — the "how to play"
   * button wires straight to this, bypassing the seen check that only gates
   * the auto-start on a new account. */
  start(): void {
    this.#active = true;
    this.#stepIndex = 0;
    this.#overlay.hidden = false;
    this.#showStep();
    this.#startTracking();
  }

  #showStep(): void {
    const step = STEPS[this.#stepIndex];
    if (!step) {
      this.#finish();
      return;
    }
    if (step.screen) this.#handlers.goToScreen(step.screen);
    this.#caption.textContent = step.caption;
    const lastStep = this.#stepIndex === STEPS.length - 1;
    const nextButton = this.#overlay.querySelector<HTMLButtonElement>(".tutorial-next")!;
    nextButton.textContent = lastStep ? "Done" : "Next";

    this.#previewBox.hidden = step.preview === undefined;
    if (step.preview !== undefined) {
      this.#preview.show(step.preview);
    } else {
      this.#preview.hide();
    }
  }

  /**
   * Re-measures the target every frame instead of once. A one-shot measure
   * right after switching screens races the destination's own data: crew,
   * shop and cosmetics all populate their cards from an async fetch
   * (`refresh()`, kicked off by the very `goToScreen` call `#showStep` just
   * made), which lands and reflows the panel well after the screen swap
   * itself. A single rAF was catching the stale, often-empty layout and
   * never updating once the real content arrived — the box then floated
   * over whatever was left at that now-wrong position. Continuous tracking
   * means a late reflow just nudges the box into place next frame instead.
   */
  #startTracking(): void {
    const tick = (): void => {
      if (!this.#active) return;
      this.#positionSpotlight();
      this.#rafHandle = requestAnimationFrame(tick);
    };
    tick();
  }

  #positionSpotlight(): void {
    const step = STEPS[this.#stepIndex];
    const target =
      step?.targetSelector !== undefined ? document.querySelector<HTMLElement>(step.targetSelector) : null;
    if (!target) {
      this.#spotlight.hidden = true;
      return;
    }
    const rect = target.getBoundingClientRect();
    // A `hidden` element (e.g. `#trickPrompt`/`#oilPopup` outside their own
    // active window) still matches the selector but lays out at zero size —
    // without this check the spotlight would collapse to a pinprick in the
    // corner instead of showing no box at all.
    if (rect.width === 0 || rect.height === 0) {
      this.#spotlight.hidden = true;
      return;
    }
    this.#spotlight.hidden = false;
    this.#spotlight.style.left = `${rect.left - SPOTLIGHT_PAD}px`;
    this.#spotlight.style.top = `${rect.top - SPOTLIGHT_PAD}px`;
    this.#spotlight.style.width = `${rect.width + SPOTLIGHT_PAD * 2}px`;
    this.#spotlight.style.height = `${rect.height + SPOTLIGHT_PAD * 2}px`;
  }

  #next(): void {
    this.#stepIndex++;
    this.#showStep();
  }

  #finish(): void {
    this.#active = false;
    this.#overlay.hidden = true;
    if (this.#rafHandle !== undefined) cancelAnimationFrame(this.#rafHandle);
    this.#rafHandle = undefined;
    this.#preview.hide();
    markTutorialSeen();
    this.#handlers.onFinish();
  }
}
