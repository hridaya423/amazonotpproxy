import type { MacondoOrderResponse, MatchResult, ParsedAmazonOtpEmail } from "./types.js";

export type MatchDeps = {
  findAmazonOrderLink(amazonOrderId: string): Promise<{ macondoOrderId: number } | null>;
  getMacondoOrder(orderId: number): Promise<MacondoOrderResponse>;
};

export async function findMatchingOrder(
  parsed: ParsedAmazonOtpEmail,
  deps: MatchDeps,
): Promise<MatchResult> {
  const link = await deps.findAmazonOrderLink(parsed.amazonOrderId);
  if (!link) return { kind: "manual_review", reason: "No Macondo order link" };

  const macondo = await deps.getMacondoOrder(link.macondoOrderId);
  if (macondo.order.status === "cancelled") {
    return { kind: "manual_review", reason: "Macondo order is cancelled" };
  }

  if (macondo.order.item_snapshot?.kind !== "physical") {
    return { kind: "manual_review", reason: "Macondo order is not physical" };
  }

  if (!macondo.buyer.email) {
    return { kind: "manual_review", reason: "Buyer has no email" };
  }

  return { kind: "matched", order: macondo };
}
