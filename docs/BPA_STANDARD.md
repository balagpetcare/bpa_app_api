# BPA Standard Plan (Mandatory Rules)

## Architecture Rules
- API port **3000** is reserved and must never change
- **bpa_web** Next.js ports are fixed by `SITE_MODE`:
  - mother / staff **3100**, shop **3101**, clinic **3102**, admin **3103**, owner **3104**, producer **3105**, country **3106**, doctor **3107**
- **Standalone Next.js frontends** (separate repos):
  - **bpa-landing:** **3101** (production nginx upstream for apex domain)
  - **vaccination_2026:** **3110** (production nginx upstream for campaign subdomain)
- **Reserved:** ports **3111–3119** for future standalone frontends
- **Local dev:** `bpa-landing` and `bpa_web` shop both bind **3101** — do not run both on one workstation without a documented port override (see [infrastructure/PORT_AND_DOMAIN_MAP.md](./infrastructure/PORT_AND_DOMAIN_MAP.md))
- **Production:** host-based routing via Nginx; each app may use the same numeric port in separate containers
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
- **Port and domain changes** must update [docs/infrastructure/PORT_AND_DOMAIN_MAP.md](./infrastructure/PORT_AND_DOMAIN_MAP.md), [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md), and this file together.
