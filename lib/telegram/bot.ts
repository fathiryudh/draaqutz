import { createHash } from "crypto";
import {
  getSupabaseAdmin,
  type AdminCancelledBooking,
  type AdminCancelledSlot,
  type ChannelPostDraft,
  type CompletedBookingSlot,
  type CustomerCancelledBooking,
  type DatabaseBooking,
  type DatabaseCustomer,
  type DatabaseSlot,
  type PendingBooking,
  type SlotDeleteDraft
} from "@/lib/supabase/admin";
import { createGoogleBookingEvent, deleteGoogleBookingEvent } from "@/lib/calendar/google";
import { answerCallbackQuery, editMessageText, getChatMember, sendMessage, setMyCommands } from "./api";
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
const PENDING_BOOKING_TTL_MINUTES = 10;
const BOOKING_ADDRESS = "Pasir Ris Dr 6 Blk 451, Lift A level 4";

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
  { command: "book", description: "Book a customer slot" },
  { command: "mybooking", description: "View your current booking" },
  { command: "cancel", description: "Cancel your booking" },
  { command: "loyalty", description: "View loyalty stamps" },
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
  return command.startsWith("/") || [
    "➕ New Slot",
    "📋 View Slots",
    "📢 Post",
    "📅 Book Slot",
    "🧾 My Booking",
    "✕ Cancel Booking",
    "⭐ Loyalty",
    "❓ Help"
  ].includes(text);
}

function bookingCustomerName(typedName: string) {
  return typedName.replace(/\s+/g, " ").trim();
}

function adminBookingLabel(booking: DatabaseBooking) {
  const username = booking.customer_username ? ` (@${booking.customer_username})` : "";
  return `${booking.customer_name}${username}`;
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
  const { error } = await supabase.from("customers").upsert(
    {
      telegram_id: user.id,
      username: user.username ?? null,
      display_name: displayName(user),
      updated_at: new Date().toISOString()
    },
    { onConflict: "telegram_id" }
  );
  if (error) throw error;
}

async function getCustomer(telegramId: number) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("telegram_id", telegramId)
    .maybeSingle<DatabaseCustomer>();

  if (error) throw error;
  return data;
}

function isJoinedChannelMember(member: Awaited<ReturnType<typeof getChatMember>>["result"]) {
  if (["creator", "administrator", "member"].includes(member.status)) return true;
  return member.status === "restricted" && member.is_member === true;
}

function channelJoinKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "Join Channel", url: process.env.TELEGRAM_CHANNEL_URL || "https://t.me/draaqutz" }],
      [{ text: "I've Joined", callback_data: "vc" }]
    ]
  };
}

function channelUsernameFromUrl() {
  const value = process.env.TELEGRAM_CHANNEL_URL || "https://t.me/draaqutz";
  const match = value.match(/t\.me\/([A-Za-z0-9_]+)/i);
  return match?.[1] ? `@${match[1]}` : null;
}

function channelIdsToVerify() {
  const ids = [
    process.env.TELEGRAM_CHANNEL_ID,
    channelUsernameFromUrl()
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(ids));
}

async function promptJoinChannel(chatId: number) {
  await reply(chatId, "Join the Draaqutz Telegram channel first, then tap I've Joined so I can verify it.", channelJoinKeyboard());
}

async function editJoinChannelPrompt(callback: TelegramCallbackQuery, warning?: string) {
  const text = [
    warning,
    "Join the Draaqutz Telegram channel first, then tap I've Joined so I can verify it."
  ].filter(Boolean).join("\n\n");
  await editInlineReply(callback, text, channelJoinKeyboard());
}

async function showChannelVerificationSetupError(chatId: number, detail?: string) {
  const lines = [
    "Booking is temporarily unavailable because channel membership verification is not set up.",
    "Ask Draaqutz admin to set TELEGRAM_CHANNEL_ID and make sure the bot can inspect the channel."
  ];
  if (detail) lines.push(`Telegram error: ${detail}`);
  await showCustomerKeyboard(chatId, lines.join("\n"));
}

async function editChannelVerificationSetupError(callback: TelegramCallbackQuery, detail?: string) {
  const lines = [
    "Booking is temporarily unavailable because channel membership verification is not set up.",
    "Ask Draaqutz admin to set TELEGRAM_CHANNEL_ID and make sure the bot can inspect the channel."
  ];
  if (detail) lines.push(`Telegram error: ${detail}`);
  await editInlineText(callback, lines.join("\n"));
}

async function verifyCustomerChannelMembership(user: TelegramUser) {
  const customer = await getCustomer(user.id);
  if (customer?.channel_membership_verified) return { ok: true as const };

  const channelIds = channelIdsToVerify();
  if (!channelIds.length) return { ok: false as const, reason: "setup" as const };

  const failedChecks: string[] = [];
  let sawMembershipStatus = false;

  for (const channelId of channelIds) {
    try {
      const member = await getChatMember(channelId, user.id);
      sawMembershipStatus = true;
      if (isJoinedChannelMember(member.result)) {
        const verifiedAt = new Date().toISOString();
        const { error } = await getSupabaseAdmin()
          .from("customers")
          .update({
            channel_membership_verified: true,
            channel_membership_verified_at: verifiedAt,
            updated_at: verifiedAt
          })
          .eq("telegram_id", user.id);

        if (error) throw error;
        return { ok: true as const };
      }

      failedChecks.push(`${channelId}: ${member.result.status}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      failedChecks.push(`${channelId}: ${detail}`);
    }
  }

  return {
    ok: false as const,
    reason: sawMembershipStatus ? "join" as const : "setup" as const,
    detail: failedChecks.join("; ")
  };
}

async function ensureCustomerCanBookFromMessage(message: TelegramMessage, user: TelegramUser) {
  const result = await verifyCustomerChannelMembership(user);
  if (result.ok) return true;

  if (result.reason === "join") {
    await promptJoinChannel(message.chat.id);
    return false;
  }

  await showChannelVerificationSetupError(message.chat.id, result.detail);
  return false;
}

async function ensureCustomerCanBookFromCallback(callback: TelegramCallbackQuery) {
  const chatId = callback.message?.chat.id;
  if (!chatId) return false;

  const result = await verifyCustomerChannelMembership(callback.from);
  if (result.ok) return true;

  if (result.reason === "join") {
    await editJoinChannelPrompt(callback);
    return false;
  }

  await editChannelVerificationSetupError(callback, result.detail);
  return false;
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
      [{ text: "📢 Post" }, { text: "📅 Book Slot" }],
      [{ text: "🧾 My Booking" }, { text: "✕ Cancel Booking" }],
      [{ text: "⭐ Loyalty" }],
      [{ text: "❓ Help" }]
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

async function showBookingKeyboard(message: TelegramMessage, text: string) {
  if (isAdmin(message.from)) {
    await showAdminKeyboard(message.chat.id, text);
    return;
  }

  await showCustomerKeyboard(message.chat.id, text);
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

async function startCustomerBooking(message: TelegramMessage) {
  const user = message.from;
  if (!user) return;

  await upsertCustomer(user);
  if (!isAdmin(user)) {
    const allowed = await ensureCustomerCanBookFromMessage(message, user);
    if (!allowed) return;
  }

  if (isAdmin(user)) {
    await showAdminKeyboard(message.chat.id, "Admin customer booking");
  } else {
    await showCustomerKeyboard(message.chat.id, "Customer menu");
  }
  await listAvailableDates(message.chat.id);
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

async function retryChannelVerification(callback: TelegramCallbackQuery) {
  await upsertCustomer(callback.from);
  const result = await verifyCustomerChannelMembership(callback.from);
  if (result.ok) {
    return showCustomerDates(callback);
  }

  if (result.reason === "join") {
    return editJoinChannelPrompt(callback, "I still cannot verify that you joined the channel.");
  }

  return editChannelVerificationSetupError(callback, result.detail);
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

  if (!isAdmin(user)) {
    const allowed = await ensureCustomerCanBookFromCallback(callback);
    if (!allowed) return;
  }

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

  await setPendingBooking(user.id, chatId, slot.id);
  await editInlineText(callback, `What name should I put for this booking?\n\nSlot: ${slotLabel(slot)}`);
}

async function setPendingBooking(customerTelegramId: number, chatId: number, slotId: string) {
  const expiresAt = new Date(Date.now() + PENDING_BOOKING_TTL_MINUTES * 60 * 1000).toISOString();
  const { error } = await getSupabaseAdmin().from("pending_bookings").upsert(
    {
      customer_telegram_id: customerTelegramId,
      slot_id: slotId,
      chat_id: chatId,
      expires_at: expiresAt,
      updated_at: new Date().toISOString()
    },
    { onConflict: "customer_telegram_id" }
  );
  if (error) throw error;
}

async function getPendingBooking(customerTelegramId: number, chatId: number) {
  const { data, error } = await getSupabaseAdmin()
    .from("pending_bookings")
    .select("*")
    .eq("customer_telegram_id", customerTelegramId)
    .eq("chat_id", chatId)
    .maybeSingle<PendingBooking>();

  if (error) throw error;
  return data;
}

async function clearPendingBooking(customerTelegramId: number) {
  const { error } = await getSupabaseAdmin()
    .from("pending_bookings")
    .delete()
    .eq("customer_telegram_id", customerTelegramId);

  if (error) throw error;
}

async function handlePendingBookingName(message: TelegramMessage, pending: PendingBooking) {
  const user = message.from;
  if (!user) return;

  const text = message.text?.replace(/\s+/g, " ").trim() ?? "";
  const command = text.split(/\s+/)[0]?.split("@")[0].toLowerCase();
  if (!text || isCommandOrKnownButton(text, command)) {
    await reply(message.chat.id, "Send the booking name only, or send /book to start again.");
    return;
  }

  if (text.length > 80) {
    await reply(message.chat.id, "Use a shorter booking name, up to 80 characters.");
    return;
  }

  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await clearPendingBooking(user.id);
    await showBookingKeyboard(message, "That booking session expired. Send /book to start again.");
    return;
  }

  if (!isAdmin(user)) {
    const allowed = await ensureCustomerCanBookFromMessage(message, user);
    if (!allowed) {
      await clearPendingBooking(user.id);
      return;
    }
  }

  const supabase = getSupabaseAdmin();
  const { data: slot, error: slotError } = await supabase
    .from("slots")
    .select("*")
    .eq("id", pending.slot_id)
    .maybeSingle<DatabaseSlot>();

  if (slotError) throw slotError;

  if (!slot || slot.status !== "open") {
    await clearPendingBooking(user.id);
    await showBookingKeyboard(message, "That slot is no longer available. Send /book to choose another slot.");
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
    await clearPendingBooking(user.id);
    const activeSlot = slotLabel(activeBooking.slots);
    await showBookingKeyboard(message, `You already have an active booking: ${activeSlot}. Use /cancel before booking another slot.`);
    return;
  }

  const { data: claimedSlot, error: updateError } = await supabase
    .from("slots")
    .update({ status: "booked", updated_at: new Date().toISOString() })
    .eq("id", slot.id)
    .eq("status", "open")
    .select("*")
    .maybeSingle<DatabaseSlot>();

  if (updateError) throw updateError;

  if (!claimedSlot) {
    await clearPendingBooking(user.id);
    await showBookingKeyboard(message, "That slot was just taken. Send /book to choose another slot.");
    return;
  }

  const { data: booking, error: bookingError } = await supabase.from("bookings").insert({
    slot_id: claimedSlot.id,
    customer_telegram_id: user.id,
    customer_username: user.username ?? null,
    customer_name: bookingCustomerName(text),
    status: "booked"
  }).select("*").maybeSingle<DatabaseBooking>();

  await clearPendingBooking(user.id);

  if (bookingError) {
    await supabase.from("slots").update({ status: "open" }).eq("id", claimedSlot.id).eq("status", "booked");
    throw bookingError;
  }

  if (booking) {
    try {
      const calendarEventId = await createGoogleBookingEvent({ booking, slot: claimedSlot });
      if (calendarEventId) {
        await supabase
          .from("bookings")
          .update({ calendar_event_id: calendarEventId })
          .eq("id", booking.id);
      }
    } catch (error) {
      console.error("Failed to create Google Calendar event", error);
    }
  }

  await showBookingKeyboard(
    message,
    `Booked: ${slotLabel(claimedSlot)}.\n\nAddress: ${BOOKING_ADDRESS}\n\nUse /cancel if you need to release it.`
  );
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
    await showBookingKeyboard(message, "You do not have an active Draaqutz booking.");
    return;
  }

  await deleteBookingCalendarEvent(booking.calendar_event_id);
  await refreshExistingChannelSchedule(booking.service_date);
  await showBookingKeyboard(message, `Cancelled. The slot is open again: ${slotLabelFromRpc(booking)}.`);
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

  await showBookingKeyboard(
    message,
    booking ? `Your active booking: ${slotLabel(booking.slots)}.` : "You do not have an active Draaqutz booking."
  );
}

async function showLoyalty(message: TelegramMessage, admin = false) {
  const user = message.from;
  if (!user) return;

  await upsertCustomer(user);

  const supabase = getSupabaseAdmin();
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("loyalty_stamps")
    .eq("telegram_id", user.id)
    .maybeSingle<{ loyalty_stamps: number }>();

  if (customerError) throw customerError;

  const { count, error: eventCountError } = await supabase
    .from("loyalty_events")
    .select("id", { count: "exact", head: true })
    .eq("customer_telegram_id", user.id)
    .eq("reason", "completed_booking");

  if (eventCountError) throw eventCountError;

  const stamps = count ?? customer?.loyalty_stamps ?? 0;

  if (customer && customer.loyalty_stamps !== stamps) {
    await supabase
      .from("customers")
      .update({ loyalty_stamps: stamps })
      .eq("telegram_id", user.id);
  }

  const stampWord = stamps === 1 ? "stamp" : "stamps";
  const text = [`Loyalty`, "", `You have ${stamps} Draaqutz loyalty ${stampWord}.`, "Each completed booking adds 1 stamp."].join("\n");

  if (admin) {
    await showAdminKeyboard(message.chat.id, text);
    return;
  }

  await showCustomerKeyboard(message.chat.id, text);
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

  const dates = await upcomingScheduleDates();

  if (!dates.length) {
    await showAdminKeyboard(chatId, "No upcoming dates with slots. Create slots first with /newslot.");
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
    const bookingName = activeBooking ? adminBookingLabel(activeBooking).toUpperCase() : "";
    const statusText = activeBooking ? "✓" : "○";
    return [
      {
        text: truncateLabel(`${statusText} ${formatTime(slot.start_time)}-${formatTime(slot.end_time)} -> ${bookingName}`),
        callback_data: `as:${slot.id}:${date}`
      }
    ];
  });

  buttons.push([{ text: "Delete Slots", callback_data: `dx:s:${date}` }]);
  buttons.push([{ text: "← Back to Dates", callback_data: "ab" }]);
  buttons.push([{ text: "➕ Add Slot", callback_data: "ns:start" }]);

  await editInlineReply(callback, `Slots for ${dateButtonLabel(date)} (✓ booked, ○ open):`, { inline_keyboard: buttons });
}

async function startSlotDeleteSelection(callback: TelegramCallbackQuery, date: string) {
  const chatId = callback.message?.chat.id;
  if (!chatId) return;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("slots")
    .select("id")
    .eq("service_date", date)
    .in("status", ["open", "booked"])
    .order("start_time", { ascending: true });

  if (error) throw error;

  const slotIds = (data ?? []).map((slot) => slot.id);
  if (!slotIds.length) {
    await editInlineReply(callback, `No deletable slots for ${dateButtonLabel(date)}.`, {
      inline_keyboard: [[{ text: "← Back", callback_data: `ad:${date}` }]]
    });
    return;
  }

  await supabase
    .from("slot_delete_drafts")
    .delete()
    .eq("admin_telegram_id", callback.from.id)
    .eq("chat_id", chatId);

  const expiresAt = new Date(Date.now() + DRAFT_TTL_MINUTES * 60 * 1000).toISOString();
  const { data: draft, error: draftError } = await supabase
    .from("slot_delete_drafts")
    .insert({
      admin_telegram_id: callback.from.id,
      chat_id: chatId,
      service_date: date,
      slot_ids: slotIds,
      selected_slot_ids: [],
      expires_at: expiresAt
    })
    .select("*")
    .single<SlotDeleteDraft>();

  if (draftError) throw draftError;
  await renderSlotDeleteSelection(callback, draft);
}

async function getSlotDeleteDraftForCallback(callback: TelegramCallbackQuery, draftId: string) {
  const chatId = callback.message?.chat.id;
  if (!chatId) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("slot_delete_drafts")
    .select("*")
    .eq("id", draftId)
    .eq("admin_telegram_id", callback.from.id)
    .eq("chat_id", chatId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<SlotDeleteDraft>();

  if (error) throw error;
  return data;
}

async function fetchDeleteDraftSlots(draft: SlotDeleteDraft) {
  if (!draft.slot_ids.length) {
    return new Map<string, DatabaseSlot & { bookings?: DatabaseBooking[] }>();
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("slots")
    .select("*, bookings(*)")
    .in("id", draft.slot_ids)
    .in("status", ["open", "booked"])
    .order("start_time", { ascending: true });

  if (error) throw error;
  const byId = new Map(((data ?? []) as Array<DatabaseSlot & { bookings?: DatabaseBooking[] }>).map((slot) => [slot.id, slot]));
  return byId;
}

async function renderSlotDeleteSelection(callback: TelegramCallbackQuery, draft: SlotDeleteDraft, warning?: string) {
  const slotsById = await fetchDeleteDraftSlots(draft);
  const selected = new Set(draft.selected_slot_ids);
  const visibleSlots = draft.slot_ids
    .map((id, index) => ({ slot: slotsById.get(id), index }))
    .filter((item): item is { slot: DatabaseSlot & { bookings?: DatabaseBooking[] }; index: number } => Boolean(item.slot));
  const visibleSelectedCount = visibleSlots.filter(({ slot }) => selected.has(slot.id)).length;
  const rows = visibleSlots.map(({ slot, index }) => {
    const activeBooking = slot.bookings?.find((booking) => booking.status === "booked");
    const marker = selected.has(slot.id) ? "●" : "○";
    const bookedText = activeBooking ? ` booked ${adminBookingLabel(activeBooking)}` : " open";
    return [
      {
        text: truncateLabel(`${marker} ${formatTime(slot.start_time)}-${formatTime(slot.end_time)} ${bookedText}`),
        callback_data: `dx:t:${draft.id}:${index}`
      }
    ];
  });

  rows.push([
    { text: "✕ Cancel", callback_data: `dx:x:${draft.id}` },
    { text: `Delete (${visibleSelectedCount})`, callback_data: `dx:c:${draft.id}` }
  ]);
  rows.push([{ text: "← Back", callback_data: `ad:${draft.service_date}` }]);

  const selectedLabels = visibleSlots
    .map(({ slot }) => slot)
    .filter((slot) => selected.has(slot.id))
    .map((slot) => `- ${formatTime(slot.start_time)}-${formatTime(slot.end_time)} ${slot.location}`);
  const selectedText = selectedLabels.length ? `\n\nSelected:\n${selectedLabels.join("\n")}` : "\n\nTap slots to select one or more.";
  const warningText = warning ? `\n\n${warning}` : "";

  await editInlineReply(callback, `Delete slots for ${dateButtonLabel(draft.service_date)}${selectedText}${warningText}`, {
    inline_keyboard: rows
  });
}

async function toggleSlotDeleteSelection(callback: TelegramCallbackQuery, draftId: string, indexText: string) {
  const draft = await getSlotDeleteDraftForCallback(callback, draftId);
  if (!draft) {
    await editInlineReply(callback, "This delete picker expired. Open /slots again.", {
      inline_keyboard: [[{ text: "← Back to Dates", callback_data: "ab" }]]
    });
    return;
  }

  const index = Number(indexText);
  if (!Number.isInteger(index) || index < 0 || index >= draft.slot_ids.length) {
    await renderSlotDeleteSelection(callback, draft, "That slot button is invalid. Pick from the current list.");
    return;
  }

  const slotId = draft.slot_ids[index];
  const selected = new Set(draft.selected_slot_ids);
  if (selected.has(slotId)) {
    selected.delete(slotId);
  } else {
    selected.add(slotId);
  }

  const selectedSlotIds = draft.slot_ids.filter((id) => selected.has(id));
  const supabase = getSupabaseAdmin();
  const { data: updated, error } = await supabase
    .from("slot_delete_drafts")
    .update({ selected_slot_ids: selectedSlotIds, updated_at: new Date().toISOString() })
    .eq("id", draft.id)
    .select("*")
    .single<SlotDeleteDraft>();

  if (error) throw error;
  await renderSlotDeleteSelection(callback, updated);
}

async function showSlotDeleteConfirm(callback: TelegramCallbackQuery, draftId: string) {
  const draft = await getSlotDeleteDraftForCallback(callback, draftId);
  if (!draft) {
    await editInlineReply(callback, "This delete picker expired. Open /slots again.", {
      inline_keyboard: [[{ text: "← Back to Dates", callback_data: "ab" }]]
    });
    return;
  }

  if (!draft.selected_slot_ids.length) {
    await renderSlotDeleteSelection(callback, draft, "Select at least one slot first.");
    return;
  }

  const slotsById = await fetchDeleteDraftSlots(draft);
  const selected = draft.slot_ids
    .map((id) => slotsById.get(id))
    .filter((slot): slot is DatabaseSlot & { bookings?: DatabaseBooking[] } => Boolean(slot))
    .filter((slot) => draft.selected_slot_ids.includes(slot.id));
  if (!selected.length) {
    await renderSlotDeleteSelection(callback, draft, "Those selected slots are no longer available to delete.");
    return;
  }

  const bookedCount = selected.filter((slot) => slot.status === "booked" || slot.bookings?.some((booking) => booking.status === "booked")).length;
  const rows = selected.map((slot) => `- ${formatTime(slot.start_time)}-${formatTime(slot.end_time)} ${slot.location}`);
  const bookedText = bookedCount > 0 ? `\n\n${bookedCount} booked slot(s) will notify customers.` : "";

  await editInlineReply(callback, `Delete ${selected.length} slot(s) for ${dateButtonLabel(draft.service_date)}?\n\n${rows.join("\n")}${bookedText}`, {
    inline_keyboard: [
      [{ text: "Confirm Delete", callback_data: `dx:y:${draft.id}` }],
      [{ text: "← Back", callback_data: `dx:s:${draft.service_date}` }]
    ]
  });
}

async function cancelSlotDeleteSelection(callback: TelegramCallbackQuery, draftId: string) {
  const draft = await getSlotDeleteDraftForCallback(callback, draftId);
  const supabase = getSupabaseAdmin();
  await supabase.from("slot_delete_drafts").delete().eq("id", draftId);

  if (draft) {
    await showAdminSlotsForDate(callback, draft.service_date);
    return;
  }

  await editAdminSlotDates(callback);
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
  const status = slot.status === "booked" && activeBooking ? `Booked by ${adminBookingLabel(activeBooking)}` : "Open";

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
    ? "Cancel Booking keeps this slot open. Delete Slots removes selected slot(s) too. Both notify booked customers."
    : "Delete Slots lets you remove one or more slots from this date.";
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  if (activeBooking) {
    rows.push([{ text: "Cancel Booking", callback_data: `cb:${slot.id}` }]);
  }

  rows.push([{ text: "Delete Slots", callback_data: `dx:s:${slot.service_date}` }]);
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
  const completedLabel = completed.customer_username ? `${completed.customer_name} (@${completed.customer_username})` : completed.customer_name;
  await editInlineReply(callback, `Completed: ${slotLabelFromRpc(completed)}\n${stampText} for ${completedLabel}.`, {
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
  if (result.cancelled_now) await deleteBookingCalendarEvent(result.calendar_event_id);

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

async function cancelAdminSlotsByIds(slotIds: string[]) {
  if (!slotIds.length) return [];

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .rpc("cancel_admin_slots_by_ids", { slot_ids_input: slotIds });

  if (error) throw error;
  return (data ?? []) as AdminCancelledSlot[];
}

async function deleteSelectedSlotsFromCallback(callback: TelegramCallbackQuery, draftId: string) {
  const draft = await getSlotDeleteDraftForCallback(callback, draftId);
  if (!draft) {
    await editInlineReply(callback, "This delete picker expired. Open /slots again.", {
      inline_keyboard: [[{ text: "← Back to Dates", callback_data: "ab" }]]
    });
    return;
  }

  if (!draft.selected_slot_ids.length) {
    await renderSlotDeleteSelection(callback, draft, "Select at least one slot first.");
    return;
  }

  const liveSlotsById = await fetchDeleteDraftSlots(draft);
  const liveSelectedIds = draft.slot_ids
    .filter((id) => draft.selected_slot_ids.includes(id))
    .filter((id) => liveSlotsById.has(id));

  if (!liveSelectedIds.length) {
    await renderSlotDeleteSelection(callback, draft, "Those selected slots are no longer available to delete.");
    return;
  }

  await editInlineText(callback, `Deleting ${liveSelectedIds.length} slot(s) for ${dateButtonLabel(draft.service_date)}...`);

  const results = await cancelAdminSlotsByIds(liveSelectedIds);
  const cancelled = results.filter((result) => result.cancelled_now);
  const affectedDates = Array.from(new Set(cancelled.map((result) => result.service_date)));

  await Promise.all(affectedDates.map((date) => refreshExistingChannelSchedule(date)));
  await Promise.all(cancelled.map((result) => deleteBookingCalendarEvent(result.calendar_event_id)));
  const notifyResults = await Promise.all(cancelled.map((result) => notifyAdminCancelledBooking(result)));

  const supabase = getSupabaseAdmin();
  await supabase.from("slot_delete_drafts").delete().eq("id", draft.id);

  const notified = notifyResults.filter((text) => text === "Customer notified.").length;
  const noNotificationNeeded = notifyResults.filter((text) => text === "No customer notification needed.").length;
  const notificationFailures = notifyResults.filter((text) => text.startsWith("Customer notification failed"));
  const skipped = liveSelectedIds.length - results.length;
  const lines = [
    `Deleted ${cancelled.length} slot(s) for ${dateButtonLabel(draft.service_date)}.`
  ];

  if (notified > 0) lines.push(`Customer notifications sent: ${notified}.`);
  if (noNotificationNeeded > 0 && notified === 0 && !notificationFailures.length) lines.push("No customer notifications needed.");
  if (notificationFailures.length) lines.push(`Notification failures: ${notificationFailures.length}.`);
  if (skipped > 0) lines.push(`Skipped ${skipped} slot(s) that were already unavailable.`);

  await editInlineReply(callback, lines.join("\n"), {
    inline_keyboard: [[{ text: "← Back to Slots", callback_data: `ad:${draft.service_date}` }]]
  });
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
  if (result.cancelled_now) await deleteBookingCalendarEvent(result.calendar_event_id);

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

async function deleteBookingCalendarEvent(calendarEventId: string | null | undefined) {
  try {
    await deleteGoogleBookingEvent(calendarEventId);
  } catch (error) {
    console.error("Failed to delete Google Calendar event", error);
  }
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

  await editInlineReply(callback, `Cancel ${adminBookingLabel(activeBooking)}'s booking?\n${slotLabel(slot)}\n\nThe slot will stay open and the customer will be notified.`, {
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

    if (user) {
      const pendingBooking = await getPendingBooking(user.id, message.chat.id);
      if (pendingBooking) {
        if (isCommandOrKnownButton(text, command)) {
          await clearPendingBooking(user.id);
        } else {
          return handlePendingBookingName(message, pendingBooking);
        }
      }
    }

    if (admin) {
      if (text === "➕ New Slot") return startSlotCreation(message.chat.id);
      if (text === "📋 View Slots") return showAdminSlots(message.chat.id);
      if (text === "📢 Post") {
        return showPostDatePicker(message.chat.id);
      }
      if (text === "📅 Book Slot") return startCustomerBooking(message);
      if (text === "🧾 My Booking") return showCustomerBooking(message);
      if (text === "✕ Cancel Booking") return cancelCustomerBooking(message);
      if (text === "⭐ Loyalty") return showLoyalty(message, true);
      if (text === "❓ Help") return showAdminKeyboard(message.chat.id, helpText);
    }

    if (!admin) {
      if (text === "📅 Book Slot") return startCustomerBooking(message);
      if (text === "🧾 My Booking") return showCustomerBooking(message);
      if (text === "✕ Cancel Booking") return cancelCustomerBooking(message);
      if (text === "⭐ Loyalty") return showLoyalty(message);
      if (text === "❓ Help") return showCustomerKeyboard(message.chat.id, helpText);
    }

    if (command === "/start") {
      if (admin) {
        if (user) await setupAdminCommands(user.id);
        return showAdminKeyboard(message.chat.id, "Welcome back, admin! Use the buttons below or /help for commands.");
      }
      return startCustomerBooking(message);
    }
    if (command === "/book") return startCustomerBooking(message);
    if (command === "/help") {
      if (admin) {
        return showAdminKeyboard(message.chat.id, helpText);
      }
      return showCustomerKeyboard(message.chat.id, helpText);
    }
    if (command === "/mybooking") return showCustomerBooking(message);
    if (command === "/loyalty") return showLoyalty(message, admin);
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

    // Customer: retry channel membership verification
    if (data === "vc") {
      return retryChannelVerification(callback);
    }

    // Customer: date selection
    if (data.startsWith("date:")) {
      if (!isAdmin(callback.from)) {
        await upsertCustomer(callback.from);
        const allowed = await ensureCustomerCanBookFromCallback(callback);
        if (!allowed) return;
      }
      return listSlotsForDate(callback, data.slice(5));
    }

    // Customer: back to available dates
    if (data === "cd") {
      if (!isAdmin(callback.from)) {
        await upsertCustomer(callback.from);
        const allowed = await ensureCustomerCanBookFromCallback(callback);
        if (!allowed) return;
      }
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

    // Admin: delete slots - start selection for date
    if (data.startsWith("dx:s:")) {
      const date = data.slice(5);
      if (!assertDate(date)) return editInlineText(callback, "This date is invalid. Please open /slots again.");
      return startSlotDeleteSelection(callback, date);
    }

    // Admin: delete slots - toggle slot selection
    if (data.startsWith("dx:t:")) {
      const parts = data.slice(5).split(":");
      return toggleSlotDeleteSelection(callback, parts[0], parts[1]);
    }

    // Admin: delete slots - confirmation screen
    if (data.startsWith("dx:c:")) {
      return showSlotDeleteConfirm(callback, data.slice(5));
    }

    // Admin: delete slots - cancel selection
    if (data.startsWith("dx:x:")) {
      return cancelSlotDeleteSelection(callback, data.slice(5));
    }

    // Admin: delete slots - execute cancellation
    if (data.startsWith("dx:y:")) {
      return deleteSelectedSlotsFromCallback(callback, data.slice(5));
    }

    // Admin: choose date to post to channel
    if (data.startsWith("pd:")) {
      const date = data.slice(3);
      if (!assertDate(date)) return editInlineText(callback, "This date is invalid. Please open /post again.");
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
    .in("status", ["open", "booked", "completed"])
    .order("start_time", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ScheduleSlot[];
}

async function buildDraftText(dates: string[]) {
  const sections = await Promise.all(dates.map(async (date) => formatScheduleForDate(date, await fetchScheduleSlotsForDate(date))));
  return sections.join("\n\n---\n\n");
}

function formatScheduleForDate(date: string, slots: ScheduleSlot[]) {
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "BookWithDraBot";

  if (!slots.length) {
    return [
      `📅 Schedule for ${shortDate(date)}`,
      "",
      "No open slots for this date right now.",
      "",
      `💈 Text @${botUsername} to secure your slots!`
    ].join("\n");
  }

  const openCount = slots.filter((slot) => slot.status === "open").length;
  const header = openCount > 0
    ? `📅 Schedule for ${shortDate(date)}`
    : `📅 Schedule for ${shortDate(date)} – Fully booked`;

  const locationSections = Array.from(groupSlotsByLocation(slots).entries()).flatMap(([location, locationSlots]) => {
    const rows = locationSlots.map((slot) => {
      const activeBooking = slot.bookings?.find((booking) => booking.status === "booked" || booking.status === "completed");
      const name = activeBooking?.customer_name.replace(/\s*\(@[^)]+\)$/, "") ?? "";
      return `🕐 ${formatTime(slot.start_time)} – ${formatTime(slot.end_time)} → ${name}`;
    });

    return [`${location}:`, "", ...rows, ""];
  });

  const footer = openCount > 0
    ? `💈 Text @${botUsername} to secure your slots!`
    : `This date is fully booked. If a slot reopens, this post will update.\n\n💈 Text @${botUsername} to secure your slots!`;

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
    .select("message_id, content_hash, channel_id")
    .eq("id", postId)
    .maybeSingle<{ message_id: number; content_hash: string | null; channel_id: string }>();

  if (error) throw error;

  if (post?.message_id && post.channel_id === channelId) {
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
    } catch (editError) {
      if (isMessageNotModified(editError)) {
        await supabase.from("channel_posts").update({ content_hash: contentHash, updated_at: new Date().toISOString() }).eq("id", postId);
        return { status: "noop" as const };
      }
      await supabase.from("channel_posts").delete().eq("id", postId);
    }
  } else if (post) {
    await supabase.from("channel_posts").delete().eq("id", postId);
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
    const results: Array<{ date: string; status: string; error?: string }> = [];
    for (let i = 0; i < draft.service_dates.length; i += 1) {
      const date = draft.service_dates[i];
      const override = draft.edited && draft.service_dates.length === 1 ? draft.draft_text : undefined;
      try {
        const result = await publishScheduleDate(date, override);
        results.push({ date, status: result.status, ...("reason" in result ? { error: result.reason } : {}) });
      } catch (err) {
        const detail = err instanceof Error ? err.message : "Unknown error";
        results.push({ date, status: "error", error: detail });
      }
    }
    await supabase.from("channel_post_drafts").delete().eq("id", draft.id);
    const sent = results.filter((r) => r.status === "sent").length;
    const edited = results.filter((r) => r.status === "edited").length;
    const noop = results.filter((r) => r.status === "noop").length;
    const skipped = results.filter((r) => r.status === "skipped");
    const errors = results.filter((r) => r.status === "error");
    const lines = [`Posted channel schedule.\nSent: ${sent}. Edited: ${edited}. No change: ${noop}.`];
    if (skipped.length) lines.push(`Skipped: ${skipped.length}. Reason: ${skipped.map((r) => r.error).join(", ")}`);
    if (errors.length) lines.push(`Errors: ${errors.map((r) => `${shortDate(r.date)}: ${r.error}`).join("\n")}`);
    lines.push(`\nChannel ID: ${process.env.TELEGRAM_CHANNEL_ID || "(not set)"}`);
    await editInlineText(callback, lines.join("\n"));
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
