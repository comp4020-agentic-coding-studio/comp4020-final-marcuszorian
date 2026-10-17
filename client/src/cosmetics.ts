// Cosmetics: pick which trim you're wearing, from the ones you own.
//
// The free magenta default always appears here and is always wearable — it is
// the one trim nobody has to buy, which is exactly why it is not a row in the
// `skins` table (ADR 0010) and has to be synthesised into the list.
//
// Equipping repaints the hero car on the title screen immediately, because
// both are the same object in the same scene. That is the whole reason this
// is a screen rather than a dialog: you pick a colour and watch it land on
// the car you are looking at.
import { equipSkin, getSkins } from "./net.ts";
import type { Skin } from "./net.ts";
import { DEFAULT_SKIN_ID, defaultSkinRow, swatch } from "./skins.ts";

export interface CosmeticsHandlers {
  /** Repaint the car. `null` is the free default. */
  onTrimChange(skinId: string | null): void;
  onBlip?(kind: "ok" | "error"): void;
}

export class Cosmetics {
  #list: HTMLElement;
  #status: HTMLElement;
  #hint: HTMLElement;
  #handlers: CosmeticsHandlers;
  #busy = false;

  constructor(root: HTMLElement, handlers: CosmeticsHandlers) {
    this.#list = root.querySelector(".cosmetics-list")!;
    this.#status = root.querySelector(".cosmetics-status")!;
    this.#hint = root.querySelector(".cosmetics-hint")!;
    this.#handlers = handlers;
  }

  async refresh(): Promise<void> {
    try {
      const { skins } = await getSkins();
      this.render(skins);
    } catch {
      // Leave whatever was there; a failed read isn't worth a message.
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
      this.#say(equipped ? "trim changed" : "back to magenta", "ok");
    } catch (err) {
      // A 403 here means the server says you don't own it — the real check,
      // which this screen's own filtering is only a convenience over.
      this.#say((err as Error).message, "error");
    } finally {
      this.#busy = false;
    }
  }

  #say(text: string, kind: "ok" | "error"): void {
    this.#status.textContent = text;
    this.#status.dataset.kind = kind;
    this.#handlers.onBlip?.(kind);
  }
}
