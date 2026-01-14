# Bangladesh Locations (Prisma)

## 1) Run migrations
- Local:
  - `npx prisma migrate dev`
- Production/Docker:
  - `npx prisma migrate deploy`

## 2) Seed locations only
- `node prisma/seed_location.js`

## 3) Seed everything
- `node prisma/seed_all.js`

## Seed data
- `prisma/seed-data/bd.divisions.json` (full 8 divisions)
- `prisma/seed-data/bd.districts.json` (sample - add full list)
- `prisma/seed-data/bd.upazilas.json` (sample - add full list)
- `prisma/seed-data/dhaka.areas.json` (sample - add full list)
