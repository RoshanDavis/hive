/** Lowercase a label into a stable id slug: runs of non-alphanumerics collapse to
 * a single underscore, with leading/trailing underscores trimmed. Falls back to
 * "tool" when the result would be empty. Used to derive tool ids from labels. */
export function slugify(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "tool"
  );
}
