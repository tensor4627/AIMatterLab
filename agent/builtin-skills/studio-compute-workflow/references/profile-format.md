# Private compute overlays

For a reusable personal note, use `project_skill_catalog` with `scope: user` to locate the current workspace's personal library. Save requested guidance with `write_project_skill` in that scope and read it back. The optional source-checkout localizer below produces a separate portable overlay under the checkout's ignored `.studio/local-skills/` directory.

1. Discover existing AIMatterLab registrations with the user and prepare an explicit JSON profile in an ignored directory. The maintained schema is [compute-profile.schema.json](compute-profile.schema.json). Use existing connection/environment IDs; the overlay does not need a hostname, port, password, key or proxy endpoint.
2. Add only selected local skill **path references** if useful. The localizer does not read or copy their contents. Never store credential contents or free-form activation shell code in a profile.
3. Run `node scripts/localize-skill.mjs --profile <explicit-private-json> --repo <checkout-root>`. The script validates the profile, verifies Git ignores the destination, rejects links and path escapes, and writes a new `.studio/local-skills/<id>/` atomically. Existing overlays are not overwritten.
4. To attach that generated overlay, add its parent directory to the extra skill roots under **科学资源与技能**, then select the overlay for the next message. It includes a reference to its portable parent. Use the current tools and scope for environment checks or a delegated job.

All executable/repository paths are metadata in this helper; it does not run them. Version fields record the user's selected values, not measurements. Generated provenance starts with `validation_status: not_run`. A later actual probe must produce its own evidence and must not rewrite a missing check as passed.

For relocation, distribute the portable skill and localizer, then build a fresh overlay from the recipient's selected registrations. Do not ship another user's `.studio/` or copy absolute paths from a developer machine. Public reports and screenshots omit private connection identities and path details. The public schema intentionally contains no filled deployment values.
