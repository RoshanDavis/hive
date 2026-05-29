// Shared ranked text search used by node lists (palette, Nodes tab).
// Matches a query against a primary field with exact/prefix/substring tiers,
// then falls back to secondary fields (substring only), and returns items
// sorted best-match first. Items that match nothing are dropped.

export interface SecondaryField<T> {
  /** Extracts the searchable string from an item. */
  value: (item: T) => string;
  /** Score awarded on a substring match. Tune relative to the primary tiers. */
  score: number;
}

export interface RankedSearchOptions<T> {
  /** Primary field — gets exact (100), prefix (80), and substring (60) scoring. */
  primary: (item: T) => string;
  /** Fallback fields, checked in order; the first substring match wins its score. */
  secondary?: SecondaryField<T>[];
}

// Primary-field scoring tiers.
const EXACT = 100;
const PREFIX = 80;
const SUBSTRING = 60;

function scoreItem<T>(item: T, query: string, opts: RankedSearchOptions<T>): number {
  const primary = opts.primary(item).toLowerCase();
  if (primary === query) return EXACT;
  if (primary.startsWith(query)) return PREFIX;
  if (primary.includes(query)) return SUBSTRING;

  for (const field of opts.secondary ?? []) {
    if (field.value(item).toLowerCase().includes(query)) return field.score;
  }
  return 0;
}

/**
 * Returns `items` ranked by relevance to `query`. An empty/whitespace query
 * returns the list unchanged (original order preserved).
 */
export function rankedSearch<T>(
  items: T[],
  query: string,
  opts: RankedSearchOptions<T>
): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return items;

  return items
    .map((item) => ({ item, score: scoreItem(item, normalized, opts) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}
