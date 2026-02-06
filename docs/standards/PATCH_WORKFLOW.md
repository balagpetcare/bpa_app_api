# BPA Update-only Patch Workflow

## Naming
`bpa-<repo>-vMAJOR.MINOR.PATCH-update-only.zip`

Examples:
- `bpa-api-v10.0.1-update-only.zip`
- `bpa-next-v0.1.1-update-only.zip`

## Contents
```
(update-only files...)
PATCH_NOTES.md
MIGRATION.md (if DB change)
```

## Rules
- Never remove existing features in patch releases.
- Always merge changes, do not overwrite unrelated logic.
- Keep ports fixed: API=3000, mother=3100, shop=3101, clinic=3102, admin=3103, owner=3104.
