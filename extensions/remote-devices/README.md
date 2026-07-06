# remote-devices

Pi extension for managing frequently used remote computers/VPS/desktops through named devices instead of ad-hoc SSH commands.

## Files

- `index.ts` — extension entry, registers tools/commands/events.
- `devices.json` — bundled empty seed config copied on first load.
- `bin/remote-probe.rs` — Rust helper for concurrent all-device health/latency probing.
- `../../skills/remote-devices/SKILL.md` — oh-my-pi skill instructions for remote device operations.

## Runtime config

The extension ships an empty `devices.json` seed and stores mutable device config in the user pi state directory:

```text
~/.pi/agent/remote-devices/devices.json
```

Override with:

```bash
PI_REMOTE_DEVICES_CONFIG=/path/to/devices.json pi
```

Passwords are intentionally not stored. Use temporary bootstrap flows, then install SSH keys.

Devices may optionally declare an SSH route when their real management path is not the direct `host:port`. For example, a home PC exposed through an SSH config alias can keep its direct host as metadata while using the alias for `remote_exec` and probe:

```json
"sshRoute": {
  "type": "ssh-config",
  "target": "serial-host",
  "label": "serial-host",
  "user": "developer",
  "identityFile": "~/.ssh/id_ed25519"
}
```

For `sshRoute.type = "ssh-config"`, the extension calls `ssh -l <user> <target> ...`, so OpenSSH reads the route details from `~/.ssh/config`. Direct ping/TCP failures for that device are not shown in the default health UI; the configured SSH route is the source of truth for manageability.

Note: `PI_REMOTE_DEVICES_CONFIG` can still override this path. oh-my-pi keeps runtime state outside the package checkout so alias learning and device updates do not dirty the installed package.

## Alias learning

When a fuzzy name clearly maps to one device, the extension automatically saves that exact user phrase as an alias. If the name is ambiguous, ask the user to choose the device, then save it with `remote_learn_alias` so next time the nickname resolves directly.

Tuning environment variables:

- `PI_REMOTE_AUTO_ALIAS_MIN_CONFIDENCE` (default `0.82`)
- `PI_REMOTE_AUTO_ALIAS_AMBIGUITY_GAP` (default `0.08`)

## Tools

- `remote_list_devices`
- `remote_resolve_device`
- `remote_exec`
- `remote_exec_batch`
- `remote_probe_devices`
- `remote_test_connection`
- `remote_serial_capture`
- `remote_add_device`
- `remote_learn_alias`
- `remote_install_keys`

## Command

```text
/remote-devices list
/remote-devices next
/remote-devices prev
/remote-devices focus <index|device|host>
/remote-devices probe [--timeout-ms N] [--ssh-timeout-ms N] [--concurrency N]
/remote-devices clear
/remote-devices close
/remote-devices test <device>
```

## Initial devices

No real devices are bundled. Add local machines with `remote_add_device` or by editing the runtime config.


## Remote serial console

`remote_serial_capture` operates a serial device attached to a configured remote machine. It is intended for development boards connected to a lab PC or similar serial host.

Examples:

```json
{
  "device": "serial-host",
  "serialDevice": "/dev/ttyUSB0",
  "baud": 115200,
  "duration_seconds": 10
}
```

Send a command and capture the response:

```json
{
  "device": "serial-host",
  "serialDevice": "/dev/ttyUSB0",
  "baud": 115200,
  "input": "help",
  "lineEnding": "cr",
  "duration_seconds": 5
}
```

The tool is non-interactive and uses `stty`, `cat`, and `printf` over SSH. For a long human-operated console, run an interactive terminal command instead:

```bash
ssh -t serial-host 'TERM=xterm minicom -D /dev/ttyUSB0 -b 115200'
```

## Structured batch remote execution

`remote_exec_batch` runs multiple non-interactive commands through one SSH call and returns per-command structured results. It is intended for system inventory, health checks, diagnostics, and other cases where an agent would otherwise issue many short `remote_exec` calls against the same device.

Batch commands share the same SSH connection, cwd, sudo setting, and total timeout. Each command gets its own `id`, `exitCode`, `durationMs`, `stdout`, `stderr`, byte counts, omitted byte counts, and `truncated` flag in `details.results`. The tool result text is compact JSON with the same per-command output so the model can read it directly.

Use `mode: "parallel"` for independent lightweight read-only probes such as `lscpu`, `free -h`, `df -h`, `nvidia-smi`, and `ip -br addr`. Use `mode: "sequential"` when commands depend on earlier commands, share mutable state, use package managers, change services, or should not compete for IO/locks. Sequential mode supports `continueOnError` and defaults to continuing.

Output limits are two-layered. The model can request `max_output_bytes` globally or per command and `total_max_output_bytes` for the whole batch, but the extension clamps those values to hard caps:

- `PI_REMOTE_BATCH_DEFAULT_MAX_OUTPUT_BYTES` (default `4000`)
- `PI_REMOTE_BATCH_DEFAULT_TOTAL_OUTPUT_BYTES` (default `32000`)
- `PI_REMOTE_BATCH_HARD_MAX_OUTPUT_BYTES` (default `64000`)
- `PI_REMOTE_BATCH_HARD_TOTAL_OUTPUT_BYTES` (default `128000`)
- `PI_REMOTE_BATCH_MAX_COMMANDS` (default `16`, clamped to `1..64`)

The batch runner stores each subcommand's stdout/stderr in separate remote temporary files and only emits base64-encoded result records after completion. This prevents parallel command output from interleaving and keeps parsing stable. Large raw output should still be reduced at the command level with `head`, `tail`, `grep`, `jq`, `journalctl -n`, or by writing a full log to a remote file and returning a path.

## All-device health probe

`remote_probe_devices` and `/remote-devices probe` both invoke the same Rust helper. Before probing, the helper de-duplicates config entries that share the same `host:port` and keeps one management route for that machine: prefer entries with `sshRoute.type = "ssh-config"`, then prefer `root`, then the first remaining entry.

The probe UI answers one question: can Pi manage this device through its configured route? Direct devices still run `ping` → SSH TCP port → SSH key login internally, but the default table only shows `ROUTE` and the final `CHECK` result. Devices with `sshRoute.type = "ssh-config"` skip direct ping/TCP in the main check and test SSH through the configured OpenSSH alias instead. Healthy rows are shown first and failed rows are moved to the bottom, just above the summary:

```text
S  DEVICE        ROUTE                CHECK        ENDPOINT
✓  build-server  via build-server  2454ms       build-server
✓  serial-host        via serial-host           1002ms       serial-host
×  board         direct               ping failed  10.0.0.87:22
warning OK 2/3 devices · 3 hosts
```

`CHECK` is SSH key login/empty-command time when healthy, or the deepest useful root cause when unhealthy. Probe output intentionally keeps most text in the terminal default color; only `✓` is green, `×` is red, and the partial-failure `warning` label uses a muted/darker yellow. Common result messages include `ping failed`, `ping unavailable`, `DNS resolution failed`, `SSH port <port> unreachable`, `SSH port <port> timeout`, `SSH auth failed`, `host key mismatch`, `SSH connect timeout`, `SSH port refused`, `network unreachable`, `SSH command unavailable`, and `SSH login failed`.

## Remote Bash UI

In TUI mode, remote commands are shown in a bottom `Remote Bash` widget below the editor via `ctx.ui.setWidget()`.

- The widget is collapsed to a single summary row by default.
- `Alt+/` toggles the panel between the one-line collapsed summary and the expanded card stack; it no longer clears bash records.
- New remote bash sessions are inserted at the left side / index `1`; older cards shift right.
- Only the focused card's bash output is shown when expanded. Other devices are visible only as compact tabs, not as extra `other` output rows.
- Finished, failed, timed-out, and manually aborted operations get a dismiss deadline. If they are not currently focused, they are pruned after 30 seconds by default; when the last record is removed, the whole Remote Bash block disappears until a new remote bash starts.
- The currently focused card never auto-disappears. Use `/remote-devices clear` or `/remote-devices close` when you explicitly want to clear all bash records.
- `Alt+.` / `Alt+,` switches between remote command cards.
- `/remote-devices next` and `/remote-devices prev` are command fallbacks for card switching.
- `/remote-devices focus <index|device|host>` focuses a specific card.
- `/remote-devices toggle`, `/remote-devices expand`, and `/remote-devices collapse` are command fallbacks for the collapsed/expanded state.
- `/remote-devices clear` and `/remote-devices close` clear all Remote Bash buffers and hide the widget.

Useful environment variables:

- `PI_REMOTE_LIVE_MAX_LINES` (default `20`)
- `PI_REMOTE_LIVE_MAX_SESSIONS` (default `10`)
- `PI_REMOTE_LIVE_RENDER_THROTTLE_MS` (default `250`)
- `PI_REMOTE_LIVE_DISMISS_AFTER_MS` (default `30000`)

## Timeout budgeting, watchdog, and diagnostics

`remote_exec.timeout_seconds` and `remote_exec_batch.timeout_seconds` are model-chosen total command budgets. The assistant should estimate them before calling the tool: short probes can use 10-30s, status/log reads 30-90s, moderate diagnostics 60-180s, downloads/package operations 300-900s, and builds/tests/image builds 600-1800s or more when explicitly expected. For batch mode, budget for the whole batch: parallel batches usually need enough time for the slowest command plus SSH overhead, while sequential batches need enough time for the expected cumulative runtime. The 60s default is only a fallback for ordinary short commands.

Remote execution is guarded at both the SSH layer and the local child-process layer:

- SSH always runs non-interactively with `BatchMode=yes`, `NumberOfPasswordPrompts=0`, `ConnectTimeout`, `ServerAliveInterval`, `ServerAliveCountMax`, and `TCPKeepAlive`.
- The local watchdog tracks connect timeout, first-byte timeout, idle timeout, total timeout, caller cancellation, and interactive prompt detection.
- Remote commands are wrapped with a lightweight stderr control protocol: `__PI_REMOTE_STARTED__` marks that the remote shell started, and `__PI_REMOTE_HEARTBEAT__` is emitted periodically so quiet long-running commands are not mistaken for dead connections.
- If a watchdog fires, the extension sends `SIGTERM` to the SSH process group and escalates to `SIGKILL` after a grace period.
- Tool details include structured diagnostics: `errorKind`, `phase`, `firstByteMs`, `lastActivityMs`, `lastHeartbeatMs`, `timeoutPolicy`, and `lastOutputPreview`.
- `total-timeout` means the command exceeded the chosen `timeout_seconds`; `idle-timeout` means no output/heartbeat was observed and usually points to a broken or stuck connection.
- Common failures are classified as `connect-timeout`, `auth-failed`, `host-unreachable`, `host-key-changed`, `first-byte-timeout`, `idle-timeout`, `total-timeout`, `remote-disconnected`, `sudo-password-required`, `interactive-prompt-detected`, `cancelled`, or `spawn-error`.

Tuning environment variables:

- `PI_REMOTE_CONNECT_TIMEOUT_MS` (default `10000`)
- `PI_REMOTE_FIRST_BYTE_TIMEOUT_MS` (default `15000`)
- `PI_REMOTE_IDLE_TIMEOUT_MS` (default `45000`)
- `PI_REMOTE_KILL_GRACE_MS` (default `1500`)
- `PI_REMOTE_HEARTBEAT_INTERVAL_MS` (default `10000`)
