create table if not exists amazon_order_links (
  amazon_order_id text primary key,
  macondo_order_id integer not null,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists processed_emails (
  message_id text primary key,
  amazon_order_id text,
  macondo_order_id integer,
  otp text,
  sent_to text,
  status text not null,
  error text,
  raw_subject text,
  created_at timestamptz not null default now()
);

create table if not exists match_attempts (
  id serial primary key,
  message_id text,
  extracted jsonb not null,
  candidates jsonb,
  status text not null,
  created_at timestamptz not null default now()
);
