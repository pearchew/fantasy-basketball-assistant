// NBA's Akamai edge rejects requests without a browser-like User-Agent.
const USER_AGENT = "Mozilla/5.0";

export async function fetchWithTimeout(
  url: string,
  { timeoutMs = 15_000, ...init }: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
}

export async function fetchJson<T>(url: string, timeoutMs?: number): Promise<T> {
  const res = await fetchWithTimeout(url, { timeoutMs });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  return (await res.json()) as T;
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
