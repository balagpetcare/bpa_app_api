# BPA Prisma Seeds (Copy‑Paste Ready)

এই ZIP-এর উদ্দেশ্য: DB পুরো reset/drop হলেও **Bangladesh location + Dhaka city + payout catalog + branch types** আবার ১ কমান্ডে seed হবে।

## 1) কী কপি করবেন
- এই ZIP এর `prisma/` ফোল্ডারটি আপনার প্রোজেক্টের `prisma/` ফোল্ডারের সাথে replace/merge করুন
- এই ZIP এর `scripts/` ফোল্ডারটি আপনার backend project root‑এ কপি করুন

## 2) package.json (একবার সেটাপ)
আপনার backend প্রোজেক্টের `package.json` এ নিচের `prisma.seed` যোগ করুন:

```json
{
  "prisma": {
    "seed": "ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts"
  }
}
```

এবং dev dependency নিশ্চিত করুন:

```bash
npm i -D ts-node typescript
```

## 3) রান কমান্ড
### Full reset + migrate + seed (সবচেয়ে সেফ)
```powershell
.\scripts\db-reset.ps1
```

### শুধু seed
```powershell
.\scripts\db-seed.ps1
```

### Prod-like deploy (migrate deploy + seed)
```powershell
.\scripts\db-deploy.ps1
```

## Notes
- Seed স্ক্রিপ্টগুলো upsert‑based হওয়ায় একাধিকবার চালালেও ডাটা duplicate হবে না।
- `prisma/seed.ts` এই প্রোজেক্টে লোকেশন + Dhaka + payout + branch types seed করে।

আপনার backend প্রোজেক্টের `package.json` এ নিচের অংশ যোগ করুন (বা মিলিয়ে নিন):

```json
{
  "prisma": {
    "seed": "ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts"
  },
  "scripts": {
    "db:reset": "prisma migrate reset --force",
    "db:seed": "prisma db seed",
    "db:deploy": "prisma migrate deploy && prisma db seed"
  }
}
```

> Note: `ts-node` এবং `typescript` devDependency হিসেবে থাকা লাগবে:

```bash
npm i -D ts-node typescript
```

## 3) ১ কমান্ডে DB reset + seed (Dev)
PowerShell (Windows):

```powershell
./scripts/db-reset.ps1
```

অথবা npm script:

```bash
npm run db:reset
```

## 4) শুধু seed (migrations done থাকলে)
```powershell
./scripts/db-seed.ps1
```

বা
```bash
npm run db:seed
```

## 5) Production-like deploy
```powershell
./scripts/db-deploy.ps1
```

বা
```bash
npm run db:deploy
```

> Note: `ts-node` এবং `typescript` devDependency হিসেবে থাকা লাগবে:

```bash
npm i -D ts-node typescript
```

## 3) ১ কমান্ডে DB reset + seed
PowerShell থেকে প্রোজেক্ট root‑এ:

```powershell
./scripts/db-reset.ps1
```

অথবা npm script দিয়ে:

```bash
npm run db:reset
```

## 4) শুধু seed (মাইগ্রেশন না)
```powershell
./scripts/db-seed.ps1
```

অথবা:
```bash
npm run db:seed
```

## 5) Production deploy টাইপ
```powershell
./scripts/db-deploy.ps1
```

অথবা:
```bash
npm run db:deploy
```

## Seed এর ভিতরে কী থাকে
- Base Bangladesh locations (division/district/upazila/legacy areas)
- Dhaka city hierarchy (DNCC/DSCC)
- Fundraising payout catalog
- Branch types master

## 5) Production style deploy (migrate deploy + seed)
```powershell
./scripts/db-deploy.ps1
```

অথবা:
```bash
npm run db:deploy
```

## Seed entrypoint
Main seed file: `prisma/seed.ts`
- Base BD locations
- Dhaka city hierarchy
- Fundraising payout catalog
- Branch types
