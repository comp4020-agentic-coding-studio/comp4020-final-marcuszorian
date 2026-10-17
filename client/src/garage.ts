// The garage: your coin balance and the trim colours it buys (ADR 0010), and
// your crew and its invite link (ADR 0011). One panel, because they are the
// two things about *you* rather than about the road, and two disclosures in
// the same corner would be two things to collapse.
//
// Everything here is a request to the server, which decides. The buttons are
// hidden when an action isn't available, but that is a convenience, not the
// enforcement — `routes/skins.ts` and `routes/crews.ts` refuse the same
// actions when a client asks for them anyway.
import {
  createCrew,
  equipSkin,
  getMyCrew,
  getSkins,
  joinCrew,
  unlockSkin,
} from "./net.ts";
import type { Crew, Skin } from "./net.ts";
import { palette } from "./palette.ts";
import type { PaletteKey } from "./palette.ts";

/**
 * A skin's id IS a palette token key (ADR 0010) — the id 'gold' is
 * palette.gold. Nothing maps names to hex values, so nothing can drift out of
 * step with the palette.
 */
export function skinColor(id: string | null): number {
  if (id && id in palette) return palette[id as PaletteKey].three;
  return palette.magenta.three; // the free default
}

export interface GarageHandlers {
  /** A skin was equipped (or cleared) — repaint the car. */
  onTrimChange(skinId: string | null): void;
  /** Crew membership changed: the road has to re-scope and the panel re-tab. */
  onCrewChange(crew: Crew | null): void;
  /** Short-lived status text, shown in the panel rather than an alert(). */
  onBlip?(kind: "ok" | "error"): void;
}

export class Garage {
  #root: HTMLElement;
  #coins: HTMLElement;
  #skinList: HTMLElement;
  #crewBody: HTMLElement;
  #status: HTMLElement;
  #handlers: GarageHandlers;
  #signedIn = false;
  #crew: Crew | null = null;
  #busy = false;

  constructor(root: HTMLElement, handlers: GarageHandlers) {
    this.#root = root;
    this.#handlers = handlers;
    this.#coins = root.querySelector(".garage-coins")!;
    this.#skinList = root.querySelector(".garage-skins")!;
    this.#crewBody = root.querySelector(".garage-crew")!;
    this.#status = root.querySelector(".garage-status")!;
  }

  /**
   * Called once the server has said who we are. Before that the panel stays
   * hidden: a coin balance and a crew are things only an account has, and
   * showing an empty shop to someone who hasn't picked a name yet is noise
   * behind a modal they can't dismiss.
   */
  async setSignedIn(signedIn: boolean): Promise<void> {
    this.#signedIn = signedIn;
    this.#root.hidden = !signedIn;
    if (!signedIn) return;
    await Promise.all([this.refreshSkins(), this.refreshCrew()]);
  }

  async refreshSkins(): Promise<void> {
    try {
      const { coins, skins } = await getSkins();
      this.#renderSkins(coins, skins);
    } catch {
      // Leave whatever was there; a failed read isn't worth a message.
    }
  }

  async refreshCrew(): Promise<void> {
    try {
      this.#setCrew(await getMyCrew());
    } catch {
      // as above
    }
  }

  get crew(): Crew | null {
    return this.#crew;
  }

  #setCrew(crew: Crew | null): void {
    const changed = (crew?.id ?? null) !== (this.#crew?.id ?? null);
    this.#crew = crew;
    this.#renderCrew();
    if (changed) this.#handlers.onCrewChange(crew);
  }

  /**
   * Joins by invite token. Public because `main.ts` calls it for a
   * `/crew/<token>` URL, which may have to wait for the username modal — the
   * same deferred-until-signed-in shape postRunEnd already uses.
   */
  async join(token: string): Promise<void> {
    try {
      const { crew } = await joinCrew(token);
      this.#setCrew(crew);
      this.#say(`joined ${crew.name}`, "ok");
    } catch (err) {
      // An expired or full link is a real answer, not a failure to show.
      this.#say((err as Error).message, "error");
    }
  }

  #say(text: string, kind: "ok" | "error"): void {
    this.#status.textContent = text;
    this.#status.dataset.kind = kind;
    this.#handlers.onBlip?.(kind);
  }

  #renderSkins(coins: number, skins: Skin[]): void {
    this.#coins.textContent = String(coins);
    this.#skinList.textContent = "";

    // The free default first, and always equippable — it is the one trim
    // nobody has to buy, which is why it is not a row in the `skins` table.
    this.#skinList.append(
      this.#skinRow(
        { id: "default", name: "magenta trim", cost: 0, owned: true, equipped: !skins.some((s) => s.equipped) },
        coins,
      ),
    );
    for (const skin of skins) this.#skinList.append(this.#skinRow(skin, coins));
  }

  #skinRow(skin: Skin, coins: number): HTMLLIElement {
    const row = document.createElement("li");
    row.className = skin.equipped ? "garage-skin is-equipped" : "garage-skin";

    const swatch = document.createElement("span");
    swatch.className = "garage-swatch";
    const hex = skin.id === "default" ? palette.magenta.hex : skinHex(skin.id);
    swatch.style.background = hex;
    swatch.style.boxShadow = `0 0 8px ${hex}`;

    const name = document.createElement("span");
    name.className = "garage-skin-name";
    name.textContent = skin.name; // textContent: names come from the catalogue, but the habit is the point

    const action = document.createElement("button");
    action.type = "button";
    action.className = "garage-action";
    if (skin.equipped) {
      action.textContent = "worn";
      action.disabled = true;
    } else if (skin.owned) {
      action.textContent = "wear";
      action.addEventListener("click", () => void this.#equip(skin.id === "default" ? null : skin.id));
    } else {
      action.textContent = `${skin.cost}`;
      action.className = "garage-action garage-buy";
      action.disabled = coins < skin.cost;
      action.title = coins < skin.cost ? `costs ${skin.cost} coins` : `unlock for ${skin.cost} coins`;
      action.addEventListener("click", () => void this.#unlock(skin.id));
    }

    row.append(swatch, name, action);
    return row;
  }

  async #equip(id: string | null): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const { equipped, skins } = await equipSkin(id);
      this.#handlers.onTrimChange(equipped);
      this.#renderSkins(Number(this.#coins.textContent ?? 0), skins);
      this.#say(equipped ? "trim changed" : "back to magenta", "ok");
    } catch (err) {
      this.#say((err as Error).message, "error");
    } finally {
      this.#busy = false;
    }
  }

  async #unlock(id: string): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const { coins, skins } = await unlockSkin(id);
      this.#renderSkins(coins, skins);
      this.#say("unlocked — press wear", "ok");
    } catch (err) {
      this.#say((err as Error).message, "error");
    } finally {
      this.#busy = false;
    }
  }

  #renderCrew(): void {
    this.#crewBody.textContent = "";
    if (!this.#signedIn) return;

    if (!this.#crew) {
      const hint = document.createElement("p");
      hint.className = "garage-hint";
      hint.textContent = "no crew — ghosts on your road are everyone's";

      const form = document.createElement("form");
      form.className = "garage-crew-form";
      const input = document.createElement("input");
      input.maxLength = 32;
      input.required = true;
      input.placeholder = "crew name";
      input.setAttribute("aria-label", "crew name");
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "garage-action";
      submit.textContent = "create";
      form.append(input, submit);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (name) void this.#create(name);
      });

      this.#crewBody.append(hint, form);
      return;
    }

    const name = document.createElement("p");
    name.className = "garage-crew-name";
    name.textContent = this.#crew.name;

    const meta = document.createElement("p");
    meta.className = "garage-hint";
    const members = this.#crew.memberCount === 1 ? "1 member" : `${this.#crew.memberCount} members`;
    // Both numbers, because they answer different questions and the schema
    // comment says they look interchangeable and aren't: membership is who is
    // on your road, joins-ever is what the invite's cap counts against.
    const uses =
      this.#crew.maxJoins === null
        ? `${this.#crew.joinCount} joins`
        : `${this.#crew.joinCount}/${this.#crew.maxJoins} joins`;
    meta.textContent = `${members} · ${uses}${this.#crew.open ? "" : " · invite closed"}`;

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "garage-action garage-invite";
    copy.textContent = "copy invite link";
    const url = this.#crew.inviteUrl ?? `${location.origin}/crew/${this.#crew.inviteToken}`;
    copy.addEventListener("click", () => {
      // Clipboard access can be refused (insecure origin, permissions); fall
      // back to showing the link rather than failing silently.
      navigator.clipboard
        ?.writeText(url)
        .then(() => this.#say("invite link copied", "ok"))
        .catch(() => this.#say(url, "ok")) ?? this.#say(url, "ok");
    });

    this.#crewBody.append(name, meta, copy);
  }

  async #create(name: string): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const { crew, inviteUrl } = await createCrew(name);
      this.#setCrew({ ...crew, inviteUrl });
      this.#say("crew created — share the link", "ok");
    } catch (err) {
      this.#say((err as Error).message, "error");
    } finally {
      this.#busy = false;
    }
  }
}

function skinHex(id: string): string {
  return id in palette ? palette[id as PaletteKey].hex : palette.magenta.hex;
}
