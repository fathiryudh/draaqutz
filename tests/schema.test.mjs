import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");

test("slot lifecycle schema supports admin control workflow", () => {
  assert.match(schema, /status in \('open', 'booked', 'cancelled', 'completed'\)/);
  assert.match(schema, /one_live_slot_per_date_time_location/);
  assert.match(schema, /where status in \('open', 'booked'\)/);
});

test("completion is protected from double loyalty awards", () => {
  assert.match(schema, /one_completed_loyalty_event_per_booking/);
  assert.match(schema, /create or replace function public\.complete_booking_slot/);
  assert.match(schema, /on conflict do nothing/);
});

test("admin and customer cancellation RPCs are present", () => {
  assert.match(schema, /create or replace function public\.cancel_customer_booking/);
  assert.match(schema, /create or replace function public\.cancel_admin_booking/);
  assert.match(schema, /create or replace function public\.cancel_admin_slot/);
  assert.match(schema, /create or replace function public\.cancel_admin_slots_by_date/);
  assert.match(schema, /create or replace function public\.cancel_admin_slots_by_ids/);
  assert.match(schema, /slot_ids_input uuid\[\]/);
});

test("slot delete drafts support multi-select admin deletion", () => {
  assert.match(schema, /create table if not exists public\.slot_delete_drafts/);
  assert.match(schema, /selected_slot_ids uuid\[\] not null default '\{\}'/);
  assert.match(schema, /expires_at timestamptz not null default now\(\) \+ interval '30 minutes'/);
});

test("bookings can track external calendar events", () => {
  assert.match(schema, /alter table public\.bookings add column if not exists calendar_event_id text/);
  assert.match(schema, /calendar_event_id := booking_record\.calendar_event_id/);
});

test("customers track Telegram channel verification", () => {
  assert.match(schema, /channel_membership_verified boolean not null default false/);
  assert.match(schema, /channel_membership_verified_at timestamptz/);
  assert.match(schema, /alter table public\.customers add column if not exists channel_membership_verified/);
});

test("pending bookings hold selected slots while customer enters name", () => {
  assert.match(schema, /create table if not exists public\.pending_bookings/);
  assert.match(schema, /customer_telegram_id bigint primary key references public\.customers\(telegram_id\) on delete cascade/);
  assert.match(schema, /slot_id uuid not null references public\.slots\(id\) on delete cascade/);
  assert.match(schema, /expires_at timestamptz not null default now\(\) \+ interval '10 minutes'/);
});

test("channel posts are date scoped and previewed through drafts", () => {
  assert.match(schema, /service_date date/);
  assert.match(schema, /content_hash text/);
  assert.match(schema, /create table if not exists public\.channel_post_drafts/);
  assert.match(schema, /source in \('new_slot', 'manual_refresh'\)/);
});
