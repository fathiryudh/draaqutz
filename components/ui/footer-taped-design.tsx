import Link from "next/link";
import { Camera, Music2, Send } from "lucide-react";

const socials = [
  { label: "Instagram", href: "https://www.instagram.com/draaqutz", icon: Camera },
  { label: "TikTok", href: "https://www.tiktok.com/@draaqutz", icon: Music2 },
  { label: "Telegram", href: "https://t.me/draaqutz", icon: Send }
];

function Tape({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`absolute hidden h-10 w-24 rotate-[-28deg] rounded-sm bg-charcoal shadow-[0_8px_18px_-12px_rgba(17,16,14,0.8)] md:block ${className}`}
    >
      <div className="h-full w-full bg-[linear-gradient(90deg,transparent_0_12%,rgba(255,255,255,0.12)_12%_18%,transparent_18%_32%,rgba(255,255,255,0.1)_32%_38%,transparent_38%)]" />
    </div>
  );
}

export function FooterTapedDesign() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="mx-auto my-10 max-w-6xl px-4 text-charcoal md:px-8">
      <div className="relative rounded-[2rem] border border-charcoal/10 bg-paper px-5 py-8 shadow-[0_28px_70px_-48px_rgba(17,16,14,0.65)] md:px-10">
        <Tape className="-left-8 -top-3" />
        <Tape className="-right-8 -top-3 rotate-[28deg]" />

        <div className="grid gap-8 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
          <div>
            <Link href="/" className="text-3xl font-semibold tracking-tight">
              Draaqutz
            </Link>
            <p className="mt-3 max-w-sm leading-7 text-charcoal/58">
              Home-based cuts, housecalls, pop-up events, and Telegram-first bookings in Singapore.
            </p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-charcoal/45">
              Explore
            </h4>
            <div className="mt-4 flex flex-col gap-2 text-sm font-medium text-charcoal/62">
              <Link href="#services">Services</Link>
              <Link href="#work">Cuts</Link>
              <Link href="#loyalty">Loyalty</Link>
              <Link href="#book">Booking</Link>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-charcoal/45">
              Socials
            </h4>
            <div className="mt-4 flex flex-col gap-2">
              {socials.map((social) => {
                const Icon = social.icon;
                return (
                  <a
                    key={social.href}
                    href={social.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-medium text-charcoal/62 transition-colors duration-500 ease-heavy hover:text-charcoal"
                  >
                    <Icon className="h-4 w-4" />
                    {social.label}
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 px-2 text-sm text-charcoal/48 md:flex-row md:items-center md:justify-between">
        <p>Copyright {currentYear} Draaqutz. All rights reserved.</p>
        <p>Singapore home-based cuts and event pop-ups.</p>
      </div>
    </footer>
  );
}
