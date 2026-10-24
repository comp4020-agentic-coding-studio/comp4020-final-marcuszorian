// The Join Crew screen: create a crew, or see the one you're in and copy its
// invite link. Previously the lower half of the garage widget; now its own
// destination off the title screen.
//
// Everything here is a request the server decides on. The UI hides what you
// can't do, but `routes/crews.ts` refuses it regardless — a full invite is a
// 410 whether or not this screen drew a button (ADR 0011).
import { createCrew, getMyCrew, joinCrew } from "./net.ts";
import type { Crew } from "./net.ts";

export interface CrewScreenHandlers {
  /** Membership changed: the road re-scopes and the leaderboard re-tabs. */
  onCrewChange(crew: Crew | null): void;
  onBlip?(kind: "ok" | "error"): void;
}

export class CrewScreen {
  #body: HTMLElement;
  #status: HTMLElement;
  #handlers: CrewScreenHandlers;
  #crew: Crew | null = null;
  #signedIn = false;
  #busy = false;

  constructor(root: HTMLElement, handlers: CrewScreenHandlers) {
    this.#body = root.querySelector(".crew-body")!;
    this.#status = root.querySelector(".crew-status")!;
    this.#handlers = handlers;
  }

  get crew(): Crew | null {
    return this.#crew;
  }

  async setSignedIn(signedIn: boolean): Promise<void> {
    this.#signedIn = signedIn;
    if (signedIn) await this.refresh();
    else this.#render();
  }

  async refresh(): Promise<void> {
    try {
      this.#setCrew(await getMyCrew());
    } catch {
      // A failed read leaves the screen as it was; not worth a message.
    }
  }

  /**
   * Joins by invite token. Public because main.ts calls it for a
   * `/crew/<token>` URL, which may have to wait for the username prompt —
   * the same deferred-until-signed-in shape postRunEnd already uses.
   */
  async join(token: string): Promise<void> {
    try {
      const { crew } = await joinCrew(token);
      this.#setCrew(crew);
      this.#say(`Joined ${crew.name}`, "ok");
    } catch (err) {
      // An expired or full link is a real answer, not a failure to show.
      this.#say((err as Error).message, "error");
    }
  }

  #setCrew(crew: Crew | null): void {
    const changed = (crew?.id ?? null) !== (this.#crew?.id ?? null);
    this.#crew = crew;
    this.#render();
    if (changed) this.#handlers.onCrewChange(crew);
  }

  #say(text: string, kind: "ok" | "error"): void {
    this.#status.textContent = text;
    this.#status.dataset.kind = kind;
    this.#handlers.onBlip?.(kind);
  }

  #render(): void {
    this.#body.textContent = "";
    if (!this.#signedIn) return;
    this.#body.append(this.#crew ? this.#memberView(this.#crew) : this.#emptyView());
  }

  #emptyView(): DocumentFragment {
    const frag = document.createDocumentFragment();

    const hint = document.createElement("p");
    hint.className = "screen-hint";
    // Says what joining actually DOES, because it is not obvious and it is
    // not reversible by a toggle: the road narrows unconditionally (ADR 0011).
    hint.textContent =
      "You have no crew, so every driver's ghost shares your road. Make one and send the link to a few people: once you are in a crew, only your crew's ghosts appear on the road you drive.";

    const form = document.createElement("form");
    form.className = "crew-form";

    const input = document.createElement("input");
    input.maxLength = 32;
    input.required = true;
    input.placeholder = "crew name";
    input.setAttribute("aria-label", "crew name");

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "screen-action";
    submit.textContent = "create crew";

    form.append(input, submit);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (name) void this.#create(name);
    });

    frag.append(hint, form);
    return frag;
  }

  #memberView(crew: Crew): DocumentFragment {
    const frag = document.createDocumentFragment();

    const name = document.createElement("p");
    name.className = "crew-name";
    name.textContent = crew.name;

    const meta = document.createElement("p");
    meta.className = "screen-hint";
    const members = crew.memberCount === 1 ? "1 member" : `${crew.memberCount} members`;
    // Both numbers, because they answer different questions and the schema
    // comment says they look interchangeable and aren't: membership is who is
    // on your road; joins-ever is what the invite's cap counts against.
    const uses =
      crew.maxJoins === null ? `${crew.joinCount} joins` : `${crew.joinCount}/${crew.maxJoins} joins`;
    meta.textContent = `${members} · ${uses}${crew.open ? "" : " · invite closed"}`;

    const roster = document.createElement("ul");
    roster.className = "crew-members";
    for (const username of crew.members) {
      const item = document.createElement("li");
      item.textContent = username;
      roster.append(item);
    }

    const url = crew.inviteUrl ?? `${location.origin}/crew/${crew.inviteToken}`;

    const link = document.createElement("p");
    link.className = "crew-link";
    link.textContent = url; // visible regardless, so a refused clipboard still leaves something to copy

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "screen-action";
    copy.textContent = "copy invite link";
    copy.addEventListener("click", () => {
      // Clipboard access can be refused (insecure origin, permissions), and
      // the link is on screen either way — so a refusal is a quieter message,
      // not a failure.
      const refused = (): void => this.#say("Couldn't copy: the link is above", "error");
      const clipboard = navigator.clipboard;
      if (!clipboard) return refused();
      void clipboard.writeText(url).then(() => this.#say("Invite link copied", "ok"), refused);
    });

    frag.append(name, meta, roster, link, copy);
    return frag;
  }

  async #create(name: string): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const { crew, inviteUrl } = await createCrew(name);
      this.#setCrew({ ...crew, inviteUrl });
      this.#say("Crew created: share the link", "ok");
    } catch (err) {
      this.#say((err as Error).message, "error");
    } finally {
      this.#busy = false;
    }
  }
}
