import pg from "pg";
import type { MacondoOrderContext, ParsedAmazonOtpEmail } from "./types.js";

const { Pool } = pg;

export function createProxyPool(connectionString = requiredEnv("DATABASE_URL")) {
  return new Pool({ connectionString });
}

export function createMacondoPool(connectionString = requiredEnv("MACONDO_DATABASE_URL")) {
  return new Pool({ connectionString });
}

export class ProxyStore {
  constructor(private pool: pg.Pool) {}

  async reserveProcessedEmail(messageId: string, rawSubject: string | null) {
    const result = await this.pool.query(
      `insert into processed_emails (message_id, status, raw_subject)
       values ($1, 'processing', $2)
       on conflict do nothing`,
      [messageId, rawSubject],
    );
    return result.rowCount === 1;
  }

  async finishProcessedEmail(input: {
    messageId: string;
    amazonOrderId?: string | null;
    macondoOrderId?: number | null;
    otp?: string | null;
    sentTo?: string | null;
    status: string;
    error?: string | null;
  }) {
    await this.pool.query(
      `update processed_emails
       set amazon_order_id = $2, macondo_order_id = $3, otp = $4, sent_to = $5, status = $6, error = $7
       where message_id = $1`,
      [input.messageId, input.amazonOrderId, input.macondoOrderId, input.otp, input.sentTo, input.status, input.error],
    );
  }

  async recordMatchAttempt(input: { messageId: string; extracted: unknown; candidates: unknown; status: string }) {
    await this.pool.query(
      `insert into match_attempts (message_id, extracted, candidates, status) values ($1, $2, $3, $4)`,
      [input.messageId, JSON.stringify(input.extracted), JSON.stringify(input.candidates), input.status],
    );
  }

  async getLinkedMacondoOrderId(amazonOrderId: string) {
    const result = await this.pool.query<{ macondo_order_id: number }>(
      `select macondo_order_id from amazon_order_links where amazon_order_id = $1`,
      [amazonOrderId],
    );
    return result.rows[0]?.macondo_order_id ?? null;
  }

  async createAmazonOrderLink(input: { amazonOrderId: string; macondoOrderId: number; createdBy: string }) {
    await this.pool.query(
      `insert into amazon_order_links (amazon_order_id, macondo_order_id, created_by)
       values ($1, $2, $3)
       on conflict (amazon_order_id) do update set macondo_order_id = excluded.macondo_order_id, created_by = excluded.created_by`,
      [input.amazonOrderId, input.macondoOrderId, input.createdBy],
    );
  }
}

export class MacondoRepository {
  constructor(private pool: pg.Pool) {}

  async getMacondoOrder(orderId: number): Promise<MacondoOrderContext | null> {
    const result = await this.pool.query(
      `select
         so.id, so.status, so.quantity, so.item_snapshot, so.selected_modifiers, so.shipping_address, so.phone,
         u.id as user_id, u.name as user_name, u.email as user_email, u.hcb_email, u.slack_id, u.username
       from shop_orders so
       join users u on u.id = so.user_id
       where so.id = $1`,
      [orderId],
    );
    return result.rows[0] ? rowToOrder(result.rows[0]) : null;
  }

  async findMacondoCandidates(_parsed: ParsedAmazonOtpEmail): Promise<MacondoOrderContext[]> {
    const result = await this.pool.query(
      `select
         so.id, so.status, so.quantity, so.item_snapshot, so.selected_modifiers, so.shipping_address, so.phone,
         u.id as user_id, u.name as user_name, u.email as user_email, u.hcb_email, u.slack_id, u.username
       from shop_orders so
       join users u on u.id = so.user_id
       where so.status in ('pending_internal_fulfillment', 'shipped')
         and so.item_snapshot->>'fulfillment_provider' = 'internal'
         and so.created_at > now() - interval '30 days'
       order by so.created_at desc
       limit 25`,
    );
    return result.rows.map(rowToOrder);
  }
}

function rowToOrder(row: Record<string, any>): MacondoOrderContext {
  return {
    order: {
      id: row.id,
      status: row.status,
      quantity: row.quantity,
      item_snapshot: row.item_snapshot,
      selected_modifiers: row.selected_modifiers,
      shipping_address: row.shipping_address,
      phone: row.phone,
    },
    user: {
      id: String(row.user_id),
      name: row.user_name,
      email: row.user_email,
      hcb_email: row.hcb_email,
      slack_id: row.slack_id,
      username: row.username,
    },
  };
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
