export interface ChangelogEntry {
  version: string;
  /** ISO or display date */
  date?: string;
  items: readonly string[];
}

/** Newest first. Bump `version` / add a section when you ship meaningful changes. */
export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    version: "0.1.0",
    date: "2025-03-27",
    items: ["Initial release"],
  },
];
