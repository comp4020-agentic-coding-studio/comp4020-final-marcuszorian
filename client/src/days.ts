// The day-selector: lets a player cycle back to a past day and race its
// ghosts instead of only ever playing "today". The API/schema already treat
// every day symmetrically (doc/adr/0002-daily-seeded-archive.md) — this is
// just the client control for it.
import { getDays } from "./net.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// How many whole days back `seed` is from today's UTC date. Negative/zero
// for today. Used only to drive how degraded the scene looks (see
// archiveAge below) — never to decide anything about what's playable.
function daysAgo(seed: string): number {
  const ms = Date.parse(`${todayUtc()}T00:00:00Z`) - Date.parse(`${seed}T00:00:00Z`);
  return Math.round(ms / MS_PER_DAY);
}

// 0 for today, climbing to 1 by a month back. This is the one place the
// vaporwave aesthetic and the archive mechanic are the same idea (see
// plan.md, "Age the archive"): older days don't just look different, they
// look like a worn tape of themselves — postfx.ts's setArchiveAge() turns
// this into chromatic aberration, grain and desaturation.
export function archiveAge(seed: string): number {
  return Math.max(0, Math.min(1, daysAgo(seed) / 30));
}

function shiftDay(seed: string, delta: number): string {
  const d = new Date(`${seed}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function labelFor(seed: string): string {
  if (seed === todayUtc()) return "today";
  if (seed === shiftDay(todayUtc(), -1)) return "yesterday";
  return seed;
}

export class DaySelector {
  #seed: string;
  #knownDays: string[] = [];
  #onChange: (seed: string) => void;
  #prevButton: HTMLButtonElement;
  #nextButton: HTMLButtonElement;
  #label: HTMLElement;

  constructor(onChange: (seed: string) => void) {
    this.#seed = todayUtc();
    this.#onChange = onChange;
    this.#prevButton = document.getElementById("prevDay") as HTMLButtonElement;
    this.#nextButton = document.getElementById("nextDay") as HTMLButtonElement;
    this.#label = document.getElementById("dayLabel")!;
    this.#prevButton.addEventListener("click", () => this.#go(-1));
    this.#nextButton.addEventListener("click", () => this.#go(1));
    this.#render();
  }

  get seed(): string {
    return this.#seed;
  }

  async load(): Promise<void> {
    try {
      this.#knownDays = await getDays();
    } catch {
      this.#knownDays = [this.#seed];
    }
    this.#render();
  }

  #go(delta: number): void {
    const next = shiftDay(this.#seed, delta);
    if (next > todayUtc()) return; // never race a day that hasn't happened
    this.#seed = next;
    this.#render();
    this.#onChange(this.#seed);
  }

  #render(): void {
    this.#label.textContent = labelFor(this.#seed);
    this.#nextButton.disabled = this.#seed >= todayUtc();
    // Going back is only disabled past the oldest day with any recorded
    // activity, plus one — so you can always step back exactly one day
    // beyond the archive to start a fresh, empty one deliberately.
    const oldest = this.#knownDays.length > 0 ? this.#knownDays[this.#knownDays.length - 1]! : this.#seed;
    this.#prevButton.disabled = this.#seed <= shiftDay(oldest, -1);
  }
}
