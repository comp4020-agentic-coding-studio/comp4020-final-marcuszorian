// One settings menu, reachable from every screen.
//
// This replaces the two standalone pills that used to sit in the bottom-right
// corner during a race ("reduce effects" and "mute sound"). Neither setting
// changed; they are just behind one gear now instead of being two permanent
// pieces of furniture over the road. Nothing new was added — a settings menu
// with two items in it is honest about what the game actually has to
// configure.
//
// The toggles still own no state themselves: PostFX and AudioEngine remain
// the source of truth, and this reads them on every open.

export interface SettingsHandlers {
  isEffectsReduced(): boolean;
  setEffectsReduced(reduced: boolean): void;
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  onBlip?(): void;
}

export class SettingsMenu {
  #panel: HTMLElement;
  #button: HTMLButtonElement;
  #effects: HTMLButtonElement;
  #sound: HTMLButtonElement;
  #handlers: SettingsHandlers;

  constructor(root: HTMLElement, handlers: SettingsHandlers) {
    this.#handlers = handlers;
    this.#button = root.querySelector("#settingsButton")!;
    this.#panel = root.querySelector("#settingsPanel")!;
    this.#effects = root.querySelector("#fxToggle")!;
    this.#sound = root.querySelector("#soundToggle")!;

    this.#button.addEventListener("click", () => this.toggle());
    this.#effects.addEventListener("click", () => {
      this.#handlers.setEffectsReduced(!this.#handlers.isEffectsReduced());
      this.sync();
      this.#handlers.onBlip?.();
    });
    this.#sound.addEventListener("click", () => {
      this.#handlers.setMuted(!this.#handlers.isMuted());
      this.sync();
      this.#handlers.onBlip?.();
    });

    // Clicking away closes it. Captured on the document rather than via a
    // backdrop element, because a backdrop over the whole viewport would eat
    // swipes meant for the road — the exact trap #ghostLabels fell into.
    document.addEventListener("pointerdown", (e) => {
      if (!this.open) return;
      const target = e.target as Node;
      if (this.#panel.contains(target) || this.#button.contains(target)) return;
      this.close();
    });

    this.sync();
  }

  get open(): boolean {
    return !this.#panel.hidden;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    this.sync();
    this.#panel.hidden = false;
    this.#button.setAttribute("aria-expanded", "true");
  }

  close(): void {
    this.#panel.hidden = true;
    this.#button.setAttribute("aria-expanded", "false");
  }

  /** Re-reads both settings from the systems that own them. */
  sync(): void {
    const reduced = this.#handlers.isEffectsReduced();
    this.#effects.setAttribute("aria-pressed", String(reduced));
    this.#effects.textContent = reduced ? "effects reduced" : "reduce effects";

    const muted = this.#handlers.isMuted();
    this.#sound.setAttribute("aria-pressed", String(muted));
    this.#sound.textContent = muted ? "sound muted" : "mute sound";
  }
}
