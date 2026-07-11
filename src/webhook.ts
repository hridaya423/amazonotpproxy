import { simpleParser } from "mailparser";
import { buildBuyerOtpEmail, buildManualReviewEmail, type EmailSender } from "./email.js";
import { findMatchingOrder, type MatchDeps } from "./matcher.js";
import { ParseError, parseAmazonOtpEmail } from "./parser.js";
import type { ParsedAmazonOtpEmail } from "./types.js";

export type WebhookStore = {
  reserveProcessedEmail(messageId: string, rawSubject: string | null): Promise<boolean>;
  finishProcessedEmail(input: {
    messageId: string;
    amazonOrderId?: string | null;
    macondoOrderId?: number | null;
    otp?: string | null;
    sentTo?: string | null;
    status: string;
    error?: string | null;
  }): Promise<void>;
  recordMatchAttempt(input: { messageId: string; extracted: unknown; candidates: unknown; status: string }): Promise<void>;
};

export type WebhookDeps = MatchDeps & {
  store: WebhookStore;
  emailSender: EmailSender;
  outboundFrom: string;
  adminEmail: string;
};

export async function handleInboundEmail(body: Buffer, contentType: string | undefined, deps: WebhookDeps) {
  const inbound = await parseInbound(body, contentType).catch(async (error) => {
    const reason = error instanceof Error ? error.message : "invalid inbound payload";
    await deps.emailSender.send(buildManualReviewEmail({ reason, to: deps.adminEmail, from: deps.outboundFrom }));
    return null;
  });
  if (!inbound) return { status: "manual_review" };

  const messageId = inbound.messageId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const reserved = await deps.store.reserveProcessedEmail(messageId, inbound.subject || null);
  if (!reserved) return { status: "duplicate" };

  let parsed: ParsedAmazonOtpEmail | undefined;
  try {
    if (!authPasses(inbound)) throw new ParseError("Amazon authentication failed");

    parsed = parseAmazonOtpEmail(inbound);
    const match = await findMatchingOrder(parsed, deps);

    if (match.kind === "matched") {
      const message = buildBuyerOtpEmail(parsed, match.order, deps.outboundFrom);
      await deps.emailSender.send(message);
      await deps.store.finishProcessedEmail({
        messageId,
        amazonOrderId: parsed.amazonOrderId,
        macondoOrderId: match.order.order.id,
        otp: parsed.otp,
        sentTo: match.order.buyer.email,
        status: "sent",
      });
      return { status: "sent" };
    }

    await manualReview(messageId, parsed, match.reason, deps);
    return { status: "manual_review" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    await manualReview(messageId, parsed, reason, deps);
    return { status: "manual_review" };
  }
}

async function manualReview(
  messageId: string,
  parsed: ParsedAmazonOtpEmail | undefined,
  reason: string,
  deps: WebhookDeps,
) {
  await deps.store.recordMatchAttempt({ messageId, extracted: parsed || { error: reason }, candidates: [], status: "manual_review" });
  await deps.emailSender.send(buildManualReviewEmail({ parsed, reason, to: deps.adminEmail, from: deps.outboundFrom }));
  await deps.store.finishProcessedEmail({
    messageId,
    amazonOrderId: parsed?.amazonOrderId,
    otp: parsed?.otp,
    status: "manual_review",
    error: reason,
  });
}

async function parseInbound(body: Buffer, contentType = "") {
  if (contentType.includes("application/json")) {
    const json = JSON.parse(body.toString("utf8"));
    if (json.rawMime) {
      const raw = Buffer.from(json.rawMime, json.rawMimeBase64 ? "base64" : "utf8");
      const parsed = await simpleParser(raw);
      return {
        messageId: json.messageId || parsed.messageId || undefined,
        subject: json.subject || parsed.subject || "",
        from: json.from || parsed.from?.text || "",
        text: json.text || parsed.text || undefined,
        html: json.html || String(parsed.html || "") || undefined,
        spf: json.spf,
        dkim: json.dkim,
        dmarc: json.dmarc,
      };
    }
    return json;
  }

  const parsed = await simpleParser(body);
  return {
    messageId: parsed.messageId || undefined,
    subject: parsed.subject || "",
    from: parsed.from?.text || "",
    text: parsed.text || undefined,
    html: String(parsed.html || "") || undefined,
  };
}

function authPasses(input: { spf?: string; dkim?: string; dmarc?: string }) {
  for (const value of [input.spf, input.dkim, input.dmarc]) {
    if (value && value.toLowerCase() !== "pass") return false;
  }
  return true;
}
