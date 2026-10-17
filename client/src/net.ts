export interface Ghost {
  username: string;
  distance: number;
  lane: number | null;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `request failed: ${res.status}`);
  }
  return res.json();
}

export interface Account {
  username: string;
  coins: number;
  /** The equipped skin's palette token key, or null for the free magenta default. */
  equippedSkin: string | null;
}

/**
 * Who the server thinks we are, or null if nobody. The auth cookie is
 * httpOnly, so this HAS to be a round trip — `document.cookie` cannot see it,
 * and a client that tries to answer locally concludes it is never signed in.
 *
 * Only a real 401 returns null. A network failure throws, so an offline blip
 * can't be mistaken for "no account" and send a returning player back to the
 * username form, where their own name would come back as already taken.
 */
export async function getAccount(): Promise<Account | null> {
  const res = await fetch("/api/me");
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`could not read account: ${res.status}`);
  return res.json() as Promise<Account>;
}

export async function postAccount(username: string): Promise<Account> {
  const res = await fetch("/api/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  return json<Account>(res);
}

export async function postRunEnd(
  distance: number,
  lane: number,
  seed?: string,
): Promise<{ improved: boolean }> {
  const res = await fetch("/api/run-end", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ distance, lane, seed }),
  });
  return json(res);
}

/**
 * The day's ghosts. Scoped to your crew by default, because that is what the
 * road shows once you are in one (ADR 0011) — `scope: "global"` is the escape
 * hatch the leaderboard panel's global tab uses, and the only caller that
 * should ever pass it.
 */
export async function getGhosts(seed: string, scope?: "global"): Promise<Ghost[]> {
  const query = scope ? `&scope=${scope}` : "";
  const res = await fetch(`/api/ghosts?seed=${encodeURIComponent(seed)}${query}`);
  return json(res);
}

export async function getDays(): Promise<string[]> {
  const res = await fetch("/api/days");
  return json(res);
}

// ---- skins ----
export interface Skin {
  id: string;
  name: string;
  cost: number;
  owned: boolean;
  equipped: boolean;
}

export interface SkinsResponse {
  coins: number;
  skins: Skin[];
}

export async function getSkins(): Promise<SkinsResponse> {
  return json(await fetch("/api/skins"));
}

export async function unlockSkin(id: string): Promise<SkinsResponse> {
  return json(await fetch(`/api/skins/${encodeURIComponent(id)}/unlock`, { method: "POST" }));
}

/** `null` equips the free magenta default. */
export async function equipSkin(id: string | null): Promise<{ equipped: string | null; skins: Skin[] }> {
  return json(await fetch(`/api/skins/${encodeURIComponent(id ?? "default")}/equip`, { method: "POST" }));
}

// ---- crews ----
export interface Crew {
  id: number;
  name: string;
  inviteToken: string;
  /** Joins EVER, which is what the invite's cap counts against — not the member count. */
  joinCount: number;
  maxJoins: number | null;
  expiresAt: string | null;
  memberCount: number;
  open: boolean;
  inviteUrl?: string;
}

export interface CreateCrewOptions {
  maxJoins?: number;
  expiresInSeconds?: number;
}

export async function createCrew(name: string, options: CreateCrewOptions = {}): Promise<{ crew: Crew; inviteUrl: string }> {
  return json(
    await fetch("/api/crews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, ...options }),
    }),
  );
}

/** What an invite points at, readable before you have an account. */
export async function getCrew(token: string): Promise<{ name: string; open: boolean }> {
  return json(await fetch(`/api/crews/${encodeURIComponent(token)}`));
}

export async function joinCrew(token: string): Promise<{ crew: Crew }> {
  return json(await fetch(`/api/crews/${encodeURIComponent(token)}/join`, { method: "POST" }));
}

export async function getMyCrew(): Promise<Crew | null> {
  const body = await json<{ crew: Crew | null }>(await fetch("/api/crews/me"));
  return body.crew;
}

// ---- live feed ----
// One socket for the page's lifetime, re-subscribed whenever the selected day
// changes. Reconnects with backoff; `onState` reports open/closed so the
// caller can fall back to polling while the socket is down (see ghosts.ts).
export interface LiveHandlers {
  /** The full ghost list for `seed` — sent on every (re)subscribe. */
  onGhosts(seed: string, ghosts: Ghost[]): void;
  /** One run that just ended, for the day currently subscribed. */
  onGhost(seed: string, ghost: Ghost): void;
  onState(open: boolean): void;
}

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 15_000;

export class LiveFeed {
  #handlers: LiveHandlers;
  #socket: WebSocket | undefined;
  #seed = "";
  #backoff = RECONNECT_MIN_MS;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  constructor(handlers: LiveHandlers) {
    this.#handlers = handlers;
  }

  /** Switches the day being watched. Safe to call before the socket is open. */
  subscribe(seed: string): void {
    this.#seed = seed;
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(JSON.stringify({ type: "subscribe", seed }));
    } else {
      this.connect();
    }
  }

  connect(): void {
    if (this.#closed) return;
    if (this.#socket && this.#socket.readyState <= WebSocket.OPEN) return;

    // Same host and scheme as the page, so this works on localhost (ws:) and
    // behind Fly's TLS proxy (wss:) without a configured URL.
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${location.host}/live`);
    this.#socket = socket;

    socket.onopen = () => {
      this.#backoff = RECONNECT_MIN_MS;
      this.#handlers.onState(true);
      if (this.#seed) socket.send(JSON.stringify({ type: "subscribe", seed: this.#seed }));
    };

    socket.onmessage = (event) => {
      let message: { type?: string; seed?: string; ghost?: Ghost; ghosts?: Ghost[] };
      try {
        message = JSON.parse(String(event.data)) as typeof message;
      } catch {
        return;
      }
      // Guard on seed: a message for a day we have since switched away from
      // can still be in flight, and must not repopulate the old day's ghosts.
      if (!message.seed || message.seed !== this.#seed) return;
      if (message.type === "ghosts" && message.ghosts) {
        this.#handlers.onGhosts(message.seed, message.ghosts);
      } else if (message.type === "ghost" && message.ghost) {
        this.#handlers.onGhost(message.seed, message.ghost);
      }
    };

    const retry = (): void => {
      this.#handlers.onState(false);
      if (this.#closed) return;
      if (this.#timer) clearTimeout(this.#timer);
      // Jittered backoff: without the jitter every tab reconnects in lockstep
      // after a redeploy, which is the moment the server can least afford it.
      const wait = this.#backoff + Math.random() * this.#backoff;
      this.#backoff = Math.min(RECONNECT_MAX_MS, this.#backoff * 2);
      this.#timer = setTimeout(() => this.connect(), wait);
    };
    socket.onclose = retry;
    socket.onerror = () => socket.close();
  }

  dispose(): void {
    this.#closed = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#socket?.close();
  }
}
