/**
 * A list kept newest first and never changed in place: adding an item, or changing one near the newest,
 * copies only the items newer than it. A play's tasks live here, since hosts report on its latest tasks,
 * and so do a task's marks.
 */
export type Rows<T> = { readonly first: T; readonly rest: Rows<T> } | null

export function push<T>(rows: Rows<T>, item: T): Rows<T> {
  return { first: item, rest: rows }
}

/** The newest item that passes `test`. */
export function find<T>(rows: Rows<T>, test: (item: T) => boolean): T | null {
  for (let at: Rows<T> = rows; at !== null; at = at.rest) {
    if (test(at.first)) {
      return at.first
    }
  }
  return null
}

/** The rows with the newest item that passes `test` changed; the same rows when none does. */
export function changed<T>(rows: Rows<T>, test: (item: T) => boolean, change: (item: T) => T): Rows<T> {
  const newer: T[] = []
  for (let at: Rows<T> = rows; at !== null; at = at.rest) {
    if (test(at.first)) {
      return newer.reduceRight((rest: Rows<T>, item: T) => push(rest, item), push(at.rest, change(at.first)))
    }
    newer.push(at.first)
  }
  return rows
}

/** Oldest first. */
export function list<T>(rows: Rows<T>): readonly T[] {
  const items: T[] = []
  for (let at: Rows<T> = rows; at !== null; at = at.rest) {
    items.push(at.first)
  }
  return items.reverse()
}
