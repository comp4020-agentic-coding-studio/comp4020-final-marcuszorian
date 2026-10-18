// The Shop: spend coins on trim colours you don't own yet.
//
// Acquisition only. Equipping lives in cosmetics.ts, and the split is the
// point — "what can I buy" and "what am I wearing" were one list in the old
// garage widget, which meant the thing you just bought and the thing you
// already wear competed for the same row. Buying here hands the new skin to
// Cosmetics; it does not put it on the car.
//
// The server decides every one of these. A client that asks to unlock
// something it cannot afford gets a 402 whether or not this screen drew the
// button (ADR 0010).
import { getSkins, getTricks, unlockSkin, unlockTrick } from "./net.ts";
import type { Skin, Trick } from "./net.ts";
import { swatch } from "./skins.ts";

export interface ShopHandlers {
  /** A purchase landed: the balance moved and Cosmetics has a new row. */
  onPurchase(coins: number, skins: Skin[]): void;
  onBlip?(kind: "ok" | "error"): void;
}

export class Shop {
  #list: HTMLElement;
  #coins: HTMLElement;
  #empty: HTMLElement;
  #status: HTMLElement;
  #handlers: ShopHandlers;
  #busy = false;

  // Tricks are a second catalogue on the same screen (doc/adr/0013) — owning
  // one is the only state, so unlike skins there is no equip step and
  // nothing downstream (cosmetics.ts) needs to hear about a purchase.
  #trickList: HTMLElement;
  #trickEmpty: HTMLElement;
  #trickBusy = false;

  constructor(root: HTMLElement, handlers: ShopHandlers) {
    this.#list = root.querySelector(".shop-list")!;
    this.#coins = root.querySelector(".shop-coins")!;
    this.#empty = root.querySelector(".shop-empty")!;
    this.#status = root.querySelector(".shop-status")!;
    this.#trickList = root.querySelector(".shop-tricks")!;
    this.#trickEmpty = root.querySelector(".shop-tricks-empty")!;
    this.#handlers = handlers;
  }

  async refresh(): Promise<void> {
    try {
      const { coins, skins } = await getSkins();
      this.render(coins, skins);
    } catch {
      // Leave whatever was there; a failed read isn't worth a message.
    }
    try {
      const { coins, tricks } = await getTricks();
      this.renderTricks(coins, tricks);
    } catch {
      // Same best-effort shape as the skins read above.
    }
  }

  /** Also called from outside when a payout or a purchase moves the balance. */
  render(coins: number, skins: Skin[]): void {
    this.#coins.textContent = String(coins);
    this.#list.textContent = "";

    // Only what you don't own: a shop that keeps listing things you bought is
    // a wardrobe, and that is the next screen along.
    const forSale = skins.filter((s) => !s.owned);
    this.#empty.hidden = forSale.length > 0;
    this.#list.hidden = forSale.length === 0;

    for (const skin of forSale) this.#list.append(this.#row(skin, coins));
  }

  #row(skin: Skin, coins: number): HTMLLIElement {
    const row = document.createElement("li");
    row.className = "skin-row";

    const name = document.createElement("span");
    name.className = "skin-name";
    name.textContent = skin.name; // textContent, not innerHTML — the habit is the point

    const buy = document.createElement("button");
    buy.type = "button";
    buy.className = "screen-action skin-buy";
    buy.textContent = `${skin.cost}`;
    const affordable = coins >= skin.cost;
    buy.disabled = !affordable;
    buy.title = affordable ? `unlock for ${skin.cost} coins` : `costs ${skin.cost} coins`;
    buy.addEventListener("click", () => void this.#unlock(skin));

    row.append(swatch(skin.id), name, buy);
    return row;
  }

  async #unlock(skin: Skin): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const { coins, skins } = await unlockSkin(skin.id);
      this.render(coins, skins);
      this.#handlers.onPurchase(coins, skins);
      this.#say(`${skin.name} unlocked — wear it in cosmetics`, "ok");
    } catch (err) {
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

  /** Also called from outside when a payout or a purchase moves the balance
   * (same contract as `render`'s own comment). */
  renderTricks(coins: number, tricks: Trick[]): void {
    this.#trickList.textContent = "";

    // Same "only what you don't own" rule as skins — a trick you already
    // have is just in the pool a ramp draws from, not a shop listing.
    const forSale = tricks.filter((t) => !t.owned);
    this.#trickEmpty.hidden = forSale.length > 0;
    this.#trickList.hidden = forSale.length === 0;

    for (const trick of forSale) this.#trickList.append(this.#trickRow(trick, coins));
  }

  #trickRow(trick: Trick, coins: number): HTMLLIElement {
    const row = document.createElement("li");
    row.className = "skin-row trick-row";

    const name = document.createElement("span");
    name.className = "skin-name";
    name.textContent = `${trick.name} (+${trick.bonus_metres}m)`;

    const buy = document.createElement("button");
    buy.type = "button";
    buy.className = "screen-action skin-buy";
    buy.textContent = `${trick.cost}`;
    const affordable = coins >= trick.cost;
    buy.disabled = !affordable;
    buy.title = affordable ? `unlock for ${trick.cost} coins` : `costs ${trick.cost} coins`;
    buy.addEventListener("click", () => void this.#unlockTrick(trick));

    row.append(name, buy);
    return row;
  }

  async #unlockTrick(trick: Trick): Promise<void> {
    if (this.#trickBusy) return;
    this.#trickBusy = true;
    try {
      const { coins, tricks } = await unlockTrick(trick.id);
      this.renderTricks(coins, tricks);
      this.#say(`${trick.name} unlocked`, "ok");
    } catch (err) {
      this.#say((err as Error).message, "error");
    } finally {
      this.#trickBusy = false;
    }
  }
}
