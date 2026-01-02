# BPA Node API – Social Login Setup

## New endpoints
- `POST /api/v1/auth/social/google`  body: `{ "idToken": "..." }`
- `POST /api/v1/auth/social/facebook` body: `{ "accessToken": "..." }`

## Environment variables
Copy `.env.example` → `.env` and set:
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`

(Optional)
- `FACEBOOK_APP_ID`
- `FACEBOOK_APP_SECRET`

## Install
```bash
npm install
npm run dev
```

## Notes
- Google: backend verifies `idToken` via `google-auth-library`.
- Facebook: backend fetches profile from Graph API with the provided access token (requires `email` permission).
