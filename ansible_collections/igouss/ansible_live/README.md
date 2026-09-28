# igouss.ansible_live

The recorder half of [ansible-live](https://github.com/igouss/ansible-live): the callback
`igouss.ansible_live.live` appends each `ansible-playbook` run, as it happens, to a log of its own
(one JSON event per line, contract v1).

```ini
[defaults]
callbacks_enabled = igouss.ansible_live.live
```

Logs go to `$XDG_STATE_HOME/ansible-live` (else `~/.local/state/ansible-live`); `ANSIBLE_LIVE_DIR`
or `[callback_live] dir` moves them, and `keep` (default 100) bounds how many stay.
