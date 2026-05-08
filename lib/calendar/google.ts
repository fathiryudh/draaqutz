import { createSign } from "crypto";
import type { DatabaseBooking, DatabaseSlot } from "@/lib/supabase/admin";

type GoogleCalendarConfig = {
  calendarId: string;
  serviceAccountEmail: string;
  privateKey: string;
  timeZone: string;
};

type BookingCalendarEvent = {
  booking: Pick<DatabaseBooking, "id" | "customer_name" | "customer_username" | "customer_telegram_id">;
  slot: Pick<DatabaseSlot, "service_date" | "start_time" | "end_time" | "location">;
};

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleEventResponse = {
  id?: string;
  error?: {
    message?: string;
  };
};

let tokenCache: { accessToken: string; expiresAt: number } | null = null;

function getGoogleCalendarConfig(): GoogleCalendarConfig | null {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!calendarId && !serviceAccountEmail && !privateKey) return null;

  if (!calendarId || !serviceAccountEmail || !privateKey) {
    throw new Error("Missing Google Calendar environment variables.");
  }

  return {
    calendarId,
    serviceAccountEmail,
    privateKey,
    timeZone: process.env.BUSINESS_TIME_ZONE || "Asia/Singapore"
  };
}

function base64Url(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createJwt(config: GoogleCalendarConfig) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: config.serviceAccountEmail,
    scope: "https://www.googleapis.com/auth/calendar.events",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  }));
  const unsignedToken = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();

  return `${unsignedToken}.${signer.sign(config.privateKey, "base64url")}`;
}

async function getAccessToken(config: GoogleCalendarConfig) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: createJwt(config)
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const data = await response.json() as GoogleTokenResponse;

  if (!response.ok || !data.access_token) {
    const detail = data.error_description || data.error || response.statusText;
    throw new Error(`Google Calendar auth failed: ${detail}`);
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + 55 * 60 * 1000
  };

  return data.access_token;
}

function dateTime(serviceDate: string, time: string) {
  return `${serviceDate}T${time}`;
}

function customerDescription(booking: BookingCalendarEvent["booking"]) {
  const username = booking.customer_username ? `@${booking.customer_username}` : "No Telegram username";

  return [
    `Customer: ${booking.customer_name}`,
    `Telegram ID: ${booking.customer_telegram_id}`,
    `Telegram username: ${username}`,
    `Booking ID: ${booking.id}`
  ].join("\n");
}

export async function createGoogleBookingEvent(event: BookingCalendarEvent) {
  const config = getGoogleCalendarConfig();
  if (!config) return null;

  const accessToken = await getAccessToken(config);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        summary: `Draaqutz - ${event.booking.customer_name}`,
        location: event.slot.location,
        description: customerDescription(event.booking),
        start: {
          dateTime: dateTime(event.slot.service_date, event.slot.start_time),
          timeZone: config.timeZone
        },
        end: {
          dateTime: dateTime(event.slot.service_date, event.slot.end_time),
          timeZone: config.timeZone
        }
      })
    }
  );
  const data = await response.json() as GoogleEventResponse;

  if (!response.ok || !data.id) {
    const detail = data.error?.message || response.statusText;
    throw new Error(`Google Calendar event creation failed: ${detail}`);
  }

  return data.id;
}

export async function deleteGoogleBookingEvent(calendarEventId: string | null | undefined) {
  if (!calendarEventId) return;

  const config = getGoogleCalendarConfig();
  if (!config) return;

  const accessToken = await getAccessToken(config);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(calendarEventId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  if (response.status === 404 || response.status === 410) return;

  if (!response.ok) {
    throw new Error(`Google Calendar event deletion failed: ${response.status} ${response.statusText}`);
  }
}
