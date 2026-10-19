# GPU Sampling Studio development evidence loop

Use this runbook for an explicitly requested multi-round Studio development review. Keep it in development documentation; do not inject it into scientific Agent conversations. The workflow-authoring skill remains a separate product capability.

## Roles and one-round gate

| Role | Responsibility | Required current evidence |
| --- | --- | --- |
| A · user and scientific tester | Operate the actual Electron UI with ordinary language and clicks, and independently run every implemented scientific route | Natural user prompts/actions/replies, same-page/file checks, per-route fresh run IDs, exits and output assertions |
| B · engineer | Diagnose observed friction, implement assigned changes and turn portable learning into narrowly scoped skills | Reproduction, observation versus inferred root cause, changed behavior, source/component tests and raw evidence references |
| C · responsible reviewer | Independently challenge scope and verify whether each round deserves acceptance | An explicit passed/rejected verdict with source/evidence hashes, unresolved defects and retained rejection history |

The parent coordinates shared file ownership. A round needs a concrete user-visible improvement or a correctness/reliability repair; renaming a phase or repeating an unchanged test is not a new iteration. C must accept the current round before the next round's tracked changes begin. Rejected attempts remain in the evidence record and are repaired within the same round. Complete the number of rounds the user requested rather than silently shortening the loop.

## Evidence collection

Before each round, record the application's tested source identity and preserved sibling engine state. Allocate fresh ignored run/worker roots with nonconflicting ports. Use isolated profiles; a deliberate resume/recovery test may reuse a prior test-owned profile, recording its source/history identity and requiring fresh current executions. Preserve production profiles, SSH registrations, credentials, authorizations and real queued/running/unknown jobs. Never switch engine branches or automatically resubmit an unknown job. Read each repository's applicable AGENTS instructions.

A inventories the currently implemented routes rather than copying a historical route count. The mandatory core set is PyDyn MD, GPUMD MD, PyDyn-pyGAS sampling, GPUMD GPU-Sampling and the implemented NEB route. Also run implemented training, independent evaluation, export, bias validation, reweighting and analysis routes with bounded current fixtures. Mark missing environments/adapters/fixtures blocked or not_run, with the exact reason. Keep backend route evidence separate from the actual human UI chain; neither substitutes for the other.

For UI evidence, use natural goals and supplied scientific inputs. Do not make the prompt an internal tool recipe, prebuilt graph JSON or list of private task/project IDs. Exercise initial authoring, human review, execution confirmation where authorized, and same-conversation continuation. Verify saved source/graph/config files and hashes, not just an answer or green dot. Include actual file selection, manual parameter editing, navigation and reopening when they are part of the change. Model behavior is not proven by direct IPC calls or a mock service. Before confirming deployment, wait for the actual current prepared run identity and revisions, completed asynchronous preparation and its real input snapshots; an already visible historical snapshot list is not a new preparation receipt. Preserve disabled gates and report races rather than forcing a click or reusing a check.

Independently audit actual exits and finite/structural output assertions. Separate input completeness, adapter validation, artifact reload, runtime integration, optimizer stopping, sampling coverage and physical validity. A short engineering example cannot prove model accuracy, production stability, a reliable barrier or a converged free-energy surface. A draft-only user request must stay draft-only; developer artifact checks use a separate copy and are labeled separately.

## Engineering and review records

B writes a private per-round review with reproduction, observed effect, probable cause, specific change, current validation and remaining limits. Keep discovered failures and recovered attempts. C checks the raw evidence and source diff independently; mock/component tests are useful software checks but are never current scientific runs. If source changes after an evidence snapshot, record the new identity and assess which checks need rerunning.

Use typed, main-process-validated IPC. Keep the renderer free of filesystem, process and credential access. Project authorization remains outside MCP control. Scientific parameters and actual executable inputs must agree; do not modify a comment, evidence note or hash marker to bypass stale-input protection.

Store private prompts, machine paths, connection details and raw reports only in ignored runtime roots. Public iteration notes describe behavior, coverage, passed/failed/blocked/not_run and limitations without SSH/proxy endpoints, accounts, credentials or private research inputs. Public skills contain portable reasoning and tool contracts, never developer-machine recipes. Update CHANGELOG and the version document. Verify the actual package before a local release tag; do not invent historical commits or push without authorization.

## Joint UI finish

After the requested rounds pass, A, B and C review frontend clarity, flow, consistency and visual quality together. Choose a bounded set of concrete changes, implement them, then inspect the actual UI in supported themes/layouts/font sizes. Recheck affected interactions and preserve the accepted scientific/execution boundaries. Summarize the resulting user benefit and material remaining limitations. Any final UI edit changes the application fingerprint: create a new bounded readiness audit or explicitly rerun affected source-sensitive checks before calling the final package validated; do not relabel an earlier frozen-source receipt current.
