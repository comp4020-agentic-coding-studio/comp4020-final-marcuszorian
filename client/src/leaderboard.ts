// The day's leaderboard: ranked positions, highest distance first, with your
// own run shown below the cut when it didn't make the top ten.
//
// This replaces the deliberately unranked "roster" of ADR 0007/0008. The
// project refused ranks for a long time and argued the case in README.md and
// doc/adr/0003; doc/adr/0009-leaderboard.md is where that was reversed and
// why. Nothing here is coy about what it is any more.
//
// On a wide screen it sits down the left. On a narrow one it collapses into a
// disclosure near the top, because a permanent side panel on a phone would eat
// the road, which is the thing you are actually meant to be looking at.
import type { Ghost } from "./net.ts";

const NARROW = "(max-width: 700px)";
/** Ranked rows shown before the list stops. */
const TOP_N = 10;

export interface Ranked {
  ghost: Ghost;
  rank: number;
}

/**
 * Canonical standings order: furthest first, then username A–Z so a tie has
 * one stable answer rather than depending on the order rows arrived in.
 *
 * Ranks are sequential (1, 2, 3), so tied players occupy adjacent positions
 * decided alphabetically rather than sharing a number. That is a real choice
 * and it is visible whenever a day has ties: with eight players on 900m, the
 * one whose name sorts first is 1st and the one that sorts last is 8th, and
 * nothing about the driving separated them.
 */
export function standings(ghosts: Ghost[]): Ranked[] {
  return [...ghosts]
    .sort((a, b) => b.distance - a.distance || a.username.localeCompare(b.username))
    .map((ghost, i) => ({ ghost, rank: i + 1 }));
}

export class Leaderboard {
  #details: HTMLDetailsElement;
  #list: HTMLElement;
  #count: HTMLElement;
  #empty: HTMLElement;
  #viewer: string | null = null;
  /** Last set received, kept so setViewer can re-render without a refetch. */
  #ghosts: Ghost[] = [];

  constructor(root: HTMLElement) {
    this.#details = root.querySelector("details")!;
    this.#list = root.querySelector(".leaderboard-list")!;
    this.#count = root.querySelector(".leaderboard-count")!;
    this.#empty = root.querySelector(".leaderboard-empty")!;

    // Open on a desktop, collapsed on a phone. Tracked live so rotating a
    // tablet doesn't leave a side panel jammed over the road.
    const narrow = window.matchMedia(NARROW);
    const apply = (): void => {
      this.#details.open = !narrow.matches;
    };
    apply();
    narrow.addEventListener("change", apply);
  }

  /** Who is playing, so their own run can be found and marked. */
  setViewer(username: string | null): void {
    if (username === this.#viewer) return;
    this.#viewer = username;
    this.update(this.#ghosts);
  }

  update(ghosts: Ghost[]): void {
    this.#ghosts = ghosts;
    // The count is the whole day, not the ten shown — the panel is truncated,
    // the road is not, and saying "10" here would make the day look emptier
    // than it is.
    this.#count.textContent = String(ghosts.length);
    this.#empty.hidden = ghosts.length > 0;
    this.#list.hidden = ghosts.length === 0;

    const ranked = standings(ghosts);
    const top = ranked.slice(0, TOP_N);
    // Matched by username rather than by index, so two players tied on
    // distance can never swap whose row is highlighted.
    const mine =
      this.#viewer === null
        ? undefined
        : ranked.find((r) => r.ghost.username === this.#viewer);
    const mineIsShown = mine !== undefined && mine.rank <= TOP_N;

    // Rebuilt wholesale rather than diffed: eleven rows at most, changing a
    // few times an hour, so the clever version would be all cost.
    this.#list.textContent = "";
    for (const entry of top) {
      this.#list.append(this.#row(entry, entry.ghost.username === this.#viewer));
    }
    if (mine !== undefined && !mineIsShown) {
      const gap = document.createElement("li");
      gap.className = "leaderboard-gap";
      gap.setAttribute("aria-hidden", "true");
      gap.textContent = "···";
      this.#list.append(gap, this.#row(mine, true));
    }
  }

  #row(entry: Ranked, isViewer: boolean): HTMLLIElement {
    const row = document.createElement("li");
    row.className = isViewer ? "leaderboard-row is-you" : "leaderboard-row";
    row.value = entry.rank; // real <li> value, so the rank is in the semantics

    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = String(entry.rank);

    const name = document.createElement("span");
    name.className = "leaderboard-name";
    // textContent, never innerHTML — usernames are player-supplied, and this
    // is the one place they are drawn as markup-capable content.
    name.textContent = entry.ghost.username;
    if (isViewer) {
      const you = document.createElement("span");
      you.className = "leaderboard-you";
      you.textContent = " you";
      name.append(you);
    }

    const distance = document.createElement("span");
    distance.className = "leaderboard-distance";
    distance.textContent = `${Math.round(entry.ghost.distance)} m`;

    row.append(rank, name, distance);
    return row;
  }
}
