import type { ParsedAmazonOtpEmail } from "./types.js";

export class ParseError extends Error {}

const AMAZON_SENDERS = ["shipment-tracking@amazon.in"];

export function parseAmazonOtpEmail(input: {
  subject: string;
  from: string;
  text?: string;
  html?: string;
}): ParsedAmazonOtpEmail {
  if (!/one[- ]time password/i.test(input.subject)) {
    throw new ParseError("not an Amazon OTP subject");
  }

  const from = input.from.toLowerCase();
  if (!AMAZON_SENDERS.some((sender) => from.includes(sender))) {
    throw new ParseError("not an expected Amazon sender");
  }

  const body = normalizeText(input.text || htmlToText(input.html || ""));
  const otpMatches = [...body.matchAll(/one-time password is\s+(\d{4,8})/gi)].map((match) => match[1]);
  if (otpMatches.length !== 1) {
    throw new ParseError("expected exactly one OTP");
  }

  const amazonOrderIds = new Set(body.match(/\b\d{3}-\d{7}-\d{7}\b/g) || []);
  if (amazonOrderIds.size !== 1) {
    throw new ParseError("expected exactly one Amazon order id");
  }

  const recipient = body.match(/^(.+?)\s+[–-]\s+(.+)$/m);
  const quantity = body.match(/Quantity:\s*(\d+)/i);
  const arriving = body.match(/Arriving today\s+(.+)/i);
  const shipment = (input.html || body).match(/shipmentId=([A-Z0-9]+)/i);
  const asin = (input.html || body).match(/\/dp\/([A-Z0-9]{10})/i);

  return {
    otp: otpMatches[0],
    amazonOrderId: [...amazonOrderIds][0],
    recipientName: recipient?.[1]?.trim() || null,
    cityState: recipient?.[2]?.trim() || null,
    productTitle: extractProductTitle(body, input.html),
    quantity: quantity ? Number(quantity[1]) : null,
    arrivalWindow: arriving ? `today ${arriving[1].trim()}` : null,
    shipmentId: shipment?.[1] || null,
    asin: asin?.[1] || null,
  };
}

function normalizeText(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;/g, "-");
}

function extractProductTitle(text: string, html?: string) {
  const bullet = text.match(/^\s*\*\s*(.+)$/m)?.[1]?.trim();
  if (bullet) return bullet;

  const alt = html?.match(/alt=["']([^"']+)["']/i)?.[1]?.trim();
  if (alt) return alt;

  return null;
}
