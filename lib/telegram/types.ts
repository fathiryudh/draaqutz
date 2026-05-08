export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: {
    id: number;
    type: string;
  };
  from?: TelegramUser;
};

export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type InlineKeyboardMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string } | { text: string; url: string }>>;
};

export type ReplyKeyboardMarkup = {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
};

export type ReplyKeyboardRemove = {
  remove_keyboard: true;
};
