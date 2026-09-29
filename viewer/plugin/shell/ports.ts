/** What the pane's shell needs from the host: a child process to follow, a directory listing, a redraw. */

/** One piece of a child's output; a line may span pieces. */
export type Piece = { readonly stream: 'stdout' | 'stderr'; readonly text: string }

/** How a child ended: its exit code, or the signal that ended it. */
export type Exit = { readonly code: number | null; readonly signal: string | null }

/** A running child: its output piece by piece, how it ended once that is read, and how to kill it. */
export type Child = {
  readonly pieces: AsyncIterable<Piece>
  /** How it ended, asked once its output is read to the end. */
  readonly ended: () => Promise<Exit>
  readonly stop: () => void
}

export type Ports = {
  readonly spawn: (argv: readonly string[]) => Child
  /** The names in a directory; rejects when it cannot be listed. */
  readonly list: (directory: string) => Promise<readonly string[]>
  readonly redraw: () => void
}
