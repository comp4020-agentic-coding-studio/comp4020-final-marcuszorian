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
/** How many rows the panel shows before it stops. See doc/adr/0008-roster-top-ten.md. */
const TOP_N = 10;

export class Roster {
  #details: HTMLDetailsElement;
  #list: HTMLElement;
  #count: HTMLElement;
  #empty: HTMLElement;
  #viewer: string | null = null;
  /** Last set received, kept so setViewer can re-render without a refetch. */
  #ghosts: Ghost[] = [];

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

  /** Who is playing, so their own run can be found in the list. */
  setViewer(username: string | null): void {
    if (username === this.#viewer) return;
    this.#viewer = username;
    this.update(this.#ghosts);
  }

  /** `ghosts` arrives already sorted, longest run first. */
  update(ghosts: Ghost[]): void {
    this.#ghosts = ghosts;
    // The count is the whole day, not the ten shown — the panel is truncated,
    // the road is not, and saying "10" here would make the day look emptier
    // than it is.
    this.#count.textContent = String(ghosts.length);
    this.#empty.hidden = ghosts.length > 0;
    this.#list.hidden = ghosts.length === 0;

    const top = ghosts.slice(0, TOP_N);
    // Your own run, when it didn't make the cut. Found by identity rather than
    // by index, so it survives two people tying on distance.
    const mine =
      this.#viewer === null
        ? undefined
        : ghosts.find((g) => g.username === this.#viewer);
    const mineIsShown = mine !== undefined && top.includes(mine);

    // Rebuilt wholesale rather than diffed: eleven rows at most, changing a
    // few times an hour, so the clever version would be all cost.
    this.#list.textContent = "";
    for (const ghost of top) {
      this.#list.append(this.#row(ghost, ghost.username === this.#viewer));
    }
    if (mine !== undefined && !mineIsShown) {
      // A gap, then you. No position number: knowing you are outside the top
      // ten is the useful part, and the exact rank is the part ADR 0007
      // refused (and 0008 keeps refusing).
      const gap = document.createElement("li");
      gap.className = "roster-gap";
      gap.setAttribute("aria-hidden", "true");
      gap.textContent = "···";
      this.#list.append(gap, this.#row(mine, true));
    }
  }

  #row(ghost: Ghost, isViewer: boolean): HTMLLIElement {
    const row = document.createElement("li");
    row.className = isViewer ? "roster-row is-you" : "roster-row";

    const name = document.createElement("span");
    name.className = "roster-name";
    // textContent, never innerHTML — usernames are player-supplied, and this
    // is the one place they are drawn as markup-capable content.
    name.textContent = ghost.username;
    if (isViewer) {
      const you = document.createElement("span");
      you.className = "roster-you";
      you.textContent = " you";
      name.append(you);
    }

    const distance = document.createElement("span");
    distance.className = "roster-distance";
    distance.textContent = `${Math.round(ghost.distance)} m`;

    row.append(name, distance);
    return row;
  }
}
