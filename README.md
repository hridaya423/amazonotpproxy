# amazon-otp-proxy

Separate service that receives Amazon delivery OTP emails, matches them to Macondo shop orders, and forwards the OTP to the buyer.

Safe MVP behavior: only exact `amazon_order_links.amazon_order_id -> macondo_order_id` matches auto-send. Missing or ambiguous matches go to manual review.

## Setup

```bash
npm install
npm run build
npm test
```

Required environment:

```bash
PORT=3000
DATABASE_URL=postgres://...
MACONDO_API_BASE_URL=https://macondo.example.com
MACONDO_SERVICE_TOKEN=strong-random-secret
INBOUND_WEBHOOK_SECRET=...
ADMIN_TOKEN=...
OUTBOUND_EMAIL_FROM=otp@yourdomain.com
OUTBOUND_EMAIL_PROVIDER_API_KEY=...
ADMIN_EMAIL=fulfiller@example.com
```

Set `MACONDO_SERVICE_TOKEN` to the same strong secret as Macondo's `NUXT_AMAZON_OTP_PROXY_API_KEY`. The proxy sends it as `Authorization: Bearer ...`; never commit or log the secret.

Optional:

```bash
OUTBOUND_EMAIL_PROVIDER=sendgrid
SLACK_BOT_TOKEN=...
```

## Database

Run `migrations/001_init.sql` against the proxy database.
The proxy database stores the Amazon order ID to Macondo order ID link; Macondo order data is fetched through its authenticated service API.

## Routes

- `GET /health`
- `POST /webhooks/inbound-email`
- `POST /admin/amazon-order-links`

Inbound webhook accepts either raw MIME or JSON with `rawMime`, `messageId`, `subject`, `from`, `text`, and `html` fields. Sign requests with:

```text
x-timestamp: unix-seconds
x-signature: hex(hmac_sha256(INBOUND_WEBHOOK_SECRET, `${timestamp}.${rawBody}`))
```
