---
name: studio-install-readiness
description: Audit or install AIMatterLab from its versioned one-prompt entry, reuse explicit existing compute registrations, and distinguish real readiness evidence from skipped downloads, installations, or scientific routes.
---

# AIMatterLab installation and existing-machine readiness

For a named scientific package such as HotHam, use `software.catalog` for its release source, upstream installation guide and test cases. On a hosted resource use `cluster.resource-tools` for its resource-specific configuration. This guide covers installation and readiness of the AIMatterLab application.

For a packaged desktop, start with its setup guide, **计算资源** and **账号与 API** for the part the user requested. For an explicit source installation or `reuse-existing` audit, read `INSTALL_AGENT.md`, `installation/manifest.json`, `installation/config.example.json` and `docs/one-prompt-install.md` in that checkout and use its actual installer interface and fixtures.

Discover available local runtimes, explicit scientific environments and SSH aliases read-only as needed for the selected route. Windows OpenSSH uses the local Windows client for remote SSH. Discover WSL distributions when the user selects local Linux execution or a WSL SSH client. Keep discovered paths, account/connection references and detailed probe receipts in an ignored private configuration. Never request API keys, passwords or SSH key contents in chat. Try the selected existing provider with an actual model sentinel; missing account metadata or advisory auth flags cannot substitute for that capability check. Record account metadata availability separately from model access. When actual access requires authentication, the user completes login inside the isolated AIMatterLab profile; never copy another profile's credential files.

## Desktop first launch

For a new desktop profile, the setup guide offers language and appearance, the selected provider, WSL or SSH, and a copper-cell workflow tour. Users can defer either connection and reopen the guide from the title bar. Authentication stays with the user. On a hosted SSH connection use `compute.queue` to acquire the current chat's own lease and inspect the selected resource. A request prepared by the guide for `worker`, `reference-md` or `pydyn-md` is an editable chat draft. Prepare the selected check using the installed fixtures and obtain its actual execution receipt before reporting its result.

After upgrading, retain the saved SSH profile and use `compute.queue` to recover its original connection. Verify whether that connection is still live or the user must explicitly sign in again. Keep any live jobs bound to their original run records.

In **账号与 API**, Codex supports its ChatGPT or API route, Kimi uses its local CLI and device sign-in, Qwen and Custom API use API profiles, and DeepSeek uses the bundled DSH runtime. Use the credential type exposed by the selected provider profile. Check the selected provider with an actual reply. The Kimi CLI picker applies when Kimi needs its optional runtime.

For a source installation, an existing-machine audit or confirmation that the generated launcher sees the selected environment, read [installation and audit evidence](references/installation-audit.md). For optional local CLI discovery/installation, Codex first connection or Electron download and proxy diagnosis, read [provider and network setup](references/provider-network.md). Use the document IDs advertised by `installation.readiness`.
