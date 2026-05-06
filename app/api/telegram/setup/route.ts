import { setupBotCommands } from "@/lib/telegram/bot";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const setupSecret = process.env.TELEGRAM_SETUP_SECRET;

  if (!setupSecret) {
    return NextResponse.json({ ok: false, error: "TELEGRAM_SETUP_SECRET is not configured" }, { status: 500 });
  }

  const authorization = request.headers.get("authorization");
  const bearerSecret = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  const headerSecret = request.headers.get("x-telegram-setup-secret");

  if (bearerSecret !== setupSecret && headerSecret !== setupSecret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    await setupBotCommands();
    return NextResponse.json({ ok: true, message: "Bot commands registered" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "POST to this endpoint with TELEGRAM_SETUP_SECRET to register bot menu commands"
  });
}
