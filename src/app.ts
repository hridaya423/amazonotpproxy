import Fastify from "fastify";
import { createSendGridEmailSender } from "./email.js";
import { createProxyPool, ProxyStore } from "./db.js";
import { validWebhookSignature } from "./signature.js";
import { handleInboundEmail, type WebhookDeps } from "./webhook.js";
import { getMacondoOrder } from "./macondo.js";

type AppDeps = WebhookDeps & { storeLink(amazonOrderId: string, macondoOrderId: number, createdBy: string): Promise<void> };

export function createApp(deps: AppDeps, config: { webhookSecret: string; adminToken: string }) {
  const app = Fastify({ logger: false });

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  app.get("/health", async () => ({ ok: true }));

  app.post("/webhooks/inbound-email", async (request, reply) => {
    const body = request.body as Buffer;
    const signature = String(request.headers["x-signature"] || "");
    const timestamp = String(request.headers["x-timestamp"] || "");

    if (!validWebhookSignature({ secret: config.webhookSecret, signature, timestamp, body })) {
      return reply.code(403).send({ error: "invalid signature" });
    }

    const result = await handleInboundEmail(body, request.headers["content-type"], deps);
    return reply.code(200).send(result);
  });

  app.post("/admin/amazon-order-links", async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${config.adminToken}`) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const body = JSON.parse((request.body as Buffer).toString("utf8"));
    const macondoOrderId = Number(body.macondoOrderId);
    if (!/^\d{3}-\d{7}-\d{7}$/.test(body.amazonOrderId) || !Number.isInteger(macondoOrderId)) {
      return reply.code(400).send({ error: "invalid order link" });
    }

    await deps.storeLink(body.amazonOrderId, macondoOrderId, "admin");
    return reply.code(200).send({ ok: true });
  });

  return app;
}

export function createProductionApp() {
  const proxyStore = new ProxyStore(createProxyPool());
  const from = requiredEnv("OUTBOUND_EMAIL_FROM");

  const deps: AppDeps = {
    store: proxyStore,
    findAmazonOrderLink: (amazonOrderId) => proxyStore.findAmazonOrderLink(amazonOrderId),
    getMacondoOrder,
    storeLink: (amazonOrderId, macondoOrderId, createdBy) =>
      proxyStore.createAmazonOrderLink({ amazonOrderId, macondoOrderId, createdBy }),
    emailSender: createSendGridEmailSender({ apiKey: requiredEnv("OUTBOUND_EMAIL_PROVIDER_API_KEY"), from }),
    outboundFrom: from,
    adminEmail: requiredEnv("ADMIN_EMAIL"),
  };

  return createApp(deps, { webhookSecret: requiredEnv("INBOUND_WEBHOOK_SECRET"), adminToken: requiredEnv("ADMIN_TOKEN") });
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
