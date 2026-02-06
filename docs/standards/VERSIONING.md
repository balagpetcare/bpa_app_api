# BPA Versioning (SemVer)

We follow **MAJOR.MINOR.PATCH**.

- **PATCH**: bug fix / UI polish / non-breaking endpoint enhancement
- **MINOR**: new feature (backward compatible)
- **MAJOR**: breaking change (API contract/DB breaking, major UI rewrite)

## Update-only ZIP rule
Every delivery must be an **update-only ZIP** containing:
- Only changed files (keep original paths)
- `PATCH_NOTES.md`
- `MIGRATION.md` (only if DB/schema/migration changes)
