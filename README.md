# ansible-live

Watch a running `ansible-playbook` from a Claude Code pane. Work in progress: the plan is epic
`al-ansible-live-wwf` in beads (`br ready` is the queue).

## Contract

`contract/SPEC.md` is what the recorder writes and the follower streams: requirements FR-1 to
FR-18, the JSON schemas beside it, witness and near-miss logs in `contract/examples/`, and
`contract/formal/Follow.tla`, a TLA+ model of following a log whose writer can die at any step.
`just verify` runs every offline check: `just test` (contract, recorder and viewer tests), `just formal`
(TLC over the model; needs the `tlc` wrapper around tla2tools.jar on `PATH`) and `just testbed`.

## Recorder

`ansible_collections/igouss/ansible_live/` is the Ansible collection `igouss.ansible_live`; its
callback `igouss.ansible_live.live` writes each run per the contract (its README says how to
enable it). The collection sits at the path Ansible's tooling expects, so the testbed and the tests
use it in place. Its core (`plugins/plugin_utils/recording.py`) turns what happens in a run into
events without touching Ansible; `plugins/callback/live.py` feeds it.

`just mutate` mutation-tests the recorder with mutmut and fails unless the survivors are exactly
those `mutation-equivalents.txt` lists, each with why it changes nothing.

## Viewer

`viewer/plugin/` becomes the Claude Code plugin. Its core (`viewer/plugin/core/`) is plain
TypeScript with no Claude Code API: `decode` reads one stream line, `follow` folds it into the
stream's runs, and `glance` says where a run is now. A run holds its playbooks, each play batch with
its host × task grid, per-host counts, the latest failure, and whether it is running, ended or lost;
a line from a newer recorder marks its run with that version (FR-15). `viewer/tests/` holds unit
tests and Hegel properties over generated runs.

Once per clone: `cd viewer && npm ci`. `just test` type-checks and runs them; `just mutate-viewer`
runs Stryker, which fails on any surviving mutant (an equivalent one is argued where it stands, in
a `// Stryker disable` comment).

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
