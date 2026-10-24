// Cosmetics: pick which trim you're wearing, and which trick plays on a ramp
// hit, from the ones you own.
//
// The free magenta default always appears in the trim list and is always
// wearable — it is the one trim nobody has to buy, which is exactly why it
// is not a row in the `skins` table (ADR 0010) and has to be synthesised
// into the list. The free default trick (doc/adr/0013/0018) gets the same
// treatment in the tricks section below.
//
// Equipping a trim repaints the hero car on the title screen immediately,
// because both are the same object in the same scene. That is the whole
// reason this is a screen rather than a dialog: you pick a colour and watch
// it land on the car you are looking at. Equipping a trick has no such
// visual echo here — it only changes what plays on the next ramp hit.
import { equipSkin, equipTrick, getSkins, getTricks } from "./net.ts";
import type { Skin, Trick } from "./net.ts";
import { DEFAULT_SKIN_ID, defaultSkinRow, swatch } from "./skins.ts";
import { DEFAULT_TRICK, trickGlyphSequence } from "./trick.ts";
import type { TrickInput } from "./trick.ts";

export interface CosmeticsHandlers {
  /** Repaint the car. `null` is the free default. */
  onTrimChange(skinId: string | null): void;
  onBlip?(kind: "ok" | "error"): void;
}

/** The free default trick, shaped like a catalogue row (mirrors
 * `defaultSkinRow`) so the tricks section can render it with the same code
 * as everything else. `equipped` is true exactly when no owned trick is. */
function defaultTrickRow(tricks: Trick[]): Trick {
  return {
    id: DEFAULT_TRICK.id,
    name: DEFAULT_TRICK.name,
    sequence: JSON.stringify(DEFAULT_TRICK.steps),
    bonus_metres: DEFAULT_TRICK.bonusMetres,
    cost: 0,
    owned: true,
    equipped: !tricks.some((t) => t.equipped),
  };
}

export class Cosmetics {
  #list: HTMLElement;
  #status: HTMLElement;
  #hint: HTMLElement;
  #handlers: CosmeticsHandlers;
  #busy = false;

  // A second catalogue section on this screen, mirroring the trim list above
  // (doc/adr/0018) — same row shape, same equip-one-of-several behaviour,
  // just no car repaint on change.
  #trickList: HTMLElement;
  #trickStatus: HTMLElement;
  #trickBusy = false;

  constructor(root: HTMLElement, handlers: CosmeticsHandlers) {
    this.#list = root.querySelector(".cosmetics-list")!;
    this.#status = root.querySelector(".cosmetics-status")!;
    this.#hint = root.querySelector(".cosmetics-hint")!;
    this.#trickList = root.querySelector(".cosmetics-tricks")!;
    this.#trickStatus = root.querySelector(".cosmetics-trick-status")!;
    this.#handlers = handlers;
  }

  async refresh(): Promise<void> {
    try {
      const { skins } = await getSkins();
      this.render(skins);
    } catch {
      // Leave whatever was there; a failed read isn't worth a message.
    }
    try {
      const { tricks } = await getTricks();
      this.renderTricks(tricks);
    } catch {
      // Same best-effort shape as the skins read above.
    }
  }

  /** Also called from outside when a purchase adds a row here. */
  render(skins: Skin[]): void {
    this.#list.textContent = "";
    const owned = [defaultSkinRow(skins), ...skins.filter((s) => s.owned)];
    for (const skin of owned) this.#list.append(this.#row(skin));

    this.#hint.hidden = owned.length > 1;
  }

  #row(skin: Skin): HTMLLIElement {
    const row = document.createElement("li");
    row.className = skin.equipped ? "skin-row is-equipped" : "skin-row";

    const name = document.createElement("span");
    name.className = "skin-name";
    name.textContent = skin.name;

    const action = document.createElement("button");
    action.type = "button";
    action.className = "screen-action";
    if (skin.equipped) {
      action.textContent = "worn";
      action.disabled = true;
    } else {
      action.textContent = "wear";
      action.addEventListener("click", () =>
        void this.#equip(skin.id === DEFAULT_SKIN_ID ? null : skin.id),
      );
    }

    row.append(swatch(skin.id), name, action);
    return row;
  }

  async #equip(id: string | null): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const { equipped, skins } = await equipSkin(id);
      this.#handlers.onTrimChange(equipped);
      this.render(skins);
      this.#say(equipped ? "Trim changed" : "Back to magenta", "ok");
    } catch (err) {
      // A 403 here means the server says you don't own it — the real check,
      // which this screen's own filtering is only a convenience over.
      this.#say((err as Error).message, "error");
    } finally {
      this.#busy = false;
    }
  }

  /** Also called from outside when a purchase adds a row here (same
   * contract as `render`'s own comment). */
  renderTricks(tricks: Trick[]): void {
    this.#trickList.textContent = "";
    const owned = [defaultTrickRow(tricks), ...tricks.filter((t) => t.owned)];
    for (const trick of owned) this.#trickList.append(this.#trickRow(trick));
  }

  #trickRow(trick: Trick): HTMLLIElement {
    const row = document.createElement("li");
    row.className = trick.equipped ? "skin-row trick-row is-equipped" : "skin-row trick-row";

    const name = document.createElement("span");
    name.className = "skin-name";
    name.textContent = trick.name;

    const glyphs = document.createElement("span");
    glyphs.className = "trick-glyphs";
    glyphs.textContent = trickGlyphSequence(JSON.parse(trick.sequence) as TrickInput[]);

    const action = document.createElement("button");
    action.type = "button";
    action.className = "screen-action";
    if (trick.equipped) {
      action.textContent = "equipped";
      action.disabled = true;
    } else {
      action.textContent = "equip";
      action.addEventListener("click", () =>
        void this.#equipTrick(trick.id === DEFAULT_TRICK.id ? null : trick.id),
      );
    }

    row.append(name, glyphs, action);
    return row;
  }

  async #equipTrick(id: string | null): Promise<void> {
    if (this.#trickBusy) return;
    this.#trickBusy = true;
    try {
      const { tricks } = await equipTrick(id);
      this.renderTricks(tricks);
      this.#sayTrick(id ? "Trick equipped" : "Back to the default", "ok");
    } catch (err) {
      // A 403 here means the server says you don't own it — the real check,
      // which this screen's own filtering is only a convenience over.
      this.#sayTrick((err as Error).message, "error");
    } finally {
      this.#trickBusy = false;
    }
  }

  #say(text: string, kind: "ok" | "error"): void {
    this.#status.textContent = text;
    this.#status.dataset.kind = kind;
    this.#handlers.onBlip?.(kind);
  }

  #sayTrick(text: string, kind: "ok" | "error"): void {
    this.#trickStatus.textContent = text;
    this.#trickStatus.dataset.kind = kind;
    this.#handlers.onBlip?.(kind);
  }
}
