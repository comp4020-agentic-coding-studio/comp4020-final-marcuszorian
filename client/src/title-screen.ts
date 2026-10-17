// The title screen: who you are, which day you're about to drive, and the
// four ways out of it (race, crew, shop, cosmetics).
//
// The car itself is not drawn here — it is the real car in the real scene,
// framed by hero-shot.ts. This module owns only the right-hand column of
// buttons and readouts.
import type { Destination } from "./screens.ts";

export interface TitleScreenHandlers {
  onStart(): void;
  onDestination(destination: Destination): void;
}

export class TitleScreen {
  #name: HTMLElement;
  #coins: HTMLElement;

  constructor(root: HTMLElement, handlers: TitleScreenHandlers) {
    this.#name = root.querySelector(".title-name")!;
    this.#coins = root.querySelector(".title-coins")!;

    root.querySelector("#startRace")!.addEventListener("click", () => handlers.onStart());
    for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-destination]")) {
      button.addEventListener("click", () =>
        handlers.onDestination(button.dataset.destination as Destination),
      );
    }
  }

  /**
   * Who is signed in and what they're worth. Both come from GET /api/me,
   * which the client already calls on boot to find out who it is — so this
   * costs nothing extra, and without it a coin balance is invisible until
   * you open the shop looking for it.
   */
  setAccount(username: string | null, coins: number): void {
    this.#name.textContent = username ?? "";
    this.#coins.textContent = String(coins);
  }

  setCoins(coins: number): void {
    this.#coins.textContent = String(coins);
  }
}
