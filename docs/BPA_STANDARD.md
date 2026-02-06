# BPA Standard Plan (Mandatory Rules)

## Architecture Rules
- API port 3000 is reserved and must never change
- Next.js ports are fixed:
  - mother 3100, shop 3101, clinic 3102, admin 3103, owner 3104
- Flutter must use Riverpod for state management

## Code Change Policy
- Never delete existing working code
- Always merge with existing files (do not lose old code)
- Prefer smallest possible patch
- Provide exact apply instructions

## UI Rules
- Follow WowDash components, spacing, colors
- Keep existing layouts unless enhancement is requested

## Workflow Rules
- Always identify affected files before coding
- Confirm touch points (what to change) before implementation
- Avoid global refactors unless approved

## Versioning & Delivery
- Use semantic versions (e.g., v2.0.1 → v2.0.2)
- Patch zips should include only changed/new files

## Documentation / .md files
- All new .md files must be created inside **docs/** (planning, design, guides, changelog, etc.).
- Root folder: only **README.md** stays at repo root; no other .md at root.
- API and Admin “Planning & Docs” read from **docs/** only.
