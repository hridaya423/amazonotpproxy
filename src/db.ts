import pg from "pg";

const { Pool } = pg;

export function createProxyPool(connectionString = requiredEnv("DATABASE_URL")) {
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

  async findAmazonOrderLink(amazonOrderId: string) {
    const result = await this.pool.query<{ macondo_order_id: number }>(
      `select macondo_order_id from amazon_order_links where amazon_order_id = $1`,
      [amazonOrderId],
    );
    const macondoOrderId = result.rows[0]?.macondo_order_id;
    return macondoOrderId === undefined ? null : { macondoOrderId };
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

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
