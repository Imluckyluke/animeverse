/** Device-local reading state. Downloading never changes viewing progress. */
export const LIBRARY_STATUSES = ["watching", "planned", "completed", "paused"] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];
export type LibraryState = Record<string, LibraryStatus>;

export const LIBRARY_LABELS: Record<LibraryStatus, string> = {
  watching: "دنبال می‌کنم",
  planned: "برای بعد",
  completed: "تمام‌شده",
  paused: "متوقف‌شده",
};

export function parseLibrary(value: unknown): LibraryState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([slug, status]) =>
    slug.length > 0 && LIBRARY_STATUSES.includes(status as LibraryStatus),
  ));
}

/** Use actual archive numbers: episode numbering can start late or have gaps. */
export function nextAvailableEpisode(numbers: readonly number[], watched: readonly number[]): number | null {
  const available = [...new Set(numbers.filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const last = Math.max(0, ...watched.filter(n => Number.isInteger(n) && n > 0));
  return available.find(number => number > last) ?? null;
}
