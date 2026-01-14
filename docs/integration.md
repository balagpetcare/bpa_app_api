# Integration Notes

## 1) Express Router mount
আপনার main router / app.ts এ:
```ts
import { phase0Router } from "./src/routes/phase0.sample.routes";
app.use("/api/v1", phase0Router);
```

## 2) Error handling
এই patch ধরে নিয়েছে আপনার express app এ already common error handler আছে.
নাহলে sample:
```ts
app.use((err, _req, res, _next) => {
  const status = err.statusCode || 500;
  res.status(status).json({ message: err.message || "Server error" });
});
```

## 3) Auth adapter
`getAuthContext(req)` কে আপনার JWT/session middleware এর সাথে connect করুন।

Minimum expected output:
- userId
- orgId (staff scope)
- staffId (StaffProfile.id)
- permissions array
- branchIds (assigned branches)