import { createHash } from "crypto";
import {
  getSupabaseAdmin,
  type AdminCancelledBooking,
  type AdminCancelledSlot,
  type ChannelPostDraft,
  type CompletedBookingSlot,
  type CustomerCancelledBooking,
  type DatabaseBooking,
  type DatabaseSlot
} from "@/lib/supabase/admin";
import { answerCallbackQuery, editMessageText, sendMessage, setMyCommands } from "./api";
import type { InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove, TelegramCallbackQuery, TelegramMessage, TelegramUpdate, TelegramUser } from "./types";

type SlotInsert = {
  service_date: string;
  start_time: string;
  end_time: string;
  location: string;
  status: "open";
};

type ScheduleSlot = DatabaseSlot & { bookings?: DatabaseBooking[] };

type DraftSource = "new_slot" | "manual_refresh";

const TELEGRAM_MESSAGE_LIMIT = 4096;
const DRAFT_TTL_MINUTES = 30;

const TIME_SLOTS = [
  { label: "9 AM", value: "09:00:00", bit: 0 },
  { label: "10 AM", value: "10:00:00", bit: 1 },
  { label: "11 AM", value: "11:00:00", bit: 2 },
  { label: "12 PM", value: "12:00:00", bit: 3 },
  { label: "1 PM", value: "13:00:00", bit: 4 },
  { label: "2 PM", value: "14:00:00", bit: 5 },
  { label: "3 PM", value: "15:00:00", bit: 6 },
  { label: "4 PM", value: "16:00:00", bit: 7 },
  { label: "5 PM", value: "17:00:00", bit: 8 },
  { label: "6 PM", value: "18:00:00", bit: 9 },
  { label: "7 PM", value: "19:00:00", bit: 10 },
  { label: "8 PM", value: "20:00:00", bit: 11 },
  { label: "9 PM", value: "21:00:00", bit: 12 },
  { label: "10 PM", value: "22:00:00", bit: 13 },
  { label: "11 PM", value: "23:00:00", bit: 14 },
  { label: "12 AM", value: "00:00:00", bit: 15 }
];
const MAX_TIME_MASK = (1 << TIME_SLOTS.length) - 1;

const CUSTOMER_COMMANDS = [
  { command: "start", description: "View available dates" },
  { command: "mybooking", description: "View your current booking" },
  { command: "cancel", description: "Cancel your booking" },
  { command: "loyalty", description: "View loyalty stamps" },
  { command: "help", description: "Show help" }
];

const ADMIN_COMMANDS = [
  { command: "newslot", description: "Add new slot(s)" },
  { command: "slots", description: "View and manage slots" },
  { command: "post", description: "Post new date schedules" },
  { command: "start", description: "View available dates" },
  { command: "help", description: "Show help" }
];

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
  "/newslot - add new slot(s)",
  "/slots - view and manage slots",
  "/post - post new date schedules"
].join("\n");

function bitmaskToTimes(mask: number): string[] {
  return TIME_SLOTS.filter((slot) => (mask & (1 << slot.bit)) !== 0).map((slot) => slot.value);
}

function countBits(mask: number): number {
  let count = 0;
  while (mask) {
    count += mask & 1;
    mask >>= 1;
  }
  return count;
}

function isValidTimeMask(mask: number) {
  return Number.isInteger(mask) && mask >= 0 && mask <= MAX_TIME_MASK;
}

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

function dateButtonLabel(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const today = todayIso();
  const tomorrow = getNextDays(2)[1];
  const dayMonth = new Intl.DateTimeFormat("en-SG", {
    timeZone: "UTC",
    day: "numeric",
    month: "short"
  }).format(date);

  if (value === today) return `Today ${dayMonth}`;
  if (value === tomorrow) return `Tmr ${dayMonth}`;

  const weekday = new Intl.DateTimeFormat("en-SG", {
    timeZone: "UTC",
    weekday: "short"
  }).format(date);

  return `${weekday} ${dayMonth}`;
}

function assertDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function slotLabel(slot: Pick<DatabaseSlot, "service_date" | "start_time" | "end_time" | "location">) {
  return `${shortDate(slot.service_date)} ${formatTime(slot.start_time)} - ${formatTime(slot.end_time)} ${slot.location}`;
}

function slotLabelFromRpc(slot: Pick<AdminCancelledSlot | AdminCancelledBooking | CompletedBookingSlot | CustomerCancelledBooking, "service_date" | "start_time" | "end_time" | "location">) {
  return `${shortDate(slot.service_date)} ${formatTime(slot.start_time)} - ${formatTime(slot.end_time)} ${slot.location}`;
}

function slotLocation(slot: Pick<DatabaseSlot, "location">) {
  return slot.location?.trim() || "In-House";
}

function truncateLabel(value: string, maxLength = 48) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function isCommandOrKnownButton(text: string, command: string) {
  return Boolean(command) || ["➕ New Slot", "📋 View Slots", "📢 Post", "❓ Help"].includes(text);
}

function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function channelPostId(date: string) {
  return `schedule:${date}`;
}

function isMessageNotModified(error: unknown) {
  return error instanceof Error && /message is not modified/i.test(error.message);
}

function groupSlotsByLocation<T extends Pick<DatabaseSlot, "location">>(slots: T[]) {
  const byLocation = new Map<string, T[]>();
  slots.forEach((slot) => {
    const location = slotLocation(slot);
    const current = byLocation.get(location) ?? [];
    current.push(slot);
    byLocation.set(location, current);
  });
  return byLocation;
}

function addHour(time: string): string {
  const hour = (Number(time.split(":")[0]) + 1) % 24;
  return `${String(hour).padStart(2, "0")}:00:00`;
}

function getNextDays(count: number): string[] {
  const tz = process.env.BUSINESS_TIME_ZONE ?? "Asia/Singapore";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + i);
    dates.push(formatter.format(date));
  }
  return dates;
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

async function reply(chatId: number, text: string, replyMarkup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove) {
  await sendMessage(chatId, text, replyMarkup ? { reply_markup: replyMarkup } : {});
}

async function editInlineReply(callback: TelegramCallbackQuery, text: string, replyMarkup: InlineKeyboardMarkup) {
  const chatId = callback.message?.chat.id;
  const messageId = callback.message?.message_id;
  if (!chatId || !messageId) return false;

  try {
    await editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
  } catch (error) {
    if (!isMessageNotModified(error)) throw error;
  }
  return true;
}

async function editInlineText(callback: TelegramCallbackQuery, text: string) {
  const chatId = callback.message?.chat.id;
  const messageId = callback.message?.message_id;
  if (!chatId || !messageId) return false;

  try {
    await editMessageText(chatId, messageId, text);
  } catch (error) {
    if (!isMessageNotModified(error)) throw error;
  }
  return true;
}

function getAdminKeyboard(): ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "➕ New Slot" }, { text: "📋 View Slots" }],
      [{ text: "📢 Post" }, { text: "❓ Help" }]
    ],
    resize_keyboard: true
  };
}

function getCustomerKeyboard(): ReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: "📅 Book Slot" }, { text: "🧾 My Booking" }],
      [{ text: "✕ Cancel Booking" }, { text: "⭐ Loyalty" }],
      [{ text: "❓ Help" }]
    ],
    resize_keyboard: true
  };
}

async function showAdminKeyboard(chatId: number, text: string) {
  await reply(chatId, text, getAdminKeyboard());
}

async function showCustomerKeyboard(chatId: number, text: string) {
  await reply(chatId, text, getCustomerKeyboard());
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
    inline_keyboard: dates.map((date) => [{ text: dateButtonLabel(date), callback_data: `date:${date}` }])
  });
}

async function showCustomerDates(callback: TelegramCallbackQuery) {
  const chatId = callback.message?.chat.id;
  if (!chatId) return;

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
    await editInlineText(callback, "No open Draaqutz slots right now. Check the channel for the next drop.");
    return;
  }

  await editInlineReply(callback, "Choose a date:", {
    inline_keyboard: dates.map((date) => [{ text: dateButtonLabel(date), callback_data: `date:${date}` }])
  });
}

async function listSlotsForDate(callback: TelegramCallbackQuery, date: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("slots")
    .select("*, bookings(*)")
    .eq("service_date", date)
    .eq("status", "open")
    .order("start_time", { ascending: true });

  if (error) throw error;

  const chatId = callback.message?.chat.id;
  if (!chatId) return;

  const openSlots = (data ?? []).filter(
    (slot: DatabaseSlot & { bookings?: DatabaseBooking[] }) => !slot.bookings?.some((booking) => booking.status === "booked")
  );

  if (!openSlots.length) {
    await editInlineText(callback, "No open slots left for that date.");
    return;
  }

  const buttons = Array.from(groupSlotsByLocation(openSlots).entries()).flatMap(([location, locationSlots]) => [
    [{ text: location, callback_data: "noop" }],
    ...locationSlots.map((slot) => [
      {
        text: `${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}`,
        callback_data: `book:${slot.id}`
      }
    ])
  ]);

  buttons.push([{ text: "← Back to Dates", callback_data: "cd" }]);

  await editInlineReply(callback, `Open slots for ${dateButtonLabel(date)}:`, { inline_keyboard: buttons });
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
    .maybeSingle<DatabaseSlot>();

  if (slotError) throw slotError;

  if (!slot) {
    await editInlineText(callback, "That slot is no longer available. Send /book to choose another slot.");
    return;
  }

  const { data: activeBooking, error: activeBookingError } = await supabase
    .from("bookings")
    .select("*, slots(*)")
    .eq("customer_telegram_id", user.id)
    .eq("status", "booked")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<DatabaseBooking & { slots: DatabaseSlot }>();

  if (activeBookingError) throw activeBookingError;

  if (activeBooking) {
    const text = activeBooking.slot_id === slot.id
      ? `You already booked: ${slotLabel(activeBooking.slots)}.`
      : `You already have an active booking: ${slotLabel(activeBooking.slots)}. Use /cancel before booking another slot.`;
    await editInlineText(callback, text);
    return;
  }

  if (slot.status !== "open") {
    await editInlineText(callback, `That slot is already ${slot.status}. Send /book to choose another slot.`);
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
    await editInlineText(callback, "That slot was just taken. Send /book to choose another slot.");
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

  await editInlineText(callback, `Booked: ${slotLabel(claimedSlot)}. Use /cancel if you need to release it.`);
  await refreshExistingChannelSchedule(claimedSlot.service_date);
}

async function cancelCustomerBooking(message: TelegramMessage) {
  const user = message.from;
  if (!user) return;

  const supabase = getSupabaseAdmin();
  const { data: booking, error } = await supabase
    .rpc("cancel_customer_booking", { customer_telegram_id_input: user.id })
    .maybeSingle<CustomerCancelledBooking>();

  if (error) throw error;

  if (!booking) {
    await showCustomerKeyboard(message.chat.id, "You do not have an active Draaqutz booking.");
    return;
  }

  await refreshExistingChannelSchedule(booking.service_date);
  await showCustomerKeyboard(message.chat.id, `Cancelled. The slot is open again: ${slotLabelFromRpc(booking)}.`);
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

  await showCustomerKeyboard(
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

  await showCustomerKeyboard(message.chat.id, `You have ${data?.loyalty_stamps ?? 0} Draaqutz loyalty stamp(s).`);
}

async function startSlotCreation(chatId: number) {
  const dates = getNextDays(14);
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < dates.length; i += 2) {
    const row = dates.slice(i, i + 2).map((date) => ({
      text: dateButtonLabel(date),
      callback_data: `ns:d:${date}`
    }));
    rows.push(row);
  }

  await reply(chatId, "Pick a date:", { inline_keyboard: rows });
}

function timeSlotPicker(date: string, mask: number) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  for (let i = 0; i < TIME_SLOTS.length; i += 4) {
    rows.push(
      TIME_SLOTS.slice(i, i + 4).map((slot) => {
        const isSelected = (mask & (1 << slot.bit)) !== 0;
        const newMask = isSelected ? mask & ~(1 << slot.bit) : mask | (1 << slot.bit);
        return {
          text: isSelected ? `✓ ${slot.label}` : slot.label,
          callback_data: `ns:t:${date}:${newMask}`
        };
      })
    );
  }

  const count = countBits(mask);
  rows.push([
    { text: "✕ Cancel", callback_data: "ns:x" },
    { text: `✓ Done (${count})`, callback_data: `ns:ok:${date}:${mask}` }
  ]);

  const selectedTimes = bitmaskToTimes(mask).map((t) => formatTime(t)).join(", ");

  const text = count > 0
    ? `Pick times for ${shortDate(date)}:\n\nSelected: ${selectedTimes}`
    : `Pick times for ${shortDate(date)}:\n\nTap to select multiple times, then press Done`;

  return {
    text,
    replyMarkup: { inline_keyboard: rows }
  };
}

function locationPicker(date: string, mask: number) {
  const times = bitmaskToTimes(mask);
  const timeLabels = times.map((t) => formatTime(t)).join(", ");

  return {
    text: `Creating ${times.length} slot(s) for ${shortDate(date)}:\n${timeLabels}\n\nPick location:`,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "In-House", callback_data: `ns:l:${date}:${mask}:h` },
          { text: "Custom", callback_data: `ns:l:${date}:${mask}:c` }
        ],
        [{ text: "✕ Cancel", callback_data: "ns:x" }]
      ]
    }
  };
}

async function createSlotsWithLocation(chatId: number, adminTelegramId: number, date: string, times: string[], location: string) {
  const supabase = getSupabaseAdmin();

  const slots: SlotInsert[] = times.map((start) => ({
    service_date: date,
    start_time: start,
    end_time: addHour(start),
    location,
    status: "open" as const
  }));

  const { error } = await supabase.from("slots").insert(slots);

  if (error) {
    if (/duplicate key|one_live_slot/i.test(error.message)) {
      await showAdminKeyboard(chatId, "A live slot already exists for one of those times and that location. Cancelled slots can be recreated.");
      return;
    }
    throw error;
  }

  const summary = times.map((t) => `${formatTime(t)} - ${formatTime(addHour(t))}`).join("\n");

  await showAdminKeyboard(chatId, `Added ${times.length} slot(s) for ${shortDate(date)} at ${location}:\n\n${summary}\n\nUse Post when you are ready to publish this date to the channel.`);
}

async function getPendingSlots(chatId: number) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("pending_slots")
    .select("service_date, times")
    .eq("chat_id", chatId)
    .maybeSingle<{ service_date: string; times: string[] }>();
  if (error) throw error;
  return data;
}

async function setPendingSlots(chatId: number, date: string, times: string[]) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("pending_slots").upsert({
    chat_id: chatId,
    service_date: date,
    times
  });
  if (error) throw error;
}

async function clearPendingSlots(chatId: number) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("pending_slots").delete().eq("chat_id", chatId);
  if (error) throw error;
}

async function upcomingScheduleDates() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("slots")
    .select("service_date")
    .gte("service_date", todayIso())
    .in("status", ["open", "booked"])
    .order("service_date", { ascending: true })
    .limit(200);

  if (error) throw error;
  return Array.from(new Set((data ?? []).map((slot) => slot.service_date)));
}

async function refreshableScheduleDates() {
  const supabase = getSupabaseAdmin();
  const dates = await upcomingScheduleDates();
  const { data, error } = await supabase
    .from("channel_posts")
    .select("service_date")
    .gte("service_date", todayIso())
    .order("service_date", { ascending: true });

  if (error) throw error;
  return Array.from(new Set([...dates, ...(data ?? []).map((post) => post.service_date).filter(Boolean)]));
}

async function unpostedScheduleDates() {
  const supabase = getSupabaseAdmin();
  const dates = await upcomingScheduleDates();
  const { data, error } = await supabase
    .from("channel_posts")
    .select("service_date")
    .in("service_date", dates.length ? dates : ["1900-01-01"]);

  if (error) throw error;

  const postedDates = new Set((data ?? []).map((post) => post.service_date).filter(Boolean));
  return dates.filter((date) => !postedDates.has(date));
}

async function showPostDatePicker(chatId: number) {
  if (!process.env.TELEGRAM_CHANNEL_ID) {
    await showAdminKeyboard(chatId, "TELEGRAM_CHANNEL_ID is not configured, so schedules cannot be posted.");
    return;
  }

  const dates = await unpostedScheduleDates();

  if (!dates.length) {
    await showAdminKeyboard(chatId, "No unposted dates with slots. Posted dates are hidden from this menu.");
    return;
  }

  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < dates.length; i += 2) {
    rows.push(dates.slice(i, i + 2).map((date) => ({ text: dateButtonLabel(date), callback_data: `pd:${date}` })));
  }

  await reply(chatId, "Pick a date to post:", { inline_keyboard: rows });
}

function draftPreviewText(source: DraftSource, dates: string[], text: string) {
  const title = "Channel post preview";
  const dateText = dates.length === 1 ? shortDate(dates[0]) : `${dates.length} dates`;
  const publishText = dates.length === 1
    ? "Posting will send 1 channel message for this date."
    : `Posting will send or edit ${dates.length} separate channel messages, one per date.`;
  const preview = text.length > 3200 ? `${text.slice(0, 3200)}\n\n[Preview truncated. Post will use the full generated text.]` : text;
  return `${title} (${dateText})\n${publishText}\n\n${preview}`;
}

function draftKeyboard(draftId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "Post", callback_data: `cp:p:${draftId}` },
        { text: "✏️ Edit Text", callback_data: `cp:e:${draftId}` }
      ],
      [
        { text: "↻ Regenerate", callback_data: `cp:r:${draftId}` },
        { text: "✕ Cancel", callback_data: `cp:x:${draftId}` }
      ]
    ]
  };
}

async function createChannelPostDraft(chatId: number, adminTelegramId: number, source: DraftSource, dates: string[]) {
  if (!process.env.TELEGRAM_CHANNEL_ID) {
    await showAdminKeyboard(chatId, "TELEGRAM_CHANNEL_ID is not configured, so the channel post cannot be previewed or published.");
    return;
  }

  const supabase = getSupabaseAdmin();
  const serviceDates = dates;

  if (!serviceDates.length) {
    await showAdminKeyboard(chatId, "No upcoming date posts to preview.");
    return;
  }

  const draftText = await buildDraftText(serviceDates);
  await supabase
    .from("channel_post_drafts")
    .delete()
    .eq("admin_telegram_id", adminTelegramId)
    .eq("chat_id", chatId)
    .in("status", ["preview", "editing"]);

  const expiresAt = new Date(Date.now() + DRAFT_TTL_MINUTES * 60 * 1000).toISOString();
  const { data: draft, error } = await supabase
    .from("channel_post_drafts")
    .insert({
      admin_telegram_id: adminTelegramId,
      chat_id: chatId,
      source,
      status: "preview",
      service_dates: serviceDates,
      draft_text: draftText,
      expires_at: expiresAt
    })
    .select("*")
    .single<ChannelPostDraft>();

  if (error) throw error;

  await reply(chatId, draftPreviewText(source, serviceDates, draftText), draftKeyboard(draft.id));
}

async function getActiveDraft(chatId: number, adminTelegramId: number) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("channel_post_drafts")
    .select("*")
    .eq("chat_id", chatId)
    .eq("admin_telegram_id", adminTelegramId)
    .in("status", ["preview", "editing"])
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ChannelPostDraft>();

  if (error) throw error;
  return data;
}

async function getDraftForCallback(callback: TelegramCallbackQuery, draftId: string) {
  const chatId = callback.message?.chat.id;
  if (!chatId) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("channel_post_drafts")
    .select("*")
    .eq("id", draftId)
    .eq("chat_id", chatId)
    .eq("admin_telegram_id", callback.from.id)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<ChannelPostDraft>();

  if (error) throw error;
  return data;
}

async function handleDraftTextInput(message: TelegramMessage, draft: ChannelPostDraft) {
  const text = message.text?.trim() ?? "";

  if (!text) {
    await reply(message.chat.id, "Draft text cannot be empty. Send new text or press Cancel on the preview.");
    return;
  }

  if (text.length > TELEGRAM_MESSAGE_LIMIT) {
    await reply(message.chat.id, "Draft text is over Telegram's 4096 character limit. Send shorter text.");
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data: updated, error } = await supabase
    .from("channel_post_drafts")
    .update({ draft_text: text, status: "preview", edited: true, updated_at: new Date().toISOString() })
    .eq("id", draft.id)
    .select("*")
    .single<ChannelPostDraft>();

  if (error) throw error;
  await reply(message.chat.id, draftPreviewText(updated.source, updated.service_dates, updated.draft_text), draftKeyboard(updated.id));
}

async function handleCustomLocationInput(message: TelegramMessage) {
  const location = message.text?.trim();
  if (!location) return;

  const pending = await getPendingSlots(message.chat.id);
  if (!pending) {
    return showAdminKeyboard(message.chat.id, "Session expired. Please start again with /newslot");
  }

  await clearPendingSlots(message.chat.id);
  if (!message.from) return;
  await createSlotsWithLocation(message.chat.id, message.from.id, pending.service_date, pending.times, location);
}

async function showAdminSlots(chatId: number) {
  const picker = await adminSlotDatePicker();
  if (!picker) {
    await reply(chatId, "No upcoming slots.", {
      inline_keyboard: [[{ text: "➕ Add Slot", callback_data: "ns:start" }]]
    });
    return;
  }

  await reply(chatId, picker.text, picker.replyMarkup);
}

async function adminSlotDatePicker() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("slots")
    .select("service_date")
    .gte("service_date", todayIso())
    .in("status", ["open", "booked"])
    .order("service_date", { ascending: true })
    .limit(100);

  if (error) throw error;

  const dates = Array.from(new Set((data ?? []).map((slot) => slot.service_date))).slice(0, 14);

  if (!dates.length) {
    return null;
  }

  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < dates.length; i += 2) {
    rows.push(dates.slice(i, i + 2).map((date) => ({ text: dateButtonLabel(date), callback_data: `ad:${date}` })));
  }

  rows.push([{ text: "➕ Add Slot", callback_data: "ns:start" }]);

  return {
    text: "Pick a date to manage slots:",
    replyMarkup: { inline_keyboard: rows }
  };
}

async function editAdminSlotDates(callback: TelegramCallbackQuery) {
  const picker = await adminSlotDatePicker();
  if (!picker) {
    await editInlineReply(callback, "No upcoming slots.", {
      inline_keyboard: [[{ text: "➕ Add Slot", callback_data: "ns:start" }]]
    });
    return;
  }

  await editInlineReply(callback, picker.text, picker.replyMarkup);
}

async function showAdminSlotsForDate(callback: TelegramCallbackQuery, date: string) {
  const chatId = callback.message?.chat.id;
  if (!chatId) return;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("slots")
    .select("*, bookings(*)")
    .eq("service_date", date)
    .in("status", ["open", "booked"])
    .order("start_time", { ascending: true });

  if (error) throw error;

  if (!data?.length) {
    await editInlineReply(callback, `No upcoming slots for ${dateButtonLabel(date)}.`, {
      inline_keyboard: [
        [{ text: "← Back to Dates", callback_data: "ab" }],
        [{ text: "➕ Add Slot", callback_data: "ns:start" }]
      ]
    });
    return;
  }

  const buttons = (data as Array<DatabaseSlot & { bookings?: DatabaseBooking[] }>).map((slot) => {
    const activeBooking = slot.bookings?.find((booking) => booking.status === "booked");
    const bookingName = activeBooking?.customer_name.toUpperCase() ?? "";
    const statusText = activeBooking ? "✓" : "○";
    return [
      {
        text: truncateLabel(`${statusText} ${formatTime(slot.start_time)}-${formatTime(slot.end_time)} -> ${bookingName}`),
        callback_data: `as:${slot.id}:${date}`
      }
    ];
  });

  buttons.push([{ text: "← Back to Dates", callback_data: "ab" }]);
  buttons.push([{ text: "➕ Add Slot", callback_data: "ns:start" }]);

  await editInlineReply(callback, `Slots for ${dateButtonLabel(date)} (✓ booked, ○ open):`, { inline_keyboard: buttons });
}

async function showSlotActions(callback: TelegramCallbackQuery, slotId: string) {
  const chatId = callback.message?.chat.id;
  if (!chatId) return;

  const supabase = getSupabaseAdmin();
  const { data: slot, error } = await supabase
    .from("slots")
    .select("*, bookings(*)")
    .eq("id", slotId)
    .maybeSingle<DatabaseSlot & { bookings: DatabaseBooking[] }>();

  if (error) throw error;

  if (!slot) {
    await editInlineReply(callback, "Slot not found.", {
      inline_keyboard: [[{ text: "← Back to Dates", callback_data: "ab" }]]
    });
    return;
  }

  const activeBooking = slot.bookings?.find((b) => b.status === "booked");
  const status = slot.status === "booked" && activeBooking ? `Booked by ${activeBooking.customer_name}` : "Open";

  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

  if (slot.status === "booked" && activeBooking) {
    buttons.push([{ text: "✅ Complete", callback_data: `ac:${slot.id}` }]);
    buttons.push([{ text: "Edit", callback_data: `se:${slot.id}` }]);
  } else if (slot.status === "open") {
    buttons.push([{ text: "Edit", callback_data: `se:${slot.id}` }]);
  }

  buttons.push([{ text: "← Back", callback_data: `ad:${slot.service_date}` }]);

  await editInlineReply(callback, `${slotLabel(slot)}\nStatus: ${status}`, { inline_keyboard: buttons });
}

async function showSlotEditMenu(callback: TelegramCallbackQuery, slotId: string) {
  const chatId = callback.message?.chat.id;
  if (!chatId) return;

  const supabase = getSupabaseAdmin();
  const { data: slot, error } = await supabase
    .from("slots")
    .select("*, bookings(*)")
    .eq("id", slotId)
    .maybeSingle<DatabaseSlot & { bookings: DatabaseBooking[] }>();

  if (error) throw error;

  if (!slot) {
    await editInlineReply(callback, "Slot not found.", {
      inline_keyboard: [[{ text: "← Back to Dates", callback_data: "ab" }]]
    });
    return;
  }

  const activeBooking = slot.bookings?.find((booking) => booking.status === "booked");
  const note = activeBooking
    ? "Cancel Booking keeps this slot open. Cancel Slot removes the slot too. Both notify the customer."
    : "This removes the slot from the schedule.";
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  if (activeBooking) {
    rows.push([{ text: "Cancel Booking", callback_data: `cb:${slot.id}` }]);
  }

  rows.push([{ text: "Cancel Slot", callback_data: `cx:${slot.id}` }]);
  rows.push([{ text: "← Back", callback_data: `as:${slot.id}:${slot.service_date}` }]);

  await editInlineReply(callback, `Edit slot\n${slotLabel(slot)}\n\n${note}`, {
    inline_keyboard: rows
  });
}

async function completeSlotFromCallback(callback: TelegramCallbackQuery, slotId: string) {
  const chatId = callback.message?.chat.id;
  if (!chatId) return;

  const supabase = getSupabaseAdmin();
  const { data: completed, error } = await supabase
    .rpc("complete_booking_slot", { slot_id_input: slotId })
    .maybeSingle<CompletedBookingSlot>();

  if (error) throw error;

  if (!completed) {
    await editInlineReply(callback, "That slot has no active booking.", {
      inline_keyboard: [[{ text: "← Back to Dates", callback_data: "ab" }]]
    });
    return;
  }

  await refreshExistingChannelSchedule(completed.service_date);

  const stampText = completed.loyalty_awarded ? "Added 1 loyalty stamp" : "Loyalty stamp was already awarded";
  await editInlineReply(callback, `Completed: ${slotLabelFromRpc(completed)}\n${stampText} for ${completed.customer_name}.`, {
    inline_keyboard: [[{ text: "← Back to Slots", callback_data: `ad:${completed.service_date}` }]]
  });
}

async function cancelSlotFromCallback(callback: TelegramCallbackQuery, slotId: string) {
  const chatId = callback.message?.chat.id;
  if (!chatId) return;

  const result = await cancelAdminSlotById(slotId);

  if (!result) {
    await editInlineReply(callback, "Slot not found.", {
      inline_keyboard: [[{ text: "← Back to Dates", callback_data: "ab" }]]
    });
    return;
  }

  if (result.cancelled_now) await refreshExistingChannelSchedule(result.service_date);

  const dmText = result.customer_telegram_id
    ? await notifyAdminCancelledBooking(result)
    : "No customer notification needed.";
  const statusText = result.cancelled_now ? "Cancelled" : "Already removed";
  await editInlineReply(callback, `${statusText}: ${slotLabelFromRpc(result)}\n${dmText}`, {
    inline_keyboard: [[{ text: "← Back to Slots", callback_data: `ad:${result.service_date}` }]]
  });
}

async function cancelAdminSlotById(slotId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .rpc("cancel_admin_slot", { slot_id_input: slotId })
    .maybeSingle<AdminCancelledSlot>();

  if (error) throw error;
  return data;
}

async function cancelBookingFromCallback(callback: TelegramCallbackQuery, slotId: string) {
  const result = await cancelAdminBookingBySlotId(slotId);

  if (!result) {
    await editInlineReply(callback, "That slot has no active booking to cancel.", {
      inline_keyboard: [[{ text: "← Back to Dates", callback_data: "ab" }]]
    });
    return;
  }

  if (result.cancelled_now) await refreshExistingChannelSchedule(result.service_date);

  const dmText = await notifyAdminCancelledBooking(result);
  await editInlineReply(callback, `Booking cancelled. Slot is open again: ${slotLabelFromRpc(result)}\n${dmText}`, {
    inline_keyboard: [[{ text: "← Back to Slots", callback_data: `ad:${result.service_date}` }]]
  });
}

async function cancelAdminBookingBySlotId(slotId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .rpc("cancel_admin_booking", { slot_id_input: slotId })
    .maybeSingle<AdminCancelledBooking>();

  if (error) throw error;
  return data;
}

async function notifyAdminCancelledBooking(slot: Pick<AdminCancelledSlot | AdminCancelledBooking, "customer_telegram_id" | "service_date" | "start_time" | "end_time" | "location">) {
  if (!slot.customer_telegram_id) return "No customer notification needed.";

  try {
    await sendMessage(
      slot.customer_telegram_id,
      `Your Draaqutz booking was cancelled by admin: ${slotLabelFromRpc(slot)}. Please send /book to choose another slot.`
    );
    return "Customer notified.";
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    return `Customer notification failed: ${detail}`;
  }
}

async function showIndividualCancelConfirm(callback: TelegramCallbackQuery, slotId: string) {
  const supabase = getSupabaseAdmin();
  const { data: slot, error } = await supabase
    .from("slots")
    .select("*, bookings(*)")
    .eq("id", slotId)
    .maybeSingle<DatabaseSlot & { bookings: DatabaseBooking[] }>();

  if (error) throw error;

  if (!slot) {
    await editInlineReply(callback, "Slot not found.", {
      inline_keyboard: [[{ text: "← Back to Dates", callback_data: "ab" }]]
    });
    return;
  }

  const activeBooking = slot.bookings?.find((booking) => booking.status === "booked");
  const action = activeBooking ? "Cancel this booking and remove its slot" : "Cancel this slot";
  const customerNote = activeBooking ? "\nThe customer will be notified." : "";
  await editInlineReply(callback, `${action}?\n${slotLabel(slot)}${customerNote}`, {
    inline_keyboard: [
      [{ text: "Confirm", callback_data: `ax:${slot.id}` }],
      [{ text: "← Back", callback_data: `as:${slot.id}:${slot.service_date}` }]
    ]
  });
}

async function showCancelBookingConfirm(callback: TelegramCallbackQuery, slotId: string) {
  const supabase = getSupabaseAdmin();
  const { data: slot, error } = await supabase
    .from("slots")
    .select("*, bookings(*)")
    .eq("id", slotId)
    .maybeSingle<DatabaseSlot & { bookings: DatabaseBooking[] }>();

  if (error) throw error;

  if (!slot) {
    await editInlineReply(callback, "Slot not found.", {
      inline_keyboard: [[{ text: "← Back to Dates", callback_data: "ab" }]]
    });
    return;
  }

  const activeBooking = slot.bookings?.find((booking) => booking.status === "booked");
  if (!activeBooking) {
    await editInlineReply(callback, "This slot has no active booking.", {
      inline_keyboard: [[{ text: "← Back", callback_data: `se:${slot.id}` }]]
    });
    return;
  }

  await editInlineReply(callback, `Cancel ${activeBooking.customer_name}'s booking?\n${slotLabel(slot)}\n\nThe slot will stay open and the customer will be notified.`, {
    inline_keyboard: [
      [{ text: "Confirm", callback_data: `abk:${slot.id}` }],
      [{ text: "← Back", callback_data: `se:${slot.id}` }]
    ]
  });
}

async function handleMessage(message: TelegramMessage) {
  const text = message.text?.trim() ?? "";
  const command = text.split(/\s+/)[0]?.split("@")[0].toLowerCase();
  const user = message.from;
  const admin = isAdmin(user);

  try {
    if (user) await upsertCustomer(user);

    if (admin && user) {
      const draft = await getActiveDraft(message.chat.id, user.id);
      if (draft?.status === "editing") {
        if (isCommandOrKnownButton(text, command)) {
          await getSupabaseAdmin().from("channel_post_drafts").update({ status: "preview" }).eq("id", draft.id);
        } else {
          return handleDraftTextInput(message, draft);
        }
      }

      const pending = await getPendingSlots(message.chat.id);
      if (pending) {
        if (isCommandOrKnownButton(text, command)) {
          await clearPendingSlots(message.chat.id);
          if (command === "/cancel") return showAdminKeyboard(message.chat.id, "Cancelled.");
        } else {
          return handleCustomLocationInput(message);
        }
      }
    }

    if (admin) {
      if (text === "➕ New Slot") return startSlotCreation(message.chat.id);
      if (text === "📋 View Slots") return showAdminSlots(message.chat.id);
      if (text === "📢 Post") {
        return showPostDatePicker(message.chat.id);
      }
      if (text === "❓ Help") return showAdminKeyboard(message.chat.id, helpText);
    }

    if (!admin) {
      if (text === "📅 Book Slot") return listAvailableDates(message.chat.id);
      if (text === "🧾 My Booking") return showCustomerBooking(message);
      if (text === "✕ Cancel Booking") return cancelCustomerBooking(message);
      if (text === "⭐ Loyalty") return showLoyalty(message);
      if (text === "❓ Help") return showCustomerKeyboard(message.chat.id, helpText);
    }

    if (command === "/start" || command === "/book") {
      if (admin) {
        if (user) await setupAdminCommands(user.id);
        return showAdminKeyboard(message.chat.id, "Welcome back, admin! Use the buttons below or /help for commands.");
      }
      await showCustomerKeyboard(message.chat.id, "Customer menu");
      return listAvailableDates(message.chat.id);
    }
    if (command === "/help") {
      if (admin) {
        return showAdminKeyboard(message.chat.id, helpText);
      }
      return showCustomerKeyboard(message.chat.id, helpText);
    }
    if (command === "/mybooking") return showCustomerBooking(message);
    if (command === "/loyalty") return showLoyalty(message);
    if (command === "/cancel") return cancelCustomerBooking(message);
    if (command === "/newslot") {
      if (!admin) return showCustomerKeyboard(message.chat.id, "Only Draaqutz admins can create slots.");
      return startSlotCreation(message.chat.id);
    }
    if (command === "/slots") {
      if (!admin) return showCustomerKeyboard(message.chat.id, "Only Draaqutz admins can view admin slots.");
      return showAdminSlots(message.chat.id);
    }
    if (command === "/post") {
      if (!admin) return showCustomerKeyboard(message.chat.id, "Only Draaqutz admins can post channel schedules.");
      return showPostDatePicker(message.chat.id);
    }

    if (admin) {
      return showAdminKeyboard(message.chat.id, helpText);
    }
    return showCustomerKeyboard(message.chat.id, helpText);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    return reply(message.chat.id, `Something went wrong: ${detail}`);
  }
}

async function handleCallback(callback: TelegramCallbackQuery) {
  const data = callback.data ?? "";
  const chatId = callback.message?.chat.id;
  const messageId = callback.message?.message_id;

  try {
    if (data === "noop") {
      await answerCallbackQuery(callback.id, "Choose one of the slots below.").catch(() => {});
      return;
    }

    await answerCallbackQuery(callback.id).catch(() => {});

    // Customer: date selection
    if (data.startsWith("date:")) {
      return listSlotsForDate(callback, data.slice(5));
    }

    // Customer: back to available dates
    if (data === "cd") {
      return showCustomerDates(callback);
    }

    // Customer: book slot
    if (data.startsWith("book:")) {
      return bookSlot(callback, data.slice(5));
    }

    if (!isAdmin(callback.from)) return;

    if (!chatId || !messageId) return;

    // Admin: new slot - start
    if (data === "ns:start") {
      return startSlotCreation(chatId);
    }

    // Admin: new slot - date selected
    if (data.startsWith("ns:d:")) {
      const date = data.slice(5);
      if (!assertDate(date)) return editInlineText(callback, "This date picker is invalid. Please start again with /newslot.");
      const picker = timeSlotPicker(date, 0);
      return editInlineReply(callback, picker.text, picker.replyMarkup);
    }

    // Admin: new slot - time toggled (carries bitmask)
    if (data.startsWith("ns:t:")) {
      const parts = data.slice(5).split(":");
      const date = parts[0];
      const mask = parseInt(parts[1], 10);
      if (!assertDate(date) || !isValidTimeMask(mask)) {
        return editInlineText(callback, "This time picker is invalid. Please start again with /newslot.");
      }
      const picker = timeSlotPicker(date, mask);
      return editInlineReply(callback, picker.text, picker.replyMarkup);
    }

    // Admin: new slot - done selecting times
    if (data.startsWith("ns:ok:")) {
      const parts = data.slice(6).split(":");
      const date = parts[0];
      const mask = parseInt(parts[1], 10);
      if (!assertDate(date) || !isValidTimeMask(mask)) {
        return editInlineText(callback, "This time picker is invalid. Please start again with /newslot.");
      }
      if (mask === 0) {
        const picker = timeSlotPicker(date, mask);
        return editInlineReply(callback, `${picker.text}\n\nSelect at least one time slot first.`, picker.replyMarkup);
      }
      const picker = locationPicker(date, mask);
      return editInlineReply(callback, picker.text, picker.replyMarkup);
    }

    // Admin: new slot - location selected
    if (data.startsWith("ns:l:")) {
      const parts = data.slice(5).split(":");
      const date = parts[0];
      const mask = parseInt(parts[1], 10);
      const loc = parts[2];
      if (!assertDate(date) || !isValidTimeMask(mask) || mask === 0) {
        return editInlineText(callback, "This location picker is invalid. Please start again with /newslot.");
      }
      const times = bitmaskToTimes(mask);

      if (loc === "h") {
        await editInlineText(callback, `Creating ${times.length} In-House slot(s) for ${shortDate(date)}...`);
        return createSlotsWithLocation(chatId, callback.from.id, date, times, "In-House");
      }
      if (loc === "c") {
        await setPendingSlots(chatId, date, times);
        return editInlineText(
          callback,
          `Creating ${times.length} custom slot(s) for ${shortDate(date)}.\n\nType the custom location in this chat.`
        );
      }
    }

    // Admin: new slot - cancel
    if (data === "ns:x") {
      await clearPendingSlots(chatId);
      return showAdminKeyboard(chatId, "Cancelled.");
    }

    // Admin: back to slots list
    if (data === "ab") {
      return editAdminSlotDates(callback);
    }

    // Admin: slots for selected date
    if (data.startsWith("ad:")) {
      const date = data.slice(3);
      if (!assertDate(date)) return editInlineText(callback, "This date is invalid. Please open /slots again.");
      return showAdminSlotsForDate(callback, date);
    }

    // Admin: choose date to post to channel
    if (data.startsWith("pd:")) {
      const date = data.slice(3);
      if (!assertDate(date)) return editInlineText(callback, "This date is invalid. Please open /post again.");
      const unpostedDates = await unpostedScheduleDates();
      if (!unpostedDates.includes(date)) {
        return editInlineText(callback, "That date has already been posted. Posted dates are hidden from /post.");
      }
      return createChannelPostDraft(chatId, callback.from.id, "manual_refresh", [date]);
    }

    // Admin: view slot details
    if (data.startsWith("as:")) {
      return showSlotActions(callback, data.slice(3).split(":")[0]);
    }

    // Admin: slot edit menu
    if (data.startsWith("se:")) {
      return showSlotEditMenu(callback, data.slice(3));
    }

    // Admin: complete booking
    if (data.startsWith("ac:")) {
      return completeSlotFromCallback(callback, data.slice(3));
    }

    // Admin: confirm slot cancellation from edit menu
    if (data.startsWith("cx:")) {
      return showIndividualCancelConfirm(callback, data.slice(3));
    }

    // Admin: confirm booking-only cancellation from edit menu
    if (data.startsWith("cb:")) {
      return showCancelBookingConfirm(callback, data.slice(3));
    }

    // Admin: cancel booking only after confirmation
    if (data.startsWith("abk:")) {
      return cancelBookingFromCallback(callback, data.slice(4));
    }

    // Admin: cancel slot after confirmation
    if (data.startsWith("ax:")) {
      return cancelSlotFromCallback(callback, data.slice(3));
    }

    if (data.startsWith("cp:")) {
      return handleChannelPostDraftCallback(callback, data);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    if (chatId) await reply(chatId, `Something went wrong: ${detail}`);
  }
}

async function setupAdminCommands(userId: number) {
  try {
    await setMyCommands(ADMIN_COMMANDS, { type: "chat", user_id: userId });
  } catch {
    // Ignore errors setting commands
  }
}

export async function setupBotCommands() {
  await setMyCommands(CUSTOMER_COMMANDS);

  for (const adminId of adminIds()) {
    await setupAdminCommands(adminId);
  }
}

export async function refreshChannelSchedule(date?: string) {
  const dates = date ? [date] : await refreshableScheduleDates();
  for (const serviceDate of dates) {
    await publishScheduleDate(serviceDate);
  }
}

async function refreshExistingChannelSchedule(date: string) {
  const supabase = getSupabaseAdmin();
  const { data: post, error } = await supabase
    .from("channel_posts")
    .select("message_id")
    .eq("id", channelPostId(date))
    .maybeSingle<{ message_id: number }>();

  if (error) throw error;
  if (!post?.message_id) return;

  await publishScheduleDate(date);
}

async function fetchScheduleSlotsForDate(date: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("slots")
    .select("*, bookings(*)")
    .eq("service_date", date)
    .in("status", ["open", "booked"])
    .order("start_time", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ScheduleSlot[];
}

async function buildDraftText(dates: string[]) {
  const sections = await Promise.all(dates.map(async (date) => formatScheduleForDate(date, await fetchScheduleSlotsForDate(date))));
  return sections.join("\n\n---\n\n");
}

function formatScheduleForDate(date: string, slots: ScheduleSlot[]) {
  if (!slots.length) {
    return [
      `Draaqutz schedule for ${shortDate(date)}`,
      "",
      "No open slots for this date right now. Please check /book for another date."
    ].join("\n");
  }

  const openCount = slots.filter((slot) => slot.status === "open").length;
  const header = openCount > 0
    ? `Draaqutz schedule for ${shortDate(date)}`
    : `Draaqutz schedule for ${shortDate(date)} - Fully booked`;

  const locationSections = Array.from(groupSlotsByLocation(slots).entries()).flatMap(([location, locationSlots]) => {
    const rows = locationSlots.map((slot) => {
      const activeBooking = slot.bookings?.find((booking) => booking.status === "booked");
      const status = activeBooking || slot.status === "booked" ? "Booked" : "Open";
      return `${formatTime(slot.start_time)} - ${formatTime(slot.end_time)} -> ${status}`;
    });

    return [`${location}:`, "", ...rows, ""];
  });

  const footer = openCount > 0
    ? "Send /book to secure your slot."
    : "This date is fully booked. If a slot reopens, this post will update.";

  return [header, "", ...locationSections, footer].join("\n").trim();
}

async function publishScheduleDate(date: string, textOverride?: string) {
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  if (!channelId) return { status: "skipped" as const, reason: "missing_channel" as const };

  const supabase = getSupabaseAdmin();
  const text = textOverride ?? formatScheduleForDate(date, await fetchScheduleSlotsForDate(date));

  if (text.length > TELEGRAM_MESSAGE_LIMIT) {
    throw new Error(`Channel post for ${date} is over Telegram's 4096 character limit.`);
  }

  const contentHash = hashText(text);
  const postId = channelPostId(date);
  const { data: post, error } = await supabase
    .from("channel_posts")
    .select("message_id, content_hash")
    .eq("id", postId)
    .maybeSingle<{ message_id: number; content_hash: string | null }>();

  if (error) throw error;

  if (post?.message_id && post.content_hash === contentHash) {
    return { status: "noop" as const };
  }

  if (post?.message_id) {
    try {
      await editMessageText(channelId, post.message_id, text);
      await supabase.from("channel_posts").upsert({
        id: postId,
        channel_id: channelId,
        service_date: date,
        message_id: post.message_id,
        content_hash: contentHash,
        updated_at: new Date().toISOString()
      });
      return { status: "edited" as const };
    } catch (error) {
      if (isMessageNotModified(error)) {
        await supabase.from("channel_posts").update({ content_hash: contentHash, updated_at: new Date().toISOString() }).eq("id", postId);
        return { status: "noop" as const };
      }
      await supabase.from("channel_posts").delete().eq("id", postId);
    }
  }

  const sent = await sendMessage(channelId, text);
  await supabase.from("channel_posts").upsert({
    id: postId,
    channel_id: channelId,
    service_date: date,
    message_id: sent.result.message_id,
    content_hash: contentHash,
    updated_at: new Date().toISOString()
  });

  return { status: "sent" as const };
}

async function handleChannelPostDraftCallback(callback: TelegramCallbackQuery, data: string) {
  const [, action, draftId] = data.split(":");
  const draft = await getDraftForCallback(callback, draftId);
  const chatId = callback.message?.chat.id;

  if (!chatId) return;

  if (!draft) {
    await editInlineReply(callback, "This draft expired or belongs to another admin.", {
      inline_keyboard: [[{ text: "Close", callback_data: "noop" }]]
    });
    return;
  }

  const supabase = getSupabaseAdmin();

  if (action === "x") {
    await supabase.from("channel_post_drafts").delete().eq("id", draft.id);
    await editInlineText(callback, "Draft cancelled.");
    return;
  }

  if (action === "e") {
    await supabase.from("channel_post_drafts").update({ status: "editing", updated_at: new Date().toISOString() }).eq("id", draft.id);
    await editInlineText(callback, "Send the replacement channel text as your next message. Commands and menu buttons will not be used as draft text.");
    return;
  }

  if (action === "r") {
    const draftText = await buildDraftText(draft.service_dates);
    const { data: regenerated, error } = await supabase
      .from("channel_post_drafts")
      .update({ draft_text: draftText, status: "preview", edited: false, updated_at: new Date().toISOString() })
      .eq("id", draft.id)
      .select("*")
      .single<ChannelPostDraft>();

    if (error) throw error;
    await editInlineReply(callback, draftPreviewText(regenerated.source, regenerated.service_dates, regenerated.draft_text), draftKeyboard(regenerated.id));
    return;
  }

  if (action === "p") {
    const results = [];
    for (let i = 0; i < draft.service_dates.length; i += 1) {
      const date = draft.service_dates[i];
      const override = draft.edited && draft.service_dates.length === 1 ? draft.draft_text : undefined;
      results.push(await publishScheduleDate(date, override));
    }
    await supabase.from("channel_post_drafts").delete().eq("id", draft.id);
    const sent = results.filter((result) => result.status === "sent").length;
    const edited = results.filter((result) => result.status === "edited").length;
    const noop = results.filter((result) => result.status === "noop").length;
    await editInlineText(callback, `Posted channel schedule.\nSent: ${sent}. Edited: ${edited}. No change: ${noop}.`);
  }
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
