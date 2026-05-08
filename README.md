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
TELEGRAM_SETUP_SECRET=
TELEGRAM_CHANNEL_ID=
TELEGRAM_CHANNEL_URL=https://t.me/draaqutz
ADMIN_TELEGRAM_IDS=
ADMIN_TELEGRAM_USERNAMES=
NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=
BUSINESS_TIME_ZONE=Asia/Singapore
```

For local admin testing, `ADMIN_TELEGRAM_USERNAMES` can be comma-separated usernames without `@`. Add Telegram numeric IDs later when available.
Set `TELEGRAM_WEBHOOK_SECRET` to a random string and pass it when registering the webhook so Telegram includes it in the `x-telegram-bot-api-secret-token` header.
Set `TELEGRAM_SETUP_SECRET` to a different random string for the command setup route.
Set `TELEGRAM_CHANNEL_ID` to the Draaqutz channel id used for membership checks, and keep `TELEGRAM_CHANNEL_URL` as the public join link shown to customers. The bot must be able to inspect channel members; if verification is not configured, customers cannot view or book slots.

Optional Google Calendar sync:

```bash
GOOGLE_CALENDAR_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
```

Create a Google Cloud service account, enable the Google Calendar API, then share the target Google Calendar with the service account email using permission to make changes to events. Use that calendar's ID for `GOOGLE_CALENDAR_ID`, the service account email for `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and the private key from the service account JSON for `GOOGLE_PRIVATE_KEY`. When all three values are set, confirmed Telegram bookings are added to Google Calendar and cancelled bookings remove their matching calendar event.

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

Register Telegram bot commands through the secured setup route:

```bash
curl -X POST "http://localhost:3000/api/telegram/setup" \
  -H "Authorization: Bearer $TELEGRAM_SETUP_SECRET"
```

Run checks:

```bash
npm run typecheck
npm run lint
npm run test
```

## Bot Commands

Customer commands:

- `/start` shows available dates.
- `/mybooking` shows the active booking.
- `/cancel` cancels the active booking and reopens the slot.
- `/loyalty` shows loyalty stamp count.

Admin commands:

- `/newslot` starts the button-driven slot creation flow.
- `/slots` shows upcoming dates and individual slots. Tap a slot to view details, complete a booked slot, or open `Edit`.
- In `Edit`, `Cancel Booking` cancels the customer's booking, notifies the customer, and keeps the slot open. `Cancel Slot` cancels any booking, notifies the customer if needed, and removes the slot from the schedule.
- `/post` shows unposted dates with slots. Pick a date, preview that date's channel message, then press `Post`.

New slots are inserted first. When the admin is ready, `Post` shows dates that have slots but do not already have a channel post. Posted dates are hidden from that menu. Channel posts are one Telegram message per service date and are edited over time after bookings or cancellations.

## Notes

- The website uses real haircut gallery images and placeholder sea salt spray imagery until product photos are available.
- Bookings are held after the customer chooses a slot and sends the booking name.
- Customers must verify they have joined the Draaqutz Telegram channel before viewing or booking slots.
- Bookings sync to Google Calendar when the Google service account env values are configured.
- Customers can cancel their own bookings.
- Customers are notified when an admin cancels their booked slot.
- An allowed admin marks bookings complete to award one loyalty stamp exactly once.
- Deleted/cancelled slots are hidden operationally while their database history remains.
