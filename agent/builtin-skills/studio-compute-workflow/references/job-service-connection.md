# Local and cluster job-service setup

Use this reference for explicit service setup or repair. A saved connection, authenticated SSH, the conversation's shell, worker health, project access and scientific readiness each have their own evidence. For a queue check on an already hosted resource, follow `compute.queue` and its read-only scheduler discovery instructions.

## Local WSL

Select the installed distribution and saved service root. Prefer an existing dedicated interpreter and discover bounded Conda/venv candidates before proposing installation. Use AIMatterLab's local connection entry and verify the returned service identity. A service interpreter is distinct from the Python registered for individual engines. A local connection grants no project paths, GPUs or execution limits.

## Authenticated and hosted SSH resources

1. For an existing hosted SSH resource, call `list_compute_resources` and `acquire_compute_resource` with one selector. Its conversation terminal uses the authenticated connection. For a new or expired connection, the user signs in privately and selects **登录完成，交由 AIMatterLab 管理**. Once the resource appears in the list, continue in the same chat. Preserve the user's SSH client, username and key namespace.
2. Use the same lease's terminal to inspect the chosen interpreter and activation recipe when setup is within the requested scope. Prefer a saved interpreter, existing Conda/venv or site module. Check its actual Python version and `sqlite3` import against the shipped worker, separately from scientific engine dependencies. A missing executable on PATH, activation failure, unsupported version and unanswered probe have different remedies. Consult the minimum version of the bundled worker and loader. Keep checks targeted to the intended environment.
3. Propose the observed interpreter and any needed activation command. On the saved SSH profile, **编辑连接** → **高级：Python 环境** exposes the worker's Python and activation fields. Saving the connection creates a new configuration version. Preserve scientific registrations and engine branches.
4. Starting, installing or upgrading a worker requires scope covering that operation. Use the current settings or service controls that the application exposes. When the service is present, `inspect_compute_service` on the acquired resource can identify registered targets and any project access restriction. Preserve the approved project limits. Missing tool inventory is a configuration finding. A missing or failed service leaves the independently confirmed SSH terminal available, so queue and environment work can continue there within scope.
5. For setup or recovery, use the original saved connection and service attempt. Read health and inventory before deciding to repair. An unknown response requires reconciliation of the same attempt. Check current registration, actual identity, service root and health during reuse. A compatible version warning is diagnostic. If a missing bridge or incompatible capability affects an operation, report that capability and use the appropriate explicit service controls. A missing or unknown receipt never starts another SSH login or replays a start, submit or cancel.

## Manual visible-terminal handoff

Use this path only for a user-selected visible shared terminal. Its ownership control can show **登录完成，交给 Agent** or **交给 Agent**. **我来操作** returns that terminal to the user. Use `list_shared_terminals`, `read_shared_terminal` and `write_shared_terminal` within the grant. On a legacy service-bound terminal, the control transfers that service's use and the terminal is read-only. `inspect_compute_resource` applies only when the selected service advertises it. Hosted SSH resources use the lease flow above.

Service maintenance uses the intended private service channel. Some legacy transports serialize an exchange on the shared shell. Respect its occupied foreground and protocol restoration checks. A timed-out or unknown exchange retains its original fence. Stopping the service channel, ending a shell and ending the entire SSH connection have distinct effects. Preserve existing registration and submitted jobs during recovery. A fresh login may reuse the existing registration after authentication succeeds.

## Record readiness

Record interpreter identity, activation, service handshake, project access, tool inventory, scheduler observation and scientific validation at their actual scope. A login or usable terminal establishes transport. Scheduler output establishes only the queries it answered. An authorized target and a real scientific receipt establish the dependent operation's evidence. Keep actual recipes and raw receipts in private local storage.
