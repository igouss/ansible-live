# ansible-live

Watch a running `ansible-playbook` from a Claude Code pane. Work in progress: the plan is epic
`al-ansible-live-wwf` in beads (`br ready` is the queue).

## Contract

`contract/SPEC.md` is what the recorder writes and the follower streams: requirements FR-1 to
FR-18, the JSON schemas beside it, witness and near-miss logs in `contract/examples/`, and
`contract/formal/Follow.tla`, a TLA+ model of following a log whose writer can die at any step.
`just verify` runs every offline check: `just test` (contract, recorder and viewer tests), `just pane`, `just formal`
(TLC over the model; needs the `tlc` wrapper around tla2tools.jar on `PATH`) and `just testbed`.

## Recorder

`ansible_collections/igouss/ansible_live/` is the Ansible collection `igouss.ansible_live`; its
callback `igouss.ansible_live.live` writes each run per the contract (its README says how to
enable it). The collection sits at the path Ansible's tooling expects, so the testbed and the tests
use it in place. Its core (`plugins/plugin_utils/recording.py`) turns what happens in a run into
events without touching Ansible; `plugins/callback/live.py` feeds it.

`just mutate` mutation-tests the Python (the recorder, the follower) with mutmut and fails unless the
survivors are exactly those `mutation-equivalents.txt` lists, each with why it changes nothing.

## Viewer

`viewer/plugin/` is the Claude Code plugin `ansible-live`: a pane that shows the run in progress, else
the latest run.

![The pane following a run](docs/pane-running.png)

![The pane after a run failed](docs/pane-failed.png)

- **Install from a clone:** the repo is its own plugin marketplace
  (`.claude-plugin/marketplace.json`):
  `claude plugin marketplace add <clone>` then `claude plugin install ansible-live@ansible-live`.
  Then `/ansible-live` in any session. Any `ansible-playbook` with the callback enabled shows up,
  started from Claude or any other terminal. To try changes without installing:
  `claude --plugin-dir viewer/plugin`.
- **What it shows:** the run's state, controller, check mode and limit; the playbook, play and task in
  progress; a row per host with a cell per task (newest last, as many as the pane is wide); the
  results summed; and the latest failure with its message.
- **Keys** (once the pane has the keyboard, ctrl+x tab): `o` older run, `n` newer run, `l` back to the
  live run, `q` close.
- **Options** (`/config`): `dir`, the log directory when the callback's is not the default; `python`,
  the Python 3 that runs the follower (`python3`).

The pane starts one follower, `python3 -m follower <dir> [<run>...]` from the plugin's folder, when it
opens, and stops it when it closes. The follower writes the stream of `contract/SPEC.md` FR-12 to
FR-14: every run without a `run.end`, the newest run, each run it was started with, every run that
starts, and `run.lost` for one whose process died on this host. Picking an earlier run the stream
lacks starts the follower again, asked for that run too, and the pane reads its stream afresh.

Parts:
- `core/`: plain TypeScript with no Claude Code API. `decode` reads one stream line, `follow` folds
  it into the stream's runs, `glance` says where a run is, `choice` which run to show, and `view`
  what the pane draws, sized to its width.
- `shell/`: the `Watch`, which runs the followers through ports and folds their output, and the
  drawing.
- `hooks/register.tsx`: the command, the pane's lifecycle, and the ports on `$`.
- `follower/`: the Python follower, standard library only.

Once per clone: `cd viewer && npm ci`.
- `just test`: type-checks the viewer, the plugin against `viewer/types/claude-code.d.ts` (the engine's
  API as of the version on its first line; `/plugin-types viewer/types` refreshes it), and runs vitest
  (units, Hegel properties, the watch against fake ports) and pytest (the follower, with a Hypothesis
  state machine of `contract/formal/Follow.tla`).
- `just pane`: `claude plugin validate --strict`, and `claude plugin test`, which mounts the pane on
  the terminal and desktop surfaces over fake followers.
- `just mutate-viewer`: Stryker over `core/` and the watch; it fails on any surviving mutant.
- `just mutate-python`: mutmut over the recorder and the follower.

## Testbed

`testbed/` is an Ansible project to try it on. Its hosts are this machine under several names
(`web1`–`web3`, `db1`) plus `ghost1`, which nothing answers for. The recorder is enabled in its
`ansible.cfg`, so every run lands in `~/.local/state/ansible-live` (or `$ANSIBLE_LIVE_DIR`).

| Playbook | Shows |
|---|---|
| `clean` | two plays, a loop, a skipped task, a handler |
| `failing` | one host failing, one failure ignored, one rescued |
| `unreachable` | `ghost1`, which nothing answers for |
| `long` | `steps` tasks per host |

Once per clone: `uv sync`. Then `just play clean` runs one, each step taking `pace` seconds
(`just play long -e steps=500 -e pace=0`), and `just testbed` runs them all at full speed and
fails unless each ends with the exit code it is built for.
