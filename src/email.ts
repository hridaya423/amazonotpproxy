import type { MacondoOrderResponse, ParsedAmazonOtpEmail } from "./types.js";

export type EmailMessage = { to: string; subject: string; text: string };
export type EmailSender = { send(message: EmailMessage): Promise<void> };

export function buildBuyerOtpEmail(parsed: ParsedAmazonOtpEmail, order: MacondoOrderResponse, from: string): EmailMessage & { from: string } {
  const item = order.order.item_snapshot?.name ?? order.item?.name ?? parsed.productTitle ?? "Macondo shop item";
  return {
    from,
    to: order.buyer.email,
    subject: `Amazon delivery OTP for Macondo order #${order.order.id}`,
    text: [
      `Your Amazon delivery OTP for Macondo order #${order.order.id} is ${parsed.otp}.`,
      "",
      `Item: ${item}`,
      `Amazon order: ${parsed.amazonOrderId}`,
      parsed.arrivalWindow ? `Arriving: ${parsed.arrivalWindow}` : null,
      "",
      "Only share this OTP with the delivery person in person.",
      "Do not share it over phone or intercom.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function buildManualReviewEmail(input: {
  parsed?: ParsedAmazonOtpEmail;
  reason: string;
  to: string;
  from: string;
}) {
  const parsed = input.parsed;
  return {
    from: input.from,
    to: input.to,
    subject: "Manual review needed for Amazon OTP",
    text: [
      "Could not auto-forward Amazon OTP.",
      "",
      `Reason: ${input.reason}`,
      parsed ? `Amazon order: ${parsed.amazonOrderId}` : null,
      parsed ? `OTP: ${parsed.otp}` : null,
      parsed ? `Recipient: ${[parsed.recipientName, parsed.cityState].filter(Boolean).join(" - ")}` : null,
      parsed?.productTitle ? `Product: ${parsed.productTitle}` : null,
      "",
      "Please link the Amazon order manually.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function createSendGridEmailSender(input: { apiKey: string; from: string }): EmailSender {
  return {
    async send(message) {
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: message.to }] }],
          from: { email: input.from },
          subject: message.subject,
          content: [{ type: "text/plain", value: message.text }],
        }),
      });

      if (!response.ok) {
        throw new Error(`SendGrid failed with ${response.status}`);
      }
    },
  };
}
