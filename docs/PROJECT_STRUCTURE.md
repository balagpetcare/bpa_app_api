# BPA API – Project Structure (Baseline V11.0.1.0)

## Goals
- Feature/module based API (`src/api/v1/modules/*`)
- Prisma kept at project root (`prisma/`)
- Clear separation: routes → controller → service → prisma

## Folder Map

- `src/server.js` – server entry
- `src/app.js` – express app setup
- `src/config/` – env, cors, app config
- `src/api/v1/modules/` – domain modules
  - `<module>.routes.js`
  - `<module>.controller.js`
  - `<module>.service.js`

## Prisma
- `prisma/schema.prisma`
- `prisma/seed.ts` + `prisma/seeders/*`
- `prisma/seed-data/*` (JSON)

## Conventions
- New endpoints: create a new module folder or extend an existing module.
- Keep Prisma queries in `*.service.js` (current pattern). If a service grows > ~700 lines, split into `*.repo.js` for queries and `*.service.js` for business logic.
