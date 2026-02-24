# Producer Staff Invite — cURL examples

Base URL: `http://localhost:3000/api/v1/producer`

Auth: Producer panel uses cookies. For API testing you need a valid session cookie or Bearer token from producer login. Replace `<token>` or use `-b cookies.txt` after logging in via browser/curl.

## 1. Email only

```bash
curl -i -X POST "http://localhost:3000/api/v1/producer/staff/invite" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"email":"someone@example.com","roleKey":"PRODUCER_VIEWER"}'
```

With `role` (alias for roleKey):

```bash
curl -i -X POST "http://localhost:3000/api/v1/producer/staff/invite" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"email":"someone@example.com","role":"STAFF"}'
```

## 2. Phone only

```bash
curl -i -X POST "http://localhost:3000/api/v1/producer/staff/invite" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"phone":"+8801XXXXXXXXX","roleKey":"PRODUCER_STAFF"}'
```

## 3. Both email and phone

```bash
curl -i -X POST "http://localhost:3000/api/v1/producer/staff/invite" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"email":"someone@example.com","phone":"+8801XXXXXXXXX","roleKey":"PRODUCER_VIEWER"}'
```

## 4. Invalid payload — missing email and phone (expect 400)

```bash
curl -i -X POST "http://localhost:3000/api/v1/producer/staff/invite" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"roleKey":"PRODUCER_VIEWER"}'
```

Expected response (400):

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "At least one of email or phone is required",
  "fields": {
    "email": "Provide an email address",
    "phone": "Or provide a phone number"
  }
}
```

## 5. Invalid role (expect 400)

```bash
curl -i -X POST "http://localhost:3000/api/v1/producer/staff/invite" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"email":"a@b.com","roleKey":"INVALID_ROLE"}'
```

Expected: 400 with `code: "INVALID_ROLE"`.

## Success responses

- **Registered user:** 201, `{ "success": true, "data": { "mode": "REGISTERED", "inviteId": 1, "invite": { ... } } }`
- **Unregistered user:** 201, `{ "success": true, "data": { "mode": "UNREGISTERED", "inviteId": 1, "inviteLink": "http://.../producer/invites/accept?token=...", "invite": { ... } } }`
