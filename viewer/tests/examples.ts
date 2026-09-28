/** The contract's example logs (contract/examples/), read as the follower would stream them. */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { decode } from "../plugin/core/decode.ts"
import { EMPTY, follow, type Stream } from "../plugin/core/stream.ts"

/** The nearest `contract/` up from here: the repository's, also from a copy of viewer/ inside it (Stryker's sandbox). */
function contract(from: string): string {
  const here: string = join(from, "contract")
  if (existsSync(join(here, "SPEC.md"))) {
    return here
  }
  if (dirname(from) === from) {
    throw new Error("no contract/ above the viewer tests")
  }
  return contract(dirname(from))
}

const EXAMPLES: string = join(contract(dirname(fileURLToPath(import.meta.url))), "examples")

export function lines(name: string): readonly string[] {
  return readFileSync(join(EXAMPLES, name), "utf8").split("\n").filter((line: string) => line !== "")
}

export function streamed(name: string): Stream {
  return read(lines(name))
}

/** The stream a reader makes of these lines. */
export function read(lines: readonly string[]): Stream {
  return lines.map(decode).reduce(follow, EMPTY)
}
