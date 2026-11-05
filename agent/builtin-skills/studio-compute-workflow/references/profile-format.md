# Private compute overlays

The public skill describes transferable decisions. Local deployment facts belong under `.studio/local-skills/`, already ignored by the repository. Generated overlays are local guidance, not verified environment registrations or a grant of project authorization.

1. Discover existing Studio registrations with the user and prepare an explicit JSON profile in an ignored directory. The maintained schema is [compute-profile.schema.json](compute-profile.schema.json). Use existing connection/environment IDs; the overlay does not need a hostname, port, password, key or proxy endpoint.
2. Add only selected local skill **path references** if useful. The localizer does not read or copy their contents. Never store credential contents or free-form activation shell code in a profile.
3. Run `node scripts/localize-skill.mjs --profile <explicit-private-json> --repo <checkout-root>`. The script validates the profile, verifies Git ignores the destination, rejects links and path escapes, and writes a new `.studio/local-skills/<id>/` atomically. Existing overlays are not overwritten.
4. Register the generated private root as an additional local skill root in Studio. When a local guide is selected, load its portable parent first. Separate installer/desktop tools must still probe and register environments and obtain the user's review before execution.

All executable/repository paths are metadata in this helper; it does not run them. Version fields record the user's selected values, not measurements. Generated provenance starts with `validation_status: not_run`. A later actual probe must produce its own evidence and must not rewrite a missing check as passed.

For relocation, distribute the portable skill and localizer, then build a fresh overlay from the recipient's selected registrations. Do not ship another user's `.studio/` or copy absolute paths from a developer machine. Public reports and screenshots omit private connection identities and path details. The public schema intentionally contains no filled deployment values.
