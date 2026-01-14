# BPA API v18 Security Notes

This version adds **production-grade** protections for wallet withdrawals and payout webhooks.

## 1) Idempotency (client retry safety)

Send one of these headers on withdraw create requests:

- `Idempotency-Key: <random-unique-key>`
- `X-Idempotency-Key: <random-unique-key>`

If the client retries with the same key, the API will return the **same** withdraw request instead of creating a duplicate.

## 2) Admin 2FA (TOTP)

Enable strict admin OTP on sensitive routes:

```env
ADMIN_2FA_REQUIRED=true
ADMIN_2FA_TOTP_SECRET=<BASE32_SECRET>
```

Then send the OTP code in the request header:

`x-admin-otp: 123456`

Routes protected:
- Wallet admin approve/pay/retry/status
- Fundraising admin account status + withdraw status

## 3) Payout details encryption

Encrypts `payoutDetailsJson` at rest.

```env
WALLET_PAYOUT_DETAILS_KEY=<32-byte key (base64 recommended)>
```

If the key is missing (dev mode), payout details are stored in plaintext.

The API returns a `payoutDetails` field:
- decrypted JSON if key is available
- `{ encrypted: true, note: "Hidden for security" }` if key is missing

## 4) Webhook signature strict mode

```env
WEBHOOK_SIGNATURE_REQUIRED=true
```

If enabled, invalid/unsigned webhooks are rejected with `401`.

> Note: provider adapters must implement `verifyWebhookSignature()` correctly.

## 5) Admin audit logs

Sensitive admin actions are appended to:

`logs/admin-audit.log`

Each line is JSON (one action per line), includes timestamp, admin user id, IP, and user-agent.

## 6) Recommended infra

- Put the API behind Cloudflare / a WAF
- Enable HTTPS only
- Keep DB credentials least-privilege
- Rotate secrets regularly
