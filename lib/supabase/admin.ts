import { createClient } from "@supabase/supabase-js";

export type DatabaseSlot = {
  id: string;
  service_date: string;
  start_time: string;
  end_time: string;
  location: string;
  notes: string | null;
  status: "open" | "booked" | "cancelled" | "completed";
  created_at: string;
  updated_at: string;
};

export type DatabaseBooking = {
  id: string;
  slot_id: string;
  customer_telegram_id: number;
  customer_username: string | null;
  customer_name: string;
  status: "booked" | "cancelled" | "completed";
  calendar_event_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DatabaseCustomer = {
  telegram_id: number;
  username: string | null;
  display_name: string;
  loyalty_stamps: number;
  channel_membership_verified: boolean;
  channel_membership_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PendingBooking = {
  customer_telegram_id: number;
  slot_id: string;
  chat_id: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type AdminCancelledSlot = {
  slot_id: string;
  booking_id: string | null;
  customer_telegram_id: number | null;
  customer_name: string | null;
  service_date: string;
  start_time: string;
  end_time: string;
  location: string;
  calendar_event_id: string | null;
  cancelled_now: boolean;
};

export type AdminCancelledBooking = {
  slot_id: string;
  booking_id: string;
  customer_telegram_id: number;
  customer_name: string;
  service_date: string;
  start_time: string;
  end_time: string;
  location: string;
  calendar_event_id: string | null;
  cancelled_now: boolean;
};

export type CompletedBookingSlot = {
  booking_id: string;
  customer_telegram_id: number;
  customer_name: string;
  customer_username: string | null;
  service_date: string;
  start_time: string;
  end_time: string;
  location: string;
  completed_now: boolean;
  loyalty_awarded: boolean;
};

export type CustomerCancelledBooking = {
  booking_id: string;
  slot_id: string;
  service_date: string;
  start_time: string;
  end_time: string;
  location: string;
  calendar_event_id: string | null;
  cancelled_now: boolean;
};

export type ChannelPostDraft = {
  id: string;
  admin_telegram_id: number;
  chat_id: number;
  source: "new_slot" | "manual_refresh";
  status: "preview" | "editing";
  service_dates: string[];
  draft_text: string;
  edited: boolean;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export type SlotDeleteDraft = {
  id: string;
  admin_telegram_id: number;
  chat_id: number;
  service_date: string;
  slot_ids: string[];
  selected_slot_ids: string[];
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false
    }
  });
}
