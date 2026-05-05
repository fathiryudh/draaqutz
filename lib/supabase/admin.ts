import { createClient } from "@supabase/supabase-js";

export type DatabaseSlot = {
  id: string;
  service_date: string;
  start_time: string;
  end_time: string;
  location: string;
  notes: string | null;
  status: "open" | "booked" | "cancelled";
  created_at: string;
};

export type DatabaseBooking = {
  id: string;
  slot_id: string;
  customer_telegram_id: number;
  customer_username: string | null;
  customer_name: string;
  status: "booked" | "cancelled" | "completed";
  created_at: string;
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
