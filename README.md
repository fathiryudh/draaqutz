# Draaqutz

Local-first website and Telegram booking bot for Draaqutz, a home-based barber business.

## Stack

- Next.js React app
- Tailwind CSS
- Supabase database
- Telegram bot webhook through `/api/telegram/webhook`

## Setup

Install dependencies:

```bash
npm install
```

Copy env values:

```bash
cp .env.example .env.local
```

Required values:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_CHANNEL_ID=
ADMIN_TELEGRAM_IDS=
ADMIN_TELEGRAM_USERNAMES=
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=
BUSINESS_TIME_ZONE=Asia/Singapore
```

For local admin testing, `ADMIN_TELEGRAM_USERNAMES` can be comma-separated usernames without `@`. Add Telegram numeric IDs later when available.
Set `TELEGRAM_WEBHOOK_SECRET` to a random string and pass it when registering the webhook so Telegram includes it in the `x-telegram-bot-api-secret-token` header.

## Supabase

Run the SQL in `supabase/schema.sql` in the Supabase SQL editor.

## Local Development

```bash
npm run dev
```

The site runs at:

```bash
http://localhost:3000
```

For Telegram local webhook testing, expose the local server with a tunnel such as ngrok:

```bash
ngrok http 3000
```

Then register the webhook:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://YOUR_TUNNEL_URL/api/telegram/webhook","secret_token":"'"$TELEGRAM_WEBHOOK_SECRET"'"}'
```

## Bot Commands

Customer commands:

- `/start` shows available dates.
- `/mybooking` shows the active booking.
- `/cancel` cancels the active booking and reopens the slot.
- `/loyalty` shows loyalty stamp count.

Admin commands:

- `/newslot 2026-05-10 12:00 13:00 In-House`
- `/newday 2026-05-10 12:00-13:00, 13:00-14:00`
- `/slots`
- `/cancel slot_id`
- `/complete slot_id`
- `/post`

Use `/slots` to get the short slot ID prefix for `/cancel` and `/complete`.

## Notes

- The website uses real haircut gallery images and placeholder sea salt spray imagery until product photos are available.
- Bookings are instant holds.
- Customers can cancel their own bookings.
- An allowed admin marks bookings complete to award loyalty stamps.
