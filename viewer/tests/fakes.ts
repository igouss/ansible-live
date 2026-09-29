/** Fake ports for the pane's shell: followers that say what a test gives them, and a directory that lists what it holds. */
import type { Child, Exit, Piece, Ports } from "../plugin/shell/ports.ts"

/** What one fake follower says: its pieces, then whether it ends (and how) or runs until killed. */
export type Script = { readonly pieces: readonly Piece[]; readonly exit: Exit | "runs" | Error }

export const RUNS: Script = { pieces: [], exit: "runs" }

export function out(text: string): Piece {
  return { stream: "stdout", text }
}

export function err(text: string): Piece {
  return { stream: "stderr", text }
}

/** The host beneath a watch: it spawns each argv by its last word's script, lists `names`, and counts redraws. */
export class Host {
  readonly spawned: (readonly string[])[] = []
  readonly killed: (readonly string[])[] = []
  redraws: number = 0
  private readonly scripts: ReadonlyMap<string, Script>
  private readonly names: readonly string[] | Error

  constructor(scripts: ReadonlyMap<string, Script>, names: readonly string[] | Error = []) {
    this.scripts = scripts
    this.names = names
  }

  get ports(): Ports {
    return {
      spawn: (argv: readonly string[]): Child => this.spawn(argv),
      list: async (): Promise<readonly string[]> => (this.names instanceof Error ? Promise.reject(this.names) : this.names),
      redraw: (): void => {
        this.redraws += 1
      },
    }
  }

  private spawn(argv: readonly string[]): Child {
    this.spawned.push(argv)
    const script: Script = this.scripts.get(argv.at(-1) ?? "") ?? RUNS
    let kill: () => void = () => {}
    const killed: Promise<void> = new Promise((done: () => void) => {
      kill = done
    })
    const pieces = async function* (): AsyncGenerator<Piece> {
      if (script.exit instanceof Error) {
        throw script.exit
      }
      yield* script.pieces
      if (script.exit === "runs") {
        await killed
      }
    }
    return {
      pieces: pieces(),
      ended: (): Promise<Exit> => (script.exit === "runs" || script.exit instanceof Error ? Promise.reject(new Error("closed before its end")) : Promise.resolve(script.exit)),
      stop: (): void => {
        this.killed.push(argv)
        kill()
      },
    }
  }
}

/** Lets what the watch left running go as far as it can. */
export async function settled(): Promise<void> {
  await new Promise((resolve: (value: unknown) => void) => setTimeout(resolve, 0))
}
