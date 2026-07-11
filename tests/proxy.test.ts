import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { getMacondoOrder } from "../src/macondo.js";
import { findMatchingOrder } from "../src/matcher.js";
import { ParseError, parseAmazonOtpEmail } from "../src/parser.js";
import { signWebhookBody } from "../src/signature.js";
import type { MacondoOrderResponse, ParsedAmazonOtpEmail } from "../src/types.js";
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
  const order = macondoOrder();
  const result = await findMatchingOrder(parsedEmail(), {
    findAmazonOrderLink: async () => ({ macondoOrderId: 1234 }),
    getMacondoOrder: async () => order,
  });

  assert.equal(result.kind, "matched");
  assert.equal(result.kind === "matched" && result.order, order);
});

test("missing Amazon order link returns manual review", async () => {
  const result = await findMatchingOrder(parsedEmail(), {
    findAmazonOrderLink: async () => null,
    getMacondoOrder: async () => macondoOrder(),
  });

  assert.deepEqual(result, { kind: "manual_review", reason: "No Macondo order link" });
});

test("cancelled Macondo order returns manual review", async () => {
  const order = macondoOrder();
  order.order.status = "cancelled";
  const result = await findMatchingOrder(parsedEmail(), {
    findAmazonOrderLink: async () => ({ macondoOrderId: order.order.id }),
    getMacondoOrder: async () => order,
  });

  assert.deepEqual(result, { kind: "manual_review", reason: "Macondo order is cancelled" });
});

test("non-physical Macondo order returns manual review", async () => {
  const order = macondoOrder();
  order.order.item_snapshot = { kind: "digital" };
  const result = await findMatchingOrder(parsedEmail(), {
    findAmazonOrderLink: async () => ({ macondoOrderId: order.order.id }),
    getMacondoOrder: async () => order,
  });

  assert.deepEqual(result, { kind: "manual_review", reason: "Macondo order is not physical" });
});

test("buyer without email returns manual review", async () => {
  const order = macondoOrder();
  order.buyer.email = "";
  const result = await findMatchingOrder(parsedEmail(), {
    findAmazonOrderLink: async () => ({ macondoOrderId: order.order.id }),
    getMacondoOrder: async () => order,
  });

  assert.deepEqual(result, { kind: "manual_review", reason: "Buyer has no email" });
});

test("Macondo request uses the configured Bearer token", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.MACONDO_API_BASE_URL;
  const originalToken = process.env.MACONDO_SERVICE_TOKEN;
  process.env.MACONDO_API_BASE_URL = "https://macondo.example.com///";
  process.env.MACONDO_SERVICE_TOKEN = "test-token";

  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://macondo.example.com/api/service/amazon-otp-proxy/orders/1234");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token");
      return Response.json(macondoOrder());
    };

    assert.equal((await getMacondoOrder(1234)).order.id, 1234);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.MACONDO_API_BASE_URL;
    else process.env.MACONDO_API_BASE_URL = originalBaseUrl;
    if (originalToken === undefined) delete process.env.MACONDO_SERVICE_TOKEN;
    else process.env.MACONDO_SERVICE_TOKEN = originalToken;
  }
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

function macondoOrder(id = 1234): MacondoOrderResponse {
  return {
    order: {
      id,
      user_id: "user_1",
      item_id: 10,
      status: "pending_internal_fulfillment",
      quantity: 1,
      item_snapshot: { name: "Example Product Name", fulfillment_provider: "internal", kind: "physical" },
      selected_modifiers: null,
      shipping_address: {
        firstName: "John",
        lastName: "",
        address1: "1 Via Roma",
        city: "Rome",
        state: "Italy",
        postalCode: "00100",
        country: "IT",
      },
      phone: null,
      tracking_number: null,
      external_reference: null,
      region: null,
      created_at: null,
      updated_at: null,
    },
    item: {
      id: 10,
      slug: "example-product",
      name: "Example Product Name",
      kind: "physical",
      fulfillment_provider: "internal",
    },
    buyer: {
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
    findAmazonOrderLink: async () => ({ macondoOrderId: 1234 }),
    getMacondoOrder: async () => macondoOrder(),
    storeLink: async () => undefined,
    emailSender: { send: async (message: unknown) => void sent.push(message) },
    outboundFrom: "otp@example.com",
    adminEmail: "admin@example.com",
  };
}
