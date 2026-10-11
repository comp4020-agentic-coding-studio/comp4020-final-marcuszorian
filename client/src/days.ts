// The day-selector: lets a player cycle back to a past day and race its
// ghosts instead of only ever playing "today". The API/schema already treat
// every day symmetrically (doc/adr/0002-daily-seeded-archive.md) — this is
// just the client control for it.
import { getDays } from "./net.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The day the archive opens. Navigation is bounded by the CALENDAR, not by
// which days happen to have runs in them: a day's track is a pure function of
// its date (doc/adr/0002-daily-seeded-archive.md), so every date between here
// and today is a real, playable, identical-for-every-player road whether or
// not anyone has driven it yet. Gating on recorded activity instead meant a
// fresh database let you step back exactly one day and then greyed the button
// out, which made the archive look broken when it was merely empty.
export const ARCHIVE_EPOCH = "2026-09-28";

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

/** Whether stepping back from `seed` lands on a day the archive covers. */
export function canGoBack(seed: string): boolean {
  return seed > ARCHIVE_EPOCH;
}

/** Whether stepping forward from `seed` lands on a day that has happened. */
export function canGoForward(seed: string): boolean {
  return seed < todayUtc();
}

export function shiftDay(seed: string, delta: number): string {
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
    if (delta < 0 ? !canGoBack(this.#seed) : !canGoForward(this.#seed)) return;
    const next = shiftDay(this.#seed, delta);
    this.#seed = next;
    this.#render();
    this.#onChange(this.#seed);
  }

  #render(): void {
    this.#label.textContent = labelFor(this.#seed);
    this.#nextButton.disabled = !canGoForward(this.#seed);
    this.#prevButton.disabled = !canGoBack(this.#seed);
    // /api/days no longer decides where you can go — it says which days have
    // someone's trace in them, so an empty day can look empty rather than
    // looking broken.
    this.#label.dataset.hasRuns = String(this.#knownDays.includes(this.#seed));
  }
}
