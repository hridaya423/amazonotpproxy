import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { findMatchingOrder } from "../src/matcher.js";
import { ParseError, parseAmazonOtpEmail } from "../src/parser.js";
import { signWebhookBody } from "../src/signature.js";
import type { MacondoOrderContext, ParsedAmazonOtpEmail } from "../src/types.js";
import type { WebhookDeps, WebhookStore } from "../src/webhook.js";

const sampleText = `
Your one-time password is 123456

Amazon order 581-1049382-7345126
John - Rome, Italy
* Example Product Name
Quantity: 1
Arriving today 12 pm - 2 pm
https://amazon.in/dp/B0ABCDEF12?shipmentId=ABC123XYZ
`;

test("parses sample Amazon OTP email", () => {
  const parsed = parseAmazonOtpEmail({
    subject: "Your Amazon one-time password",
    from: "Amazon <shipment-tracking@amazon.in>",
    text: sampleText,
  });

  assert.equal(parsed.otp, "123456");
  assert.equal(parsed.amazonOrderId, "581-1049382-7345126");
  assert.equal(parsed.recipientName, "John");
  assert.equal(parsed.cityState, "Rome, Italy");
  assert.equal(parsed.productTitle, "Example Product Name");
  assert.equal(parsed.quantity, 1);
  assert.equal(parsed.arrivalWindow, "today 12 pm - 2 pm");
  assert.equal(parsed.shipmentId, "ABC123XYZ");
  assert.equal(parsed.asin, "B0ABCDEF12");
});

test("extracts OTP from HTML", () => {
  const parsed = parseAmazonOtpEmail({
    subject: "Amazon one-time password",
    from: "shipment-tracking@amazon.in",
    html: `<p>Your one-time password is <b>123456</b></p><p>581-1049382-7345126</p>`,
  });

  assert.equal(parsed.otp, "123456");
});

test("extracts Amazon order id", () => {
  const parsed = parseAmazonOtpEmail({
    subject: "Amazon one-time password",
    from: "shipment-tracking@amazon.in",
    text: sampleText,
  });

  assert.equal(parsed.amazonOrderId, "581-1049382-7345126");
});

test("rejects missing OTP", () => {
  assert.throws(
    () =>
      parseAmazonOtpEmail({
        subject: "Amazon one-time password",
        from: "shipment-tracking@amazon.in",
        text: "Amazon order 581-1049382-7345126",
      }),
    ParseError,
  );
});

test("rejects non-Amazon subject/from", () => {
  assert.throws(
    () => parseAmazonOtpEmail({ subject: "hello", from: "shipment-tracking@amazon.in", text: sampleText }),
    ParseError,
  );
  assert.throws(
    () => parseAmazonOtpEmail({ subject: "Amazon one-time password", from: "attacker@example.com", text: sampleText }),
    ParseError,
  );
});

test("exact amazon_order_links match returns order", async () => {
  const order = orderContext();
  const result = await findMatchingOrder(parsedEmail(), {
    getLinkedMacondoOrderId: async () => 1234,
    getMacondoOrder: async () => order,
    findMacondoCandidates: async () => [],
  });

  assert.equal(result.kind, "matched");
  assert.equal(result.kind === "matched" && result.matchType, "exact");
});

test("no exact match and one high-confidence candidate returns candidate", async () => {
  const result = await findMatchingOrder(
    parsedEmail(),
    {
      getLinkedMacondoOrderId: async () => null,
      getMacondoOrder: async () => null,
      findMacondoCandidates: async () => [orderContext()],
    },
    { allowFallback: true },
  );

  assert.equal(result.kind, "matched");
  assert.equal(result.kind === "matched" && result.matchType, "fallback");
});

test("multiple candidates returns manual review", async () => {
  const result = await findMatchingOrder(
    parsedEmail(),
    {
      getLinkedMacondoOrderId: async () => null,
      getMacondoOrder: async () => null,
      findMacondoCandidates: async () => [orderContext(1234), orderContext(5678)],
    },
    { allowFallback: true },
  );

  assert.equal(result.kind, "manual_review");
});

test("no candidates returns manual review", async () => {
  const result = await findMatchingOrder(
    parsedEmail(),
    {
      getLinkedMacondoOrderId: async () => null,
      getMacondoOrder: async () => null,
      findMacondoCandidates: async () => [],
    },
    { allowFallback: true },
  );

  assert.equal(result.kind, "manual_review");
});

test("invalid signature returns 403", async () => {
  const app = createApp(fakeDeps(), { webhookSecret: "secret", adminToken: "admin" });
  const response = await app.inject({ method: "POST", url: "/webhooks/inbound-email", payload: Buffer.from("{}") });

  assert.equal(response.statusCode, 403);
});

test("duplicate email returns 200 and does not resend", async () => {
  const deps = fakeDeps({ duplicate: true });
  const app = createApp(deps, { webhookSecret: "secret", adminToken: "admin" });
  const body = inboundBody();
  const response = await signedInject(app, body);

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).status, "duplicate");
  assert.equal(deps.sent.length, 0);
});

test("valid email sends one notification and records sent", async () => {
  const deps = fakeDeps();
  const app = createApp(deps, { webhookSecret: "secret", adminToken: "admin" });
  const response = await signedInject(app, inboundBody());

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).status, "sent");
  assert.equal(deps.sent.length, 1);
  assert.equal(deps.finished[0].status, "sent");
  assert.equal(deps.finished[0].sentTo, "buyer@example.com");
});

function parsedEmail(): ParsedAmazonOtpEmail {
  return parseAmazonOtpEmail({ subject: "Amazon one-time password", from: "shipment-tracking@amazon.in", text: sampleText });
}

function orderContext(id = 1234): MacondoOrderContext {
  return {
    order: {
      id,
      status: "pending_internal_fulfillment",
      quantity: 1,
      item_snapshot: { name: "Example Product Name", fulfillment_provider: "internal", kind: "physical" },
      selected_modifiers: null,
      shipping_address: { firstName: "John", lastName: "", city: "Rome", state: "Italy", country: "IT" },
      phone: null,
    },
    user: {
      id: "user_1",
      name: "Atharv",
      email: "buyer@example.com",
      hcb_email: null,
      slack_id: null,
      username: null,
    },
  };
}

function inboundBody() {
  return Buffer.from(
    JSON.stringify({
      messageId: "message-1",
      subject: "Amazon one-time password",
      from: "shipment-tracking@amazon.in",
      text: sampleText,
      spf: "pass",
      dkim: "pass",
      dmarc: "pass",
    }),
  );
}

async function signedInject(app: ReturnType<typeof createApp>, body: Buffer) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return app.inject({
    method: "POST",
    url: "/webhooks/inbound-email",
    headers: {
      "content-type": "application/json",
      "x-timestamp": timestamp,
      "x-signature": signWebhookBody("secret", timestamp, body),
    },
    payload: body,
  });
}

function fakeDeps(options: { duplicate?: boolean } = {}) {
  const sent: unknown[] = [];
  const finished: Array<{ status: string; sentTo?: string | null }> = [];
  const store: WebhookStore = {
    reserveProcessedEmail: async () => !options.duplicate,
    finishProcessedEmail: async (input) => {
      finished.push(input);
    },
    recordMatchAttempt: async () => undefined,
  };

  return {
    sent,
    finished,
    store,
    getLinkedMacondoOrderId: async () => 1234,
    getMacondoOrder: async () => orderContext(),
    findMacondoCandidates: async () => [],
    storeLink: async () => undefined,
    emailSender: { send: async (message: unknown) => void sent.push(message) },
    outboundFrom: "otp@example.com",
    adminEmail: "admin@example.com",
  };
}
