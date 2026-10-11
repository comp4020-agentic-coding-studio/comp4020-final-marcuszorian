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

export async function getGhosts(seed: string): Promise<Ghost[]> {
  const res = await fetch(`/api/ghosts?seed=${encodeURIComponent(seed)}`);
  return json(res);
}

export async function getDays(): Promise<string[]> {
  const res = await fetch("/api/days");
  return json(res);
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
