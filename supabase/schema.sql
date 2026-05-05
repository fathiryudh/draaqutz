create extension if not exists pgcrypto;

create table if not exists public.customers (
  telegram_id bigint primary key,
  username text,
  display_name text not null,
  loyalty_stamps integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.slots (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  start_time time not null,
  end_time time not null,
  location text not null default 'In-House',
  notes text,
  status text not null default 'open' check (status in ('open', 'booked', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.slots(id) on delete cascade,
  customer_telegram_id bigint not null references public.customers(telegram_id) on delete cascade,
  customer_username text,
  customer_name text not null,
  status text not null default 'booked' check (status in ('booked', 'cancelled', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists one_active_booking_per_slot
  on public.bookings(slot_id)
  where status = 'booked';

create table if not exists public.loyalty_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  customer_telegram_id bigint not null references public.customers(telegram_id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.channel_posts (
  id text primary key,
  channel_id text not null,
  message_id integer not null,
  updated_at timestamptz not null default now()
);

create or replace function public.increment_loyalty_stamps(customer_telegram_id_input bigint)
returns void
language plpgsql
security definer
as $$
begin
  update public.customers
  set loyalty_stamps = loyalty_stamps + 1,
      updated_at = now()
  where telegram_id = customer_telegram_id_input;
end;
$$;
