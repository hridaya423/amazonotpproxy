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

export type MacondoOrderResponse = {
  order: {
    id: number;
    user_id: string;
    item_id: number;
    status: string;
    quantity: number;
    item_snapshot: {
      name?: string;
      fulfillment_provider?: string;
      kind?: string;
      [key: string]: unknown;
    } | null;
    selected_modifiers: unknown;
    shipping_address: {
      firstName: string;
      lastName: string;
      address1: string;
      address2?: string | null;
      city: string;
      state: string;
      postalCode: string;
      country: string;
    } | null;
    phone: string | null;
    tracking_number: string | null;
    external_reference: string | null;
    region: string | null;
    created_at: string | null;
    updated_at: string | null;
  };
  item: {
    id: number;
    slug: string | null;
    name: string;
    kind: string;
    fulfillment_provider: string;
  } | null;
  buyer: {
    id: string;
    name: string;
    email: string;
    hcb_email: string | null;
    slack_id: string | null;
    username: string | null;
  };
};

export type MatchResult =
  | { kind: "matched"; order: MacondoOrderResponse }
  | { kind: "manual_review"; reason: string };
