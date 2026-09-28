# Every check that runs offline: the contract, its model, the testbed.
verify: test formal testbed

# Mutation testing: the recorder's survivors are exactly those mutation-equivalents.txt lists; the viewer core has none.
mutate: mutate-recorder mutate-viewer

mutate-recorder:
    #!/usr/bin/env bash
    rm -rf mutants
    uv run --locked mutmut run >/dev/null || exit 1
    survived=$(uv run --locked mutmut results | awk -F': ' '/survived/ {sub(/^ +/, "", $1); print $1}' | sort)
    listed=$(grep -v '^#' mutation-equivalents.txt | cut -d' ' -f1 | sort)
    [ "$survived" = "$listed" ] || { diff <(echo "$listed") <(echo "$survived"); echo "survivors differ from mutation-equivalents.txt"; exit 1; }

mutate-viewer:
    cd viewer && npx stryker run

# The unit and contract tests, the viewer core's type check among them.
test:
    uv run --locked pytest -q
    cd viewer && npx tsc -p . && npx vitest run

# The follower protocol model-checked, and the end-first order it replaces seen failing.
formal:
    #!/usr/bin/env bash
    cd contract/formal
    tlc -workers 1 -config Follow.cfg Follow >/dev/null || { echo "Follow: the protocol fails its model"; exit 1; }
    tlc -workers 1 -config FollowNaive.cfg FollowNaive | grep -q "Invariant LostSound is violated" \
        || { echo "FollowNaive: the end-first order no longer fails LostSound"; exit 1; }

# Run one testbed playbook, extra arguments passed on: `just play long -e steps=500 -e pace=0`.
play name *args:
    cd testbed && uv run --locked ansible-playbook playbooks/{{name}}.yml {{args}}

# Every testbed playbook at full speed, each required to end the way it is built to.
testbed:
    just _ends clean 0
    just _ends clean 0 --check
    just _ends failing 2
    just _ends unreachable 4
    just _ends long 0 -e steps=3

_ends name code *args:
    #!/usr/bin/env bash
    logs=$(mktemp -d)
    said=$(ANSIBLE_LIVE_DIR=$logs just play {{name}} -e pace=0 {{args}} </dev/null 2>&1)
    got=$?
    rm -rf "$logs"
    [ "$got" = "{{code}}" ] || { echo "$said"; echo "{{name}} {{args}}: exit $got, expected {{code}}"; exit 1; }
