# API dev run modes and `dist/` (guardrail)

## Commands

| Command | What runs | When to use |
|--------|-----------|-------------|
| **`npm run dev`** | `nodemon` + **`ts-node`** loads **`src/`** | **Default for local development.** Routes and controllers match the repo immediately. |
| **`npm start`** | **`node dist/index.js`** | Production-style run **only after** a successful **`npm run build`**. |

## Stale `dist` symptom

If `src` added or changed a route but **`dist/` was not rebuilt**, `npm start` can return a global **404** with message like **`Route not found: GET /api/v1/...`**. That is an **Express no-match**, not application business logic.

**Example fixed in-repo:** `GET /api/v1/clinic/branches/:branchId/patients/:petId/clinical-overview` is mounted on the **main** `src/api/v1/routes.ts` so it survives partial `clinic.routes.js` drift; the same path is **not** duplicated in `clinic.routes.ts` (single source of truth for that handler).

## Recommendations

1. Prefer **`npm run dev`** while iterating on TypeScript.
2. Before relying on **`npm start`**, run **`npm run build`** and ensure it completes (no `tsc` errors).
3. If you see **`Route not found`** for a path you know exists in `src`, suspect **stale `dist`** or wrong process/port.

## Prisma client bootstrap (`Cannot find module '.prisma/client/default'`)

`@prisma/client` re-exports the **generated** client from `node_modules/.prisma/client/`. That folder is **not** in git; it is produced by **`prisma generate`** (via the **local** CLI only — see below).

**Normal recovery**

1. From repo root: **`npm install`** or **`npm ci`** (runs **`postinstall` →** local **`generate`**).
2. If artifacts were deleted or install skipped hooks: **`npm run prisma:generate`** or **`npm run setup:prisma`** (`validate` + `generate`).
3. **`npm run build`** runs **`prebuild` →** local **`generate`** so production builds do not ship without a client.

**Database** (separate from client generation): **`npm run prisma:migrate:deploy`** (alias **`npm run prisma:migrate`**). Dev loop: **`npm run prisma:migrate:dev`**. Status: **`npm run prisma:migrate:status`**. Full local chain: **`npm run bootstrap:dev`** or **`bootstrap:deploy`**.

**Versions:** `prisma` and `@prisma/client` are pinned to **5.22.0** in `package.json`.

### Local Prisma only (avoid Prisma 7 / wrong schema)

Scripts invoke **`node scripts/run-local-prisma.cjs`**, which runs the **installed** `prisma` package under `node_modules` and **never** downloads a different version.

- **Do not** run bare **`npx prisma ...`** when `node_modules` is missing or broken — **npx can fetch Prisma 7**, which rejects this schema’s `datasource url = env("DATABASE_URL")` and may report **“No seed command configured”** for this project’s `package.json` layout.
- Prefer **`npm run`** targets: **`prisma:generate`**, **`prisma:migrate:deploy`**, **`seed`**, **`prisma:version`** (expect **5.22.x**).

### Windows: `EPERM` / `unlink` on `query_engine-windows.dll.node`

**Cause:** A process still has the Prisma engine open (common: **`npm run dev:api`**, tests, or another Node tool).

**Before `npm ci`, `npm run setup:prisma`, or `npm run prisma:generate`:**

1. Stop the API / nodemon in every terminal (**Ctrl+C**).
2. If **`npm ci`** still fails, end remaining **Node.js** processes (Task Manager, or PowerShell: inspect with **`Get-Process node`** and stop only what you intend).
3. Retry **`npm ci`** then **`npm run setup:prisma`**.
4. If **`EPERM`** persists on **`npm ci`**, stop every Node process, run **`npm run clean:modules`** (removes **`node_modules`**), then **`npm ci`** again.

### Seed

**`npm run seed`** (and **`npm run db:seed`**) run **`prisma db seed`** via the local CLI. The command is configured at the bottom of **`package.json`** under **`"prisma": { "seed": "..." }`** and executes **`prisma/seed.ts`** with **ts-node** (requires devDependencies installed).

### Warehouse enterprise tables

After migrations, optional check (same **`DATABASE_URL`** as the API):

```text
npm run verify:warehouse-enterprise-db
```

If tables are **MISSING**, the script prints **`npm run prisma:migrate:deploy`** / **`prisma:generate`** recovery hints and exits non-zero.
