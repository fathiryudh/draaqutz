import { getSupabaseAdmin, type DatabaseBooking, type DatabaseSlot } from "@/lib/supabase/admin";
import { answerCallbackQuery, editMessageText, sendMessage } from "./api";
import type { InlineKeyboardMarkup, TelegramCallbackQuery, TelegramMessage, TelegramUpdate, TelegramUser } from "./types";

type SlotInsert = {
  service_date: string;
  start_time: string;
  end_time: string;
  location: string;
  status: "open";
};

const helpText = [
  "Draaqutz booking bot",
  "",
  "Customers:",
  "/start - view available dates",
  "/mybooking - view your current booking",
  "/cancel - cancel your current booking",
  "/loyalty - view your loyalty stamps",
  "",
  "Admins:",
  "/newslot 2026-05-10 12:00 13:00 In-House",
  "/newday 2026-05-10 12:00-13:00, 13:00-14:00",
  "/slots",
  "/complete slot_id",
  "/cancel slot_id",
  "/post"
].join("\n");

function displayName(user?: TelegramUser) {
  if (!user) return "customer";

  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || user.username || `customer ${user.id}`;
}

function adminIds() {
  return (process.env.ADMIN_TELEGRAM_IDS ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
}

function adminUsernames() {
  return (process.env.ADMIN_TELEGRAM_USERNAMES ?? "")
    .split(",")
    .map((value) => value.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
}

function isAdmin(user?: TelegramUser) {
  if (!user) return false;

  const username = user.username?.toLowerCase();
  return adminIds().includes(user.id) || Boolean(username && adminUsernames().includes(username));
}

function todayIso() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.BUSINESS_TIME_ZONE ?? "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(new Date());
}

function normalizeTime(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour > 23 || minute > 59) return null;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function formatTime(value: string) {
  const [hourValue, minuteValue] = value.split(":");
  const hour = Number(hourValue);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;

  return `${displayHour}:${minuteValue} ${suffix}`;
}

function shortDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return `${day}/${month}`;
}

function assertDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function slotLabel(slot: Pick<DatabaseSlot, "service_date" | "start_time" | "end_time" | "location">) {
  return `${shortDate(slot.service_date)} ${formatTime(slot.start_time)} - ${formatTime(slot.end_time)} ${slot.location}`;
}

async function upsertCustomer(user: TelegramUser) {
  const supabase = getSupabaseAdmin();

  await supabase.from("customers").upsert(
    {
      telegram_id: user.id,
      username: user.username ?? null,
      display_name: displayName(user)
    },
    { onConflict: "telegram_id" }
  );
}

async function reply(chatId: number, text: string, replyMarkup?: InlineKeyboardMarkup) {
  await sendMessage(chatId, text, replyMarkup ? { reply_markup: replyMarkup } : {});
}

async function listAvailableDates(chatId: number) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("slots")
    .select("service_date")
    .eq("status", "open")
    .gte("service_date", todayIso())
    .order("service_date", { ascending: true });

  if (error) throw error;

  const dates = Array.from(new Set((data ?? []).map((slot) => slot.service_date))).slice(0, 10);

  if (!dates.length) {
    await reply(chatId, "No open Draaqutz slots right now. Check the channel for the next drop.");
    return;
  }

  await reply(chatId, "Choose a date:", {
    inline_keyboard: dates.map((date) => [{ text: shortDate(date), callback_data: `date:${date}` }])
  });
}

async function listSlotsForDate(callback: TelegramCallbackQuery, date: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("slots")
    .select("*")
    .eq("service_date", date)
    .eq("status", "open")
    .order("start_time", { ascending: true });

  if (error) throw error;

  const chatId = callback.message?.chat.id;
  if (!chatId) return;

  if (!data?.length) {
    await reply(chatId, "No open slots left for that date.");
    return;
  }

  await reply(chatId, `Open slots for ${shortDate(date)}:`, {
    inline_keyboard: data.map((slot) => [
      {
        text: `${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}`,
        callback_data: `book:${slot.id}`
      }
    ])
  });
}

async function bookSlot(callback: TelegramCallbackQuery, slotId: string) {
  const user = callback.from;
  const chatId = callback.message?.chat.id;
  if (!chatId) return;

  await upsertCustomer(user);

  const supabase = getSupabaseAdmin();
  const { data: slot, error: slotError } = await supabase
    .from("slots")
    .select("*")
    .eq("id", slotId)
    .eq("status", "open")
    .single<DatabaseSlot>();

  if (slotError || !slot) {
    await reply(chatId, "That slot is no longer available.");
    return;
  }

  const { data: claimedSlot, error: updateError } = await supabase
    .from("slots")
    .update({ status: "booked" })
    .eq("id", slot.id)
    .eq("status", "open")
    .select("*")
    .maybeSingle<DatabaseSlot>();

  if (updateError) throw updateError;

  if (!claimedSlot) {
    await reply(chatId, "That slot was just taken. Please choose another slot.");
    return;
  }

  const { error: bookingError } = await supabase.from("bookings").insert({
    slot_id: claimedSlot.id,
    customer_telegram_id: user.id,
    customer_username: user.username ?? null,
    customer_name: displayName(user),
    status: "booked"
  });

  if (bookingError) {
    await supabase.from("slots").update({ status: "open" }).eq("id", claimedSlot.id).eq("status", "booked");
    throw bookingError;
  }

  await refreshChannelSchedule();
  await reply(chatId, `Booked: ${slotLabel(claimedSlot)}. Use /cancel if you need to release it.`);
}

async function cancelCustomerBooking(message: TelegramMessage) {
  const user = message.from;
  if (!user) return;

  const supabase = getSupabaseAdmin();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*, slots(*)")
    .eq("customer_telegram_id", user.id)
    .eq("status", "booked")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<DatabaseBooking & { slots: DatabaseSlot }>();

  if (error) throw error;

  if (!booking) {
    await reply(message.chat.id, "You do not have an active Draaqutz booking.");
    return;
  }

  await supabase.from("bookings").update({ status: "cancelled" }).eq("id", booking.id);
  await supabase.from("slots").update({ status: "open" }).eq("id", booking.slot_id);

  await refreshChannelSchedule();
  await reply(message.chat.id, `Cancelled. The slot is open again: ${slotLabel(booking.slots)}.`);
}

async function showCustomerBooking(message: TelegramMessage) {
  const user = message.from;
  if (!user) return;

  const supabase = getSupabaseAdmin();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*, slots(*)")
    .eq("customer_telegram_id", user.id)
    .eq("status", "booked")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<DatabaseBooking & { slots: DatabaseSlot }>();

  if (error) throw error;

  await reply(
    message.chat.id,
    booking ? `Your active booking: ${slotLabel(booking.slots)}.` : "You do not have an active Draaqutz booking."
  );
}

async function showLoyalty(message: TelegramMessage) {
  const user = message.from;
  if (!user) return;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("customers")
    .select("loyalty_stamps")
    .eq("telegram_id", user.id)
    .maybeSingle<{ loyalty_stamps: number }>();

  if (error) throw error;

  await reply(message.chat.id, `You have ${data?.loyalty_stamps ?? 0} Draaqutz loyalty stamp(s).`);
}

async function createSlot(message: TelegramMessage, parts: string[]) {
  if (!isAdmin(message.from)) {
    await reply(message.chat.id, "Only Draaqutz admins can create slots.");
    return;
  }

  const [, date, startInput, endInput, ...locationParts] = parts;
  const start = normalizeTime(startInput ?? "");
  const end = normalizeTime(endInput ?? "");
  const location = locationParts.join(" ").trim() || "In-House";

  if (!date || !assertDate(date) || !start || !end) {
    await reply(message.chat.id, "Use: /newslot 2026-05-10 12:00 13:00 In-House");
    return;
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("slots").insert({
    service_date: date,
    start_time: start,
    end_time: end,
    location,
    status: "open"
  });

  if (error) throw error;

  await refreshChannelSchedule();
  await reply(message.chat.id, `Added slot for ${shortDate(date)} ${formatTime(start)} - ${formatTime(end)}.`);
}

async function createDay(message: TelegramMessage, text: string) {
  if (!isAdmin(message.from)) {
    await reply(message.chat.id, "Only Draaqutz admins can create slots.");
    return;
  }

  const match = text.match(/^\/newday\s+(\d{4}-\d{2}-\d{2})\s+(.+)$/);

  if (!match) {
    await reply(message.chat.id, "Use: /newday 2026-05-10 12:00-13:00, 13:00-14:00");
    return;
  }

  const [, date, slotText] = match;
  const slots = slotText.split(",").map((item) => item.trim());
  const rows: SlotInsert[] = slots
    .map((item) => {
      const [startInput, endInput] = item.split("-").map((value) => value.trim());
      const start = normalizeTime(startInput);
      const end = normalizeTime(endInput);
      return start && end
        ? ({ service_date: date, start_time: start, end_time: end, location: "In-House", status: "open" } satisfies SlotInsert)
        : null;
    })
    .filter((row): row is SlotInsert => row !== null);

  if (!assertDate(date) || rows.length !== slots.length) {
    await reply(message.chat.id, "One or more slots are invalid. Use 24-hour time like 12:00-13:00.");
    return;
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("slots").insert(rows);

  if (error) throw error;

  await refreshChannelSchedule();
  await reply(message.chat.id, `Added ${rows.length} slot(s) for ${shortDate(date)}.`);
}

async function showAdminSlots(message: TelegramMessage) {
  if (!isAdmin(message.from)) {
    await reply(message.chat.id, "Only Draaqutz admins can view admin slots.");
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("slots")
    .select("*")
    .gte("service_date", todayIso())
    .neq("status", "cancelled")
    .order("service_date", { ascending: true })
    .order("start_time", { ascending: true })
    .limit(30);

  if (error) throw error;

  if (!data?.length) {
    await reply(message.chat.id, "No upcoming slots.");
    return;
  }

  const lines = data.map((slot) => `${slot.id.slice(0, 8)} ${slot.status} ${slotLabel(slot)}`);
  await reply(message.chat.id, lines.join("\n"));
}

async function findSlotByPrefix(prefix: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("slots")
    .select("*")
    .gte("service_date", todayIso())
    .neq("status", "cancelled")
    .limit(100);

  if (error) throw error;

  return (data ?? []).find((slot) => slot.id.startsWith(prefix));
}

async function cancelSlotAsAdmin(message: TelegramMessage, prefix?: string) {
  if (!isAdmin(message.from)) {
    await cancelCustomerBooking(message);
    return;
  }

  if (!prefix) {
    await reply(message.chat.id, "Use /cancel slot_id to cancel a slot, or ask customers to use /cancel for their own booking.");
    return;
  }

  const slot = await findSlotByPrefix(prefix);

  if (!slot) {
    await reply(message.chat.id, "No matching slot found.");
    return;
  }

  const supabase = getSupabaseAdmin();
  await supabase.from("bookings").update({ status: "cancelled" }).eq("slot_id", slot.id).eq("status", "booked");
  await supabase.from("slots").update({ status: "cancelled" }).eq("id", slot.id);

  await refreshChannelSchedule();
  await reply(message.chat.id, `Cancelled slot ${slotLabel(slot)}.`);
}

async function completeBooking(message: TelegramMessage, prefix?: string) {
  if (!isAdmin(message.from)) {
    await reply(message.chat.id, "Only Draaqutz admins can complete bookings.");
    return;
  }

  if (!prefix) {
    await reply(message.chat.id, "Use /complete slot_id.");
    return;
  }

  const slot = await findSlotByPrefix(prefix);

  if (!slot) {
    await reply(message.chat.id, "No matching booked slot found.");
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("slot_id", slot.id)
    .eq("status", "booked")
    .maybeSingle<DatabaseBooking>();

  if (error) throw error;

  if (!booking) {
    await reply(message.chat.id, "That slot has no active booking.");
    return;
  }

  await supabase.from("bookings").update({ status: "completed" }).eq("id", booking.id);
  await supabase.rpc("increment_loyalty_stamps", {
    customer_telegram_id_input: booking.customer_telegram_id
  });
  await supabase.from("loyalty_events").insert({
    booking_id: booking.id,
    customer_telegram_id: booking.customer_telegram_id,
    reason: "completed_booking"
  });

  await reply(message.chat.id, `Completed booking and added 1 loyalty stamp for ${booking.customer_name}.`);
}

async function handleMessage(message: TelegramMessage) {
  const text = message.text?.trim() ?? "";
  const parts = text.split(/\s+/);
  const command = parts[0]?.split("@")[0].toLowerCase();

  try {
    if (message.from) await upsertCustomer(message.from);

    if (command === "/start" || command === "/book") return listAvailableDates(message.chat.id);
    if (command === "/help") return reply(message.chat.id, helpText);
    if (command === "/mybooking") return showCustomerBooking(message);
    if (command === "/loyalty") return showLoyalty(message);
    if (command === "/newslot") return createSlot(message, parts);
    if (command === "/newday") return createDay(message, text);
    if (command === "/slots") return showAdminSlots(message);
    if (command === "/post") {
      if (!isAdmin(message.from)) return reply(message.chat.id, "Only Draaqutz admins can refresh the channel post.");
      await refreshChannelSchedule();
      return reply(message.chat.id, "Channel schedule refreshed.");
    }
    if (command === "/complete") return completeBooking(message, parts[1]);
    if (command === "/cancel") return cancelSlotAsAdmin(message, parts[1]);

    return reply(message.chat.id, helpText);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    return reply(message.chat.id, `Something went wrong: ${detail}`);
  }
}

async function handleCallback(callback: TelegramCallbackQuery) {
  const data = callback.data ?? "";

  try {
    if (data.startsWith("date:")) {
      await answerCallbackQuery(callback.id);
      return listSlotsForDate(callback, data.replace("date:", ""));
    }

    if (data.startsWith("book:")) {
      await answerCallbackQuery(callback.id, "Booking slot.");
      return bookSlot(callback, data.replace("book:", ""));
    }
  } catch (error) {
    const chatId = callback.message?.chat.id;
    const detail = error instanceof Error ? error.message : "Unknown error";
    if (chatId) await reply(chatId, `Something went wrong: ${detail}`);
  }
}

export async function refreshChannelSchedule() {
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  if (!channelId) return;

  const supabase = getSupabaseAdmin();
  const { data: slots, error } = await supabase
    .from("slots")
    .select("*, bookings(*)")
    .gte("service_date", todayIso())
    .neq("status", "cancelled")
    .order("service_date", { ascending: true })
    .order("start_time", { ascending: true })
    .limit(40);

  if (error) throw error;

  const text = formatSchedule(slots ?? []);
  const { data: post } = await supabase
    .from("channel_posts")
    .select("message_id")
    .eq("id", "schedule")
    .maybeSingle<{ message_id: number }>();

  if (post?.message_id) {
    try {
      await editMessageText(channelId, post.message_id, text);
      return;
    } catch {
      await supabase.from("channel_posts").delete().eq("id", "schedule");
    }
  }

  const sent = await sendMessage(channelId, text);
  await supabase.from("channel_posts").upsert({
    id: "schedule",
    channel_id: channelId,
    message_id: sent.result.message_id
  });
}

function formatSchedule(slots: Array<DatabaseSlot & { bookings?: DatabaseBooking[] }>) {
  if (!slots.length) {
    return "Draaqutz schedule\n\nNo open slots right now. New slots will be posted here.";
  }

  const byDate = new Map<string, Array<DatabaseSlot & { bookings?: DatabaseBooking[] }>>();
  slots.forEach((slot) => {
    const current = byDate.get(slot.service_date) ?? [];
    current.push(slot);
    byDate.set(slot.service_date, current);
  });

  const sections = Array.from(byDate.entries()).map(([date, dateSlots]) => {
    const rows = dateSlots.map((slot) => {
      const activeBooking = slot.bookings?.find((booking) => booking.status === "booked");
      const name = activeBooking?.customer_name ?? "";
      return `${formatTime(slot.start_time)} - ${formatTime(slot.end_time)} -> ${name}`;
    });

    return [`Schedule for ${shortDate(date)}`, "", "In-House:", "", ...rows, "", "Book your slot early to secure your spot."].join("\n");
  });

  return sections.join("\n\n");
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  if (update.message?.text) {
    await handleMessage(update.message);
  }
}
