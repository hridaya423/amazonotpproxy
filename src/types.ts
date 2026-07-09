export type ParsedAmazonOtpEmail = {
  otp: string;
  amazonOrderId: string;
  recipientName: string | null;
  cityState: string | null;
  productTitle: string | null;
  quantity: number | null;
  arrivalWindow: string | null;
  shipmentId: string | null;
  asin: string | null;
};

export type MacondoOrderContext = {
  order: {
    id: number;
    status: string;
    quantity: number;
    item_snapshot: {
      name?: string;
      fulfillment_provider?: string;
      kind?: string;
    } | null;
    selected_modifiers: unknown;
    shipping_address: {
      firstName?: string;
      lastName?: string;
      city?: string;
      state?: string;
      country?: string;
    } | null;
    phone: string | null;
  };
  user: {
    id: string;
    name: string | null;
    email: string;
    hcb_email: string | null;
    slack_id: string | null;
    username: string | null;
  };
};

export type MatchResult =
  | { kind: "matched"; matchType: "exact" | "fallback"; order: MacondoOrderContext }
  | { kind: "manual_review"; reason: string; candidates: MacondoOrderContext[] };
