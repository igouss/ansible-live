/** A child's output as whole lines: what came so far, and the start of a line still without its newline. */
export type Split = { readonly lines: readonly string[]; readonly held: string }

/** The lines `text` completes after what was `held`; a piece may end anywhere, a line span pieces. */
export function split(held: string, text: string): Split {
  const whole: string = held + text
  return { lines: whole.split("\n").slice(0, -1), held: whole.slice(whole.lastIndexOf("\n") + 1) }
}
