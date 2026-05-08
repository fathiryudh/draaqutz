create extension if not exists pgcrypto;

create table if not exists public.customers (
  telegram_id bigint primary key,
  username text,
  display_name text not null,
  loyalty_stamps integer not null default 0,
  channel_membership_verified boolean not null default false,
  channel_membership_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customers add column if not exists channel_membership_verified boolean not null default false;
alter table public.customers add column if not exists channel_membership_verified_at timestamptz;

create table if not exists public.slots (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  start_time time not null,
  end_time time not null,
  location text not null default 'In-House',
  notes text,
  status text not null default 'open' check (status in ('open', 'booked', 'cancelled', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.slots drop constraint if exists slots_status_check;
alter table public.slots
  add constraint slots_status_check
  check (status in ('open', 'booked', 'cancelled', 'completed'));

create unique index if not exists one_live_slot_per_date_time_location
  on public.slots(service_date, start_time, (lower(trim(location))))
  where status in ('open', 'booked');

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.slots(id) on delete cascade,
  customer_telegram_id bigint not null references public.customers(telegram_id) on delete cascade,
  customer_username text,
  customer_name text not null,
  status text not null default 'booked' check (status in ('booked', 'cancelled', 'completed')),
  calendar_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bookings add column if not exists calendar_event_id text;

create unique index if not exists one_active_booking_per_slot
  on public.bookings(slot_id)
  where status = 'booked';

create unique index if not exists one_active_booking_per_customer
  on public.bookings(customer_telegram_id)
  where status = 'booked';

create table if not exists public.pending_bookings (
  customer_telegram_id bigint primary key references public.customers(telegram_id) on delete cascade,
  slot_id uuid not null references public.slots(id) on delete cascade,
  chat_id bigint not null,
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loyalty_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  customer_telegram_id bigint not null references public.customers(telegram_id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists one_completed_loyalty_event_per_booking
  on public.loyalty_events(booking_id, reason)
  where booking_id is not null and reason = 'completed_booking';

create table if not exists public.channel_posts (
  id text primary key,
  channel_id text not null,
  message_id integer not null,
  service_date date,
  content_hash text,
  updated_at timestamptz not null default now()
);

alter table public.channel_posts add column if not exists service_date date;
alter table public.channel_posts add column if not exists content_hash text;

create table if not exists public.channel_post_drafts (
  id uuid primary key default gen_random_uuid(),
  admin_telegram_id bigint not null,
  chat_id bigint not null,
  source text not null check (source in ('new_slot', 'manual_refresh')),
  status text not null default 'preview' check (status in ('preview', 'editing')),
  service_dates date[] not null,
  draft_text text not null,
  edited boolean not null default false,
  expires_at timestamptz not null default now() + interval '30 minutes',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists one_active_channel_post_draft_per_admin_chat
  on public.channel_post_drafts(admin_telegram_id, chat_id)
  where status in ('preview', 'editing');

create table if not exists public.slot_delete_drafts (
  id uuid primary key default gen_random_uuid(),
  admin_telegram_id bigint not null,
  chat_id bigint not null,
  service_date date not null,
  slot_ids uuid[] not null,
  selected_slot_ids uuid[] not null default '{}',
  expires_at timestamptz not null default now() + interval '30 minutes',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pending_slots (
  chat_id bigint primary key,
  service_date date not null,
  times text[] not null,
  created_at timestamptz not null default now()
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

create or replace function public.complete_booking_slot(slot_id_input uuid)
returns table (
  booking_id uuid,
  customer_telegram_id bigint,
  customer_name text,
  customer_username text,
  service_date date,
  start_time time,
  end_time time,
  location text,
  completed_now boolean,
  loyalty_awarded boolean
)
language plpgsql
security definer
as $$
declare
  booking_record public.bookings%rowtype;
  slot_record public.slots%rowtype;
  inserted_event_count integer := 0;
begin
  select * into slot_record
  from public.slots
  where id = slot_id_input
  for update;

  if not found then
    return;
  end if;

  select * into booking_record
  from public.bookings
  where slot_id = slot_id_input
    and status in ('booked', 'completed')
  order by created_at desc
  limit 1
  for update;

  if not found then
    return;
  end if;

  completed_now := booking_record.status = 'booked' or slot_record.status <> 'completed';

  if booking_record.status = 'booked' then
    update public.bookings
    set status = 'completed',
        updated_at = now()
    where id = booking_record.id;
  end if;

  if slot_record.status <> 'completed' then
    update public.slots
    set status = 'completed',
        updated_at = now()
    where id = slot_record.id;
  end if;

  insert into public.loyalty_events(booking_id, customer_telegram_id, reason)
  values (booking_record.id, booking_record.customer_telegram_id, 'completed_booking')
  on conflict do nothing;

  get diagnostics inserted_event_count = row_count;
  loyalty_awarded := inserted_event_count = 1;

  if loyalty_awarded then
    update public.customers
    set loyalty_stamps = loyalty_stamps + 1,
        updated_at = now()
    where telegram_id = booking_record.customer_telegram_id;
  end if;

  booking_id := booking_record.id;
  customer_telegram_id := booking_record.customer_telegram_id;
  customer_name := booking_record.customer_name;
  customer_username := booking_record.customer_username;
  service_date := slot_record.service_date;
  start_time := slot_record.start_time;
  end_time := slot_record.end_time;
  location := slot_record.location;
  return next;
end;
$$;

create or replace function public.cancel_customer_booking(customer_telegram_id_input bigint)
returns table (
  booking_id uuid,
  slot_id uuid,
  service_date date,
  start_time time,
  end_time time,
  location text,
  calendar_event_id text,
  cancelled_now boolean
)
language plpgsql
security definer
as $$
declare
  booking_record public.bookings%rowtype;
  slot_record public.slots%rowtype;
begin
  select * into booking_record
  from public.bookings
  where customer_telegram_id = customer_telegram_id_input
    and status = 'booked'
  order by created_at desc
  limit 1
  for update;

  if not found then
    return;
  end if;

  select * into slot_record
  from public.slots
  where id = booking_record.slot_id
  for update;

  update public.bookings
  set status = 'cancelled',
      updated_at = now()
  where id = booking_record.id
    and status = 'booked';

  update public.slots
  set status = 'open',
      updated_at = now()
  where id = booking_record.slot_id
    and status = 'booked';

  booking_id := booking_record.id;
  slot_id := booking_record.slot_id;
  service_date := slot_record.service_date;
  start_time := slot_record.start_time;
  end_time := slot_record.end_time;
  location := slot_record.location;
  calendar_event_id := booking_record.calendar_event_id;
  cancelled_now := true;
  return next;
end;
$$;

create or replace function public.cancel_admin_slot(slot_id_input uuid)
returns table (
  slot_id uuid,
  booking_id uuid,
  customer_telegram_id bigint,
  customer_name text,
  service_date date,
  start_time time,
  end_time time,
  location text,
  calendar_event_id text,
  cancelled_now boolean
)
language plpgsql
security definer
as $$
declare
  slot_record public.slots%rowtype;
  booking_record public.bookings%rowtype;
begin
  select * into slot_record
  from public.slots
  where id = slot_id_input
  for update;

  if not found then
    return;
  end if;

  select * into booking_record
  from public.bookings
  where slot_id = slot_record.id
    and status = 'booked'
  order by created_at desc
  limit 1
  for update;

  cancelled_now := slot_record.status in ('open', 'booked');

  if found then
    update public.bookings
    set status = 'cancelled',
        updated_at = now()
    where id = booking_record.id
      and status = 'booked';
  end if;

  update public.slots
  set status = 'cancelled',
      updated_at = now()
  where id = slot_record.id
    and status in ('open', 'booked');

  slot_id := slot_record.id;
  booking_id := booking_record.id;
  customer_telegram_id := booking_record.customer_telegram_id;
  customer_name := booking_record.customer_name;
  service_date := slot_record.service_date;
  start_time := slot_record.start_time;
  end_time := slot_record.end_time;
  location := slot_record.location;
  calendar_event_id := booking_record.calendar_event_id;
  return next;
end;
$$;

create or replace function public.cancel_admin_booking(slot_id_input uuid)
returns table (
  slot_id uuid,
  booking_id uuid,
  customer_telegram_id bigint,
  customer_name text,
  service_date date,
  start_time time,
  end_time time,
  location text,
  calendar_event_id text,
  cancelled_now boolean
)
language plpgsql
security definer
as $$
declare
  slot_record public.slots%rowtype;
  booking_record public.bookings%rowtype;
begin
  select * into slot_record
  from public.slots
  where id = slot_id_input
  for update;

  if not found then
    return;
  end if;

  select * into booking_record
  from public.bookings
  where slot_id = slot_record.id
    and status = 'booked'
  order by created_at desc
  limit 1
  for update;

  if not found then
    return;
  end if;

  update public.bookings
  set status = 'cancelled',
      updated_at = now()
  where id = booking_record.id
    and status = 'booked';

  update public.slots
  set status = 'open',
      updated_at = now()
  where id = slot_record.id
    and status = 'booked';

  slot_id := slot_record.id;
  booking_id := booking_record.id;
  customer_telegram_id := booking_record.customer_telegram_id;
  customer_name := booking_record.customer_name;
  service_date := slot_record.service_date;
  start_time := slot_record.start_time;
  end_time := slot_record.end_time;
  location := slot_record.location;
  calendar_event_id := booking_record.calendar_event_id;
  cancelled_now := true;
  return next;
end;
$$;

create or replace function public.cancel_admin_slots_by_date(service_date_input date, mode_input text)
returns table (
  slot_id uuid,
  booking_id uuid,
  customer_telegram_id bigint,
  customer_name text,
  service_date date,
  start_time time,
  end_time time,
  location text,
  calendar_event_id text,
  cancelled_now boolean
)
language plpgsql
security definer
as $$
declare
  slot_record public.slots%rowtype;
  booking_record public.bookings%rowtype;
begin
  if mode_input not in ('open', 'booked', 'all') then
    raise exception 'Invalid cancellation mode: %', mode_input;
  end if;

  for slot_record in
    select *
    from public.slots
    where slots.service_date = service_date_input
      and slots.status in ('open', 'booked')
      and (
        mode_input = 'all'
        or slots.status = mode_input
      )
    order by slots.start_time
    for update
  loop
    booking_record := null;

    select * into booking_record
    from public.bookings
    where bookings.slot_id = slot_record.id
      and bookings.status = 'booked'
    order by bookings.created_at desc
    limit 1
    for update;

    if found then
      update public.bookings
      set status = 'cancelled',
          updated_at = now()
      where id = booking_record.id
        and status = 'booked';
    end if;

    update public.slots
    set status = 'cancelled',
        updated_at = now()
    where id = slot_record.id
      and status in ('open', 'booked');

    slot_id := slot_record.id;
    booking_id := booking_record.id;
    customer_telegram_id := booking_record.customer_telegram_id;
    customer_name := booking_record.customer_name;
    service_date := slot_record.service_date;
    start_time := slot_record.start_time;
    end_time := slot_record.end_time;
    location := slot_record.location;
    calendar_event_id := booking_record.calendar_event_id;
    cancelled_now := true;
    return next;
  end loop;
end;
$$;

create or replace function public.cancel_admin_slots_by_ids(slot_ids_input uuid[])
returns table (
  slot_id uuid,
  booking_id uuid,
  customer_telegram_id bigint,
  customer_name text,
  service_date date,
  start_time time,
  end_time time,
  location text,
  calendar_event_id text,
  cancelled_now boolean
)
language plpgsql
security definer
as $$
declare
  slot_record public.slots%rowtype;
  booking_record public.bookings%rowtype;
begin
  for slot_record in
    select s.*
    from public.slots s
    where s.id = any(slot_ids_input)
      and s.status in ('open', 'booked')
    order by s.service_date, s.start_time
    for update
  loop
    booking_record := null;

    select * into booking_record
    from public.bookings
    where bookings.slot_id = slot_record.id
      and bookings.status = 'booked'
    order by bookings.created_at desc
    limit 1
    for update;

    if found then
      update public.bookings
      set status = 'cancelled',
          updated_at = now()
      where id = booking_record.id
        and status = 'booked';
    end if;

    update public.slots
    set status = 'cancelled',
        updated_at = now()
    where id = slot_record.id
      and status in ('open', 'booked');

    slot_id := slot_record.id;
    booking_id := booking_record.id;
    customer_telegram_id := booking_record.customer_telegram_id;
    customer_name := booking_record.customer_name;
    service_date := slot_record.service_date;
    start_time := slot_record.start_time;
    end_time := slot_record.end_time;
    location := slot_record.location;
    calendar_event_id := booking_record.calendar_event_id;
    cancelled_now := true;
    return next;
  end loop;
end;
$$;
