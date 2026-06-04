# Super Admin Login Final Fix

## Root Cause

The previous fix updated the existing `01701022274` user, but the required login phone was `01777889994`.

The actual admin login flow performs an exact `user_auth.phone` lookup after normalizing phone input. Before this final fix, `01777889994` existed in `super_admin_whitelist`, but not as a `user_auth.phone` login record. That caused `User not found`.

After the user lookup was repaired, the password was reset using the project-standard bcrypt path to ensure `bG13051049@` matches the stored hash.

## Request Tested

Endpoint:

`POST /api/v1/admin/auth/login`

Payload:

```json
{
  "phone": "01777889994",
  "password": "<provided>"
}
```

The password used for verification was `bG13051049@`.

## Affected User

Final user record:

- `users.id`: `2`
- `user_auth.id`: `2`
- `phone`: `01777889994`
- `email`: `balag@bangladeshpetassociation.com`
- `isActive`: `true`

Organization scope:

- No organization memberships found.

Branch scope:

- No branch memberships found.

Admin scope:

- `ADMIN`
- `GLOBAL`
- `ACTIVE`

## Password Verification Result

The same bcrypt comparison used by login was run against the stored password hash.

Result:

- Hash present: `true`
- `bcrypt.compare("bG13051049@", storedHash)`: `true`
- Failure reason after repair: `NONE`

## Role And Permissions

Roles found:

- `PLATFORM_ADMIN`
- `SUPER_ADMIN`

Permissions include:

- `global.admin`
- `admin.producers.read`
- `admin.producers.write`
- `admin.approvals.manage`
- `admin.audit.read`
- `admin.permissions.read`
- `admin.kyc.manage`
- `medicine.master.read`
- `medicine.master.write`

The `SUPER_ADMIN` role exists and has `global.admin`.

## Fix Applied

Updated `scripts/bootstrap-super-admin.ts` so it correctly handles comma-separated `SUPER_ADMIN_PHONE` values and creates/updates one super-admin user per configured phone.

Updated `scripts/verify-super-admin.ts` so it verifies all configured super-admin phones and emails.

Ran:

```bash
npm run admin:bootstrap
```

Bootstrap result:

- `userId=2` updated to phone `01777889994`, email `balag@bangladeshpetassociation.com`.
- `userId=3` created for phone `01701022274`, email `admin@bangladeshpetassociation.com`.
- Both users have `SUPER_ADMIN`.
- Whitelist rows are active for both phones and both emails.

## Successful Login Proof

Service login:

```json
{
  "success": true,
  "userId": 2,
  "email": "balag@bangladeshpetassociation.com",
  "phone": "01777889994",
  "contexts": [
    {
      "role": "ADMIN",
      "scopeType": "GLOBAL",
      "scopeId": null,
      "status": "ACTIVE"
    }
  ],
  "default_redirect": "/admin",
  "tokenWouldBeIssued": true
}
```

Real HTTP endpoint login:

```json
{
  "statusCode": 200,
  "success": true,
  "tokenIssued": true,
  "userId": 2,
  "phone": "01777889994",
  "email": "balag@bangladeshpetassociation.com",
  "default_redirect": "/admin"
}
```

## Commands

Create or repair super-admin users:

```bash
npm run admin:bootstrap
```

Verify users, whitelist, roles, and permissions:

```bash
npm run admin:verify
```

Test real endpoint:

```bash
curl -i -X POST http://localhost:3000/api/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"01777889994\",\"password\":\"bG13051049@\"}"
```

## Final Status

Credentials now work:

- Phone: `01777889994`
- Password: `bG13051049@`
