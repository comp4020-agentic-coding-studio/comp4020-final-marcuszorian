// Who is on this road, for the day you're looking at. Deliberately NOT a
// leaderboard: no rank numbers, no position, no "1st". It is an index to the
// day's archive — the same ghosts you drive past, listed so you know who is
// out there before you meet them. See doc/adr/0007-day-roster.md, and
// README.md's "good means", whose objection is to looking up a *rank* rather
// than to knowing who else showed up.
//
// On a wide screen it sits down the left. On a narrow one it collapses into a
// disclosure near the top, because a permanent side panel on a phone would eat
// the road, which is the thing you are actually meant to be looking at.
import type { Ghost } from "./net.ts";

const NARROW = "(max-width: 700px)";

export class Roster {
  #details: HTMLDetailsElement;
  #list: HTMLElement;
  #count: HTMLElement;
  #empty: HTMLElement;

  constructor(root: HTMLElement) {
    this.#details = root.querySelector("details")!;
    this.#list = root.querySelector(".roster-list")!;
    this.#count = root.querySelector(".roster-count")!;
    this.#empty = root.querySelector(".roster-empty")!;

    // Open on a desktop, collapsed on a phone. Tracked live so rotating a
    // tablet doesn't leave a side panel jammed over the road.
    const narrow = window.matchMedia(NARROW);
    const apply = (): void => {
      this.#details.open = !narrow.matches;
    };
    apply();
    narrow.addEventListener("change", apply);
  }

  /** `ghosts` arrives already sorted, longest run first. */
  update(ghosts: Ghost[]): void {
    this.#count.textContent = String(ghosts.length);
    this.#empty.hidden = ghosts.length > 0;
    this.#list.hidden = ghosts.length === 0;

    // Rebuilt wholesale rather than diffed: this list is at most 50 rows and
    // changes a few times an hour, so the clever version would be all cost.
    this.#list.textContent = "";
    for (const ghost of ghosts) {
      const row = document.createElement("li");
      row.className = "roster-row";

      const name = document.createElement("span");
      name.className = "roster-name";
      // textContent, never innerHTML — usernames are player-supplied, and this
      // is the one place they are drawn as markup-capable content.
      name.textContent = ghost.username;

      const distance = document.createElement("span");
      distance.className = "roster-distance";
      distance.textContent = `${Math.round(ghost.distance)} m`;

      row.append(name, distance);
      this.#list.append(row);
    }
  }
}
