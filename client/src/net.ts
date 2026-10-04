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

export function hasAccount(): boolean {
  return document.cookie.split(";").some((c) => c.trim().startsWith("token="));
}

export async function postAccount(username: string): Promise<void> {
  const res = await fetch("/api/account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  });
  await json(res);
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
