import type { InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove } from "./types";

type SendOptions = {
  reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove;
  parse_mode?: "HTML";
  disable_web_page_preview?: boolean;
};

type EditOptions = {
  reply_markup?: InlineKeyboardMarkup;
  parse_mode?: "HTML";
  disable_web_page_preview?: boolean;
};

function token() {
  const value = process.env.TELEGRAM_BOT_TOKEN;

  if (!value) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN.");
  }

  return value;
}

async function telegramRequest<T>(
  method: string,
  payload: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = (await response.json()) as T & { ok?: boolean; description?: string };

  if (!response.ok || data.ok === false) {
    const error = new Error(data.description ?? `Telegram ${method} failed.`);
    error.name = "TelegramApiError";
    throw error;
  }

  return data;
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  options: SendOptions = {}
) {
  return telegramRequest<{ ok: true; result: { message_id: number } }>("sendMessage", {
    chat_id: chatId,
    text,
    ...options
  });
}

export async function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  options: EditOptions = {}
) {
  return telegramRequest("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...options
  });
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  return telegramRequest("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text
  });
}

export async function setMyCommands(commands: Array<{ command: string; description: string }>, scope?: { type: string; user_id?: number }) {
  return telegramRequest("setMyCommands", {
    commands,
    ...(scope && { scope })
  });
}
