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
});

test("channel posts are date scoped and previewed through drafts", () => {
  assert.match(schema, /service_date date/);
  assert.match(schema, /content_hash text/);
  assert.match(schema, /create table if not exists public\.channel_post_drafts/);
  assert.match(schema, /source in \('new_slot', 'manual_refresh'\)/);
});
