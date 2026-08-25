const CHUNK_RELOAD_KEY = "jiadian_chunk_reload_attempt";
const CHUNK_RELOAD_PARAM = "_jiadian_recover";
const CHUNK_RELOAD_WINDOW_MS = 2 * 60 * 1000;
const IMPORT_RETRY_DELAYS_MS = [350, 1_200];

type ChunkReloadRecord = {
  route: string;
  attemptedAt: number;
};

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function currentRouteKey(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete(CHUNK_RELOAD_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

function readReloadRecord(): ChunkReloadRecord | null {
  try {
    const raw = window.sessionStorage.getItem(CHUNK_RELOAD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChunkReloadRecord>;
    if (typeof parsed.route !== "string" || typeof parsed.attemptedAt !== "number") {
      return null;
    }
    return { route: parsed.route, attemptedAt: parsed.attemptedAt };
  } catch {
    return null;
  }
}

function writeReloadRecord(record: ChunkReloadRecord): boolean {
  try {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

function replaceWithCacheBuster(): void {
  const url = new URL(window.location.href);
  url.searchParams.set(CHUNK_RELOAD_PARAM, Date.now().toString(36));
  window.location.replace(url.toString());
}

export function isDynamicImportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Failed to load module script|Load failed/i.test(
    message,
  );
}

export async function importWithRetry<T>(importer: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= IMPORT_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      await wait(IMPORT_RETRY_DELAYS_MS[attempt - 1]);
    }
    try {
      return await importer();
    } catch (error) {
      lastError = error;
      if (!isDynamicImportError(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}

export function reloadOnceForDynamicImportError(error: unknown): boolean {
  if (!isDynamicImportError(error)) return false;

  const route = currentRouteKey();
  const now = Date.now();
  const previous = readReloadRecord();
  if (
    previous?.route === route &&
    now - previous.attemptedAt < CHUNK_RELOAD_WINDOW_MS
  ) {
    return false;
  }
  if (!writeReloadRecord({ route, attemptedAt: now })) {
    return false;
  }
  replaceWithCacheBuster();
  return true;
}

export function markDynamicImportLoaded(): void {
  try {
    window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    // Recovery must not fail just because storage is unavailable.
  }

  const url = new URL(window.location.href);
  if (!url.searchParams.has(CHUNK_RELOAD_PARAM)) return;
  url.searchParams.delete(CHUNK_RELOAD_PARAM);
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

export function manuallyRetryPageLoad(): void {
  try {
    window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    // Continue with a cache-busted navigation when storage is unavailable.
  }
  replaceWithCacheBuster();
}
