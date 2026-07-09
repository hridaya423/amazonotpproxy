import type { MacondoOrderContext, MatchResult, ParsedAmazonOtpEmail } from "./types.js";

export type MatchDeps = {
  getLinkedMacondoOrderId(amazonOrderId: string): Promise<number | null>;
  getMacondoOrder(orderId: number): Promise<MacondoOrderContext | null>;
  findMacondoCandidates(parsed: ParsedAmazonOtpEmail): Promise<MacondoOrderContext[]>;
};

export async function findMatchingOrder(
  parsed: ParsedAmazonOtpEmail,
  deps: MatchDeps,
  options: { allowFallback?: boolean } = {},
): Promise<MatchResult> {
  const linkedOrderId = await deps.getLinkedMacondoOrderId(parsed.amazonOrderId);
  if (linkedOrderId) {
    const order = await deps.getMacondoOrder(linkedOrderId);
    return order
      ? { kind: "matched", matchType: "exact", order }
      : { kind: "manual_review", reason: "linked Macondo order was not found", candidates: [] };
  }

  if (!options.allowFallback) {
    return { kind: "manual_review", reason: "missing exact Amazon order link", candidates: [] };
  }

  const candidates = await deps.findMacondoCandidates(parsed);
  const strong = candidates.filter((candidate) => scoreCandidate(parsed, candidate) >= 90);
  if (strong.length === 1) {
    return { kind: "matched", matchType: "fallback", order: strong[0] };
  }

  return { kind: "manual_review", reason: strong.length > 1 ? "multiple strong candidates" : "no strong candidate", candidates };
}

export function scoreCandidate(parsed: ParsedAmazonOtpEmail, candidate: MacondoOrderContext) {
  let score = 0;
  const address = candidate.order.shipping_address;
  const fullName = `${address?.firstName || ""} ${address?.lastName || ""}`.trim();
  const cityState = `${address?.city || ""}, ${address?.state || ""}`.trim();

  if (parsed.recipientName && sameText(parsed.recipientName, fullName)) score += 35;
  if (parsed.cityState && sameText(parsed.cityState, cityState)) score += 25;
  if (parsed.quantity && parsed.quantity === candidate.order.quantity) score += 10;
  if (parsed.productTitle && candidate.order.item_snapshot?.name && similar(parsed.productTitle, candidate.order.item_snapshot.name)) score += 30;

  return score;
}

function sameText(a: string, b: string) {
  return clean(a) === clean(b);
}

function similar(a: string, b: string) {
  const left = new Set(clean(a).split(" ").filter(Boolean));
  const right = new Set(clean(b).split(" ").filter(Boolean));
  const overlap = [...left].filter((word) => right.has(word)).length;
  return overlap / Math.max(left.size, 1) >= 0.6;
}

function clean(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
