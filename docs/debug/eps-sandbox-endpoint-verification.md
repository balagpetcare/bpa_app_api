# EPS sandbox endpoint verification (2026-06-04)

## Summary

| URL | DNS | API `POST /v1/Auth/GetToken` | Verdict |
|-----|-----|------------------------------|---------|
| `https://sandboxpgapi.eps.com.bd` | OK (`210.4.69.194`) | **200 + JWT token** (demo credentials) | **Correct sandbox API** |
| `https://pgapi.eps.com.bd` | OK | 200, auth error with demo creds | **Correct production API** |
| `https://sandbox-pgapi.eps.com.bd` | **NXDOMAIN** | unreachable | Wrong hostname (hyphen) |
| `https://sandboxpg.eps.com.bd` | OK | 404 on API path | Payment UI host only |

## Configuration updated

- `paymentProvider.config.ts` — `EPS_SANDBOX_DEFAULT_BASE` → `https://sandboxpgapi.eps.com.bd`
- `.env`, `.env.example` — `EPS_BASE_URL`
- `docs/vaccination-campaign-2026/eps-payment-provider.md`
- `docs/campaign-v2/campaign-payment-production-readiness-audit.md`

## Smoke test

```bash
node scripts/verify-eps-endpoint.js
```

Restart the API after changing `.env` so `getEpsConfig()` picks up the new base URL.
