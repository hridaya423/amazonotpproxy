import { createHmac, timingSafeEqual } from "node:crypto";

export function validWebhookSignature(input: {
  secret: string;
  signature: string | undefined;
  timestamp: string | undefined;
  body: Buffer;
  now?: number;
}) {
  if (!input.signature || !input.timestamp) return false;

  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) return false;

  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) return false;

  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.`)
    .update(input.body)
    .digest("hex");

  const got = Buffer.from(input.signature, "hex");
  const want = Buffer.from(expected, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

export function signWebhookBody(secret: string, timestamp: string, body: Buffer) {
  return createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
}
