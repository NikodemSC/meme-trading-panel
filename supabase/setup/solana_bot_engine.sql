-- Isolated schema objects for the Solana bot. Existing booking tables are untouched.
create table if not exists public.solana_bot_settings (
  id smallint primary key default 1 check (id = 1),
  trading_enabled boolean not null default false,
  auto_enabled boolean not null default false,
  max_per_trade_sol numeric(18, 9) not null default 0.05 check (max_per_trade_sol > 0 and max_per_trade_sol <= 100),
  daily_buy_limit_sol numeric(18, 9) not null default 0.10 check (daily_buy_limit_sol > 0 and daily_buy_limit_sol <= 1000),
  max_slippage_bps integer not null default 100 check (max_slippage_bps between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.solana_bot_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.solana_bot_positions (
  id uuid primary key default gen_random_uuid(),
  mint text not null,
  name text not null default 'Token',
  symbol text not null default 'TOKEN',
  token_amount_raw numeric(40, 0) not null default 0 check (token_amount_raw >= 0),
  token_decimals smallint not null default 0 check (token_decimals between 0 and 18),
  total_cost_sol numeric(24, 9) not null default 0 check (total_cost_sol >= 0),
  entry_price_usd numeric(30, 12),
  current_price_usd numeric(30, 12),
  ath_price_usd numeric(30, 12),
  stop_loss_pct numeric(5, 2) check (stop_loss_pct is null or stop_loss_pct between 0 and 99),
  take_profit_pct numeric(5, 2) check (take_profit_pct is null or take_profit_pct between 0 and 99),
  trailing_drawdown_pct numeric(5, 2) check (trailing_drawdown_pct is null or trailing_drawdown_pct between 0 and 99),
  status text not null default 'open' check (status in ('open', 'closing', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists solana_bot_one_active_position_per_mint
  on public.solana_bot_positions (mint) where status in ('open', 'closing');
create index if not exists solana_bot_positions_opened_at_idx
  on public.solana_bot_positions (opened_at desc);

create table if not exists public.solana_bot_trades (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  side text not null check (side in ('buy', 'sell')),
  mint text not null,
  name text not null default 'Token',
  symbol text not null default 'TOKEN',
  amount_sol numeric(24, 9) not null default 0 check (amount_sol >= 0),
  amount_token_raw numeric(40, 0),
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  signature text unique,
  jupiter_request_id text,
  price_impact_pct numeric(10, 6),
  automated boolean not null default false,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists solana_bot_trades_created_at_idx
  on public.solana_bot_trades (created_at desc);
create index if not exists solana_bot_trades_daily_buys_idx
  on public.solana_bot_trades (created_at desc) where side = 'buy' and status = 'success';

alter table public.solana_bot_settings enable row level security;
alter table public.solana_bot_positions enable row level security;
alter table public.solana_bot_trades enable row level security;
revoke all on public.solana_bot_settings, public.solana_bot_positions, public.solana_bot_trades from anon, authenticated;
grant all on public.solana_bot_settings, public.solana_bot_positions, public.solana_bot_trades to service_role;

create or replace function public.validate_solana_bot_cron_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'solana_bot_cron_token' and decrypted_secret = p_token
  );
$$;
revoke all on function public.validate_solana_bot_cron_token(text) from public, anon, authenticated;
grant execute on function public.validate_solana_bot_cron_token(text) to service_role;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'solana_bot_cron_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'solana_bot_cron_token', 'Internal auth for the Solana bot scheduled check');
  end if;
end $$;

select cron.schedule(
  'meme-trading-panel-solana-bot-tick',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://odqgoejynyfqksazibwk.supabase.co/functions/v1/solana-bot-engine',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'solana_bot_cron_token')
      ),
      body := '{"action":"tick"}'::jsonb,
      timeout_milliseconds := 8000
    );
  $$
);

