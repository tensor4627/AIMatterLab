# SSH service source deltas and remembered locations

This change adds source transfer and setup evidence only. It does not grant project access, execute a scientific task, replay a request, or upgrade an external service without the existing explicit setup/update flow.

## Transfer contract

The fixed loader advertises `gzip-delta-v1` alongside `gzip-files-v1`. Setup/update chooses deltas only when advertised; read-only reuse keeps its existing no-install rule. Existing loaders negotiate their existing full-bundle encoding. No user-selected backend fallback is involved.

When the target immutable runtime is missing, the bridge checks at most the 16 newest owned runtime directories. A candidate must pass real path/ownership/mode, bounded file reads and its complete canonical content hash. `runtime.json` is never a hash oracle. A corrupt old candidate is ignored as a source; a corrupt exact target remains a maintenance failure rather than being overwritten. A foreign profile namespace is not adopted.

The bridge sends the measured file inventory in bounded authenticated fragments. The desktop compares it with its already loaded and verified fixed source bundle; inventory paths never select local filesystem reads. Only added or changed source files are uploaded, with a complete target manifest. The bridge validates each reused/received file and the target canonical digest before executing worker transport code. Existing staging writes a new immutable runtime through an atomic directory rename and rereads every target file before launch. Deleted paths are absent from the new runtime; previous runtime directories and worker/run state remain intact.

A matching target sends zero worker bytes. A delta still transfers the complete manifest metadata, so compressed transfer bytes exceed changed source bytes. Transport-helper bytes have their own independent cache and hash; they are separate from worker bytes. Unknown request/run semantics and no-replay ledgers remain unchanged.

## Location evidence

`compute.sshService.registration` now includes optional `registration.locations` with schema 1 and scope `remote-observed`. It contains the actual login directory; existing project input-root directories obtained from the authenticated worker's project list; and directories containing observed remote cluster `SKILL.md` files. Paths are bounded, absolute, normalized and checked for existence. No directory or skill is created by observation.

Each workspace/skill row has a source, `lastSeenAt`, and `status` (`observed` or `previously-observed`). Missing observations retain previous rows with the latter status. A health response that omits locations preserves prior evidence only for the same profile configuration, host identity and service root, including across runtime upgrades. Host/configuration/root changes do not inherit it. Local project skills introduced separately are stored under the local application profile; they are not remote skill evidence. The pure implementation is shipped beside `session.mjs` so the persistent broker is self-contained; the contracts module re-exports that validator and keeps the `SshLocations` declaration. Both new runtime helpers are explicitly included by the terminal-runtime snapshot, and a real copied session was imported after deleting its owned fixture source tree. The `SshLocations` declaration and `checkedSshLocations`/`mergeSshLocations` functions are the extension boundary for these remote records. The desktop adds the local project skill store’s actual root as `localProjectSkillsRoot` to the settings response. This path stays on the desktop.

Users can inspect the paths under the existing job-service settings' “已登记的位置” section or the registration API. The local catalog survives desktop recreation; the record is setup evidence, never a live connection or authorization.

## Validation scope

- passed: 173 affected Node tests (157 service/protocol tests plus 16 terminal-runtime tests), including source selection, registration persistence using a real SQLite catalog close/reopen, changed-host/config rejection, runtime reconciliation, update/lifecycle, fragmented protocol handling and no-replay/security regressions.
- passed: 20 existing Linux transport/cache tests. Their health identity comparisons exclude only the new per-connection location observation timestamp; runtime, host and endpoint identity remain compared.
- passed: 2 additional Linux delta tests covering real files and an actual isolated loopback worker. Cases: cold install, two warm attaches, one changed file, one added file, deletion from a new target runtime, full-manifest/reused-byte corruption refusal, observed project and remote skill directories. No SSH or scientific engine/job was used.
- passed: TypeScript and isolated Chromium / hidden Electron settings-component checks. The details section shows remembered paths and the previous-observation label, makes only the two expected read calls and creates no connection. The native screenshot was inspected; native capture uses `stayHidden: true`.
- failed during development: old tests compared the full health object including the newly measured timestamp; comparisons now preserve all identity checks while treating observation time separately. A hidden Electron Playwright screenshot timed out after its assertions passed; native `capturePage` with `stayHidden`/`stayAwake` produced the final evidence without displaying a window.
- blocked: none.
- not_run: production SSH/cluster access, real model calls, scientific calculations, complete test matrix, release packaging. The release version and combined changelog are managed by the integrating agent.

Raw evidence remains in ignored `.studio/validation/cluster-delta/` in the isolated worktree, including Node output, existing/delta Python output, component result JSON and screenshots. Fixtures use generated temporary directories and synthetic public paths; no user cluster hostname, credentials or personal path is stored in this document.

The recorded Linux delta receipt (compressed bytes include manifest metadata) was:

| Case | Changed source bytes | Compressed worker transfer bytes |
| --- | ---: | ---: |
| First install | 927359 | 383189 |
| Warm attach | 0 | 0 |
| Second warm attach | 0 | 0 |
| One changed file | 535 | 7839 |
| One added file | 27 | 7325 |
| Delete one file and change another | 560 | 7867 |
