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
//
// Since ADR 0011 this panel is also the one place a crew member can still see
// the whole day. The road narrows to your crew unconditionally; the panel has
// a global/crew switch. That means the panel and the road genuinely disagree
// for a crew member on the global tab — deliberately, and it is why the global
// tab does its own fetch rather than reading GhostLayer's road-scoped set.
import { todayUtc } from "./days.ts";
import { getGhosts } from "./net.ts";
import type { Ghost } from "./net.ts";

const NARROW = "(max-width: 700px)";
/** Ranked rows shown before the list stops. */
const TOP_N = 10;

/** Which set of runs the panel is showing. "crew" only exists once you're in one. */
export type Scope = "global" | "crew";

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
  #tabs: HTMLElement;
  #archiveNote: HTMLElement;
  #viewer: string | null = null;
  /** The road's set, pushed in by GhostLayer. Crew-scoped once you're in a crew. */
  #roadGhosts: Ghost[] = [];
  /** The whole day, fetched only when the global tab needs it. */
  #globalGhosts: Ghost[] = [];
  #scope: Scope = "global";
  #inCrew = false;
  #seed = "";
  /** Your crew's usernames, so their rows can be marked on either tab. */
  #crewMembers = new Set<string>();
  /** Guards against an in-flight global fetch landing after the day changed. */
  #pending = 0;

  constructor(root: HTMLElement) {
    this.#details = root.querySelector("details")!;
    this.#list = root.querySelector(".leaderboard-list")!;
    this.#count = root.querySelector(".leaderboard-count")!;
    this.#empty = root.querySelector(".leaderboard-empty")!;
    this.#tabs = root.querySelector(".leaderboard-tabs")!;
    this.#archiveNote = root.querySelector(".leaderboard-archive-note")!;

    for (const button of this.#tabs.querySelectorAll<HTMLButtonElement>("button[data-scope]")) {
      button.addEventListener("click", () => this.setScope(button.dataset.scope as Scope));
    }

    // Open on a desktop, collapsed on a phone. Tracked live so rotating a
    // tablet doesn't leave a side panel jammed over the road.
    const narrow = window.matchMedia(NARROW);
    const apply = (): void => {
      this.#details.open = !narrow.matches;
    };
    apply();
    narrow.addEventListener("change", apply);
    this.#syncTabs();
  }

  /** Who is playing, so their own run can be found and marked. */
  setViewer(username: string | null): void {
    if (username === this.#viewer) return;
    this.#viewer = username;
    this.#render();
  }

  /** Your crew's members, from the crew screen. Empty when you're not in one. */
  setCrewMembers(usernames: string[]): void {
    this.#crewMembers = new Set(usernames);
    this.#render();
  }

  /** Which day the global tab should fetch. Called wherever GhostLayer's seed is set. */
  setSeed(seed: string): void {
    if (seed === this.#seed) return;
    this.#seed = seed;
    this.#archiveNote.hidden = seed === todayUtc();
    this.#globalGhosts = [];
    if (this.#scope === "global" && this.#inCrew) void this.#fetchGlobal();
  }

  /**
   * Whether the viewer is in a crew. The tabs only exist once they are:
   * without a crew the road IS the whole day, so a switch would offer two
   * names for one list.
   */
  setInCrew(inCrew: boolean): void {
    if (inCrew === this.#inCrew) return;
    this.#inCrew = inCrew;
    // Membership changed, so anything fetched under the old scope is stale:
    // the cached whole-day set would otherwise keep answering the global tab
    // while the crew tab is shown, which is the bug this clears.
    this.#globalGhosts = [];
    this.#pending++;
    // Default to the crew when you join one — it is the set you are driving
    // against, and the road has just narrowed to match.
    this.#scope = inCrew ? "crew" : "global";
    this.#syncTabs();
    this.#render();
  }

  setScope(scope: Scope): void {
    if (scope === this.#scope) return;
    this.#scope = scope;
    this.#syncTabs();
    if (scope === "global" && this.#inCrew) void this.#fetchGlobal();
    this.#render();
  }

  async #fetchGlobal(): Promise<void> {
    const seed = this.#seed;
    const token = ++this.#pending;
    if (!seed) return;
    try {
      const ghosts = await getGhosts(seed, "global");
      // Drop a result the day (or another fetch) has moved past.
      if (seed !== this.#seed || token !== this.#pending) return;
      this.#globalGhosts = ghosts;
      this.#render();
    } catch {
      // Offline or a transient error — the panel keeps what it had, same as
      // GhostLayer's own poll does.
    }
  }

  #syncTabs(): void {
    this.#tabs.hidden = !this.#inCrew;
    for (const button of this.#tabs.querySelectorAll<HTMLButtonElement>("button[data-scope]")) {
      button.setAttribute("aria-pressed", String(button.dataset.scope === this.#scope));
    }
  }

  /**
   * The set that is currently on screen. Without a crew the road already IS
   * the whole day, so the pushed set answers both scopes and nothing is
   * fetched twice.
   */
  #current(): Ghost[] {
    if (!this.#inCrew || this.#scope === "crew") return this.#roadGhosts;
    return this.#globalGhosts;
  }

  update(ghosts: Ghost[]): void {
    this.#roadGhosts = ghosts;
    this.#render();
  }

  #render(): void {
    const ghosts = this.#current();
    // The count is the whole day, not the ten shown — the panel is truncated,
    // the road is not, and saying "10" here would make the day look emptier
    // than it is.
    this.#count.textContent = String(ghosts.length);
    this.#empty.hidden = ghosts.length > 0;
    this.#empty.textContent =
      this.#inCrew && this.#scope === "crew"
        ? "Nobody in your crew has driven this day yet"
        : "Nobody has driven this day yet";
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
    // Your own row wins over the crew mark: you are in your crew, but "you"
    // is the more useful thing to find at a glance.
    const isCrew = !isViewer && this.#crewMembers.has(entry.ghost.username);
    row.className = isViewer
      ? "leaderboard-row is-you"
      : isCrew
        ? "leaderboard-row is-crew"
        : "leaderboard-row";
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
