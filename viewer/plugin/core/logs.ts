/** Where the recorder writes its logs (contract/SPEC.md FR-1), and which runs a directory holds (FR-2). */

/** The configured directory, else `$XDG_STATE_HOME/ansible-live`, else `$HOME/.local/state/ansible-live`. */
export function directory(configured: string, xdgStateHome: string | undefined, home: string): string {
  if (configured !== "") {
    return configured
  }
  return `${xdgStateHome || `${home}/.local/state`}/ansible-live`
}

/** The runs whose logs are among `names`, oldest first. */
export function logged(names: readonly string[]): readonly string[] {
  return names.filter((name: string) => name.endsWith(".jsonl")).map((name: string) => name.slice(0, -".jsonl".length)).sort()
}
