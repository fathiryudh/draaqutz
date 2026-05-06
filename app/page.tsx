import {
  ArrowUpRight,
  CalendarCheck,
  CheckCircle,
  Drop,
  Medal,
  TelegramLogo,
} from "@phosphor-icons/react/dist/ssr";
import type { StaticImageData } from "next/image";
import { PhotoGallery } from "@/components/ui/gallery";
import { ServicesBoard } from "@/components/services-board";
import { SiteNav } from "@/components/site-nav";
import { FooterTapedDesign } from "@/components/ui/footer-taped-design";
import { HeroDetails } from "@/components/hero-details";
import burstFade from "../images/burst_fade.jpg";
import lowTaper from "../images/low_taper.jpg";
import midFade from "../images/mid_fade.jpg";
import side from "../images/side.jpeg";
import taper from "../images/taper.jpg";

const services = [
  { category: "Haircuts", name: "Men's haircut", price: "$15" },
  { category: "Haircuts", name: "Children's haircut", price: "$10" },
  { category: "Haircuts", name: "Beard trimming", price: "$5" },
  { category: "Haircuts", name: "Blow dry and style", price: "Free" },
  { category: "Color services", name: "Full highlights and haircut", price: "$50" },
  { category: "Housecall services", name: "East side travel fee", price: "$25" },
  { category: "Housecall services", name: "Other areas travel fee", price: "$35" }
];

const gallery: Array<{ title: string; image: StaticImageData }> = [
  { title: "Burst fade haircut", image: burstFade },
  { title: "Low taper haircut", image: lowTaper },
  { title: "Mid fade haircut", image: midFade },
  { title: "Side profile haircut", image: side },
  { title: "Taper haircut", image: taper }
];

function ArrowButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="group inline-flex items-center gap-3 rounded-full bg-charcoal py-2 pl-6 pr-2 text-sm font-semibold text-bone shadow-[0_20px_45px_-25px_rgba(17,16,14,0.75)] transition-all duration-700 ease-heavy hover:-translate-y-0.5 active:scale-[0.98]"
    >
      {children}
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-bone text-charcoal transition-transform duration-700 ease-heavy group-hover:translate-x-1 group-hover:-translate-y-[1px]">
        <ArrowUpRight size={17} weight="light" />
      </span>
    </a>
  );
}

function Shell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[2rem] border border-charcoal/10 bg-charcoal/[0.045] p-1.5 ${className}`}>
      <div className="h-full rounded-[calc(2rem-0.375rem)] border border-white/45 bg-paper shadow-[inset_0_1px_1px_rgba(255,255,255,0.85)]">
        {children}
      </div>
    </div>
  );
}

export default function Home() {
  const botName = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const botHref = botName ? `https://t.me/${botName.replace("@", "")}` : "#book";

  return (
    <main className="w-full max-w-full overflow-x-hidden">
      <SiteNav />

      <section className="mx-auto grid min-h-[82dvh] w-full max-w-[100vw] grid-cols-1 items-center gap-12 px-4 pb-16 pt-32 md:min-h-dvh md:max-w-7xl md:grid-cols-[0.95fr_1.05fr] md:px-8 md:pb-8 md:pt-28">
        <div className="reveal flex min-w-0 max-w-full flex-col justify-center">
          <p className="mb-6 w-max max-w-full rounded-full border border-charcoal/10 bg-paper px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-charcoal/62">
            Home-based barber in Singapore
          </p>
          <h1 className="max-w-full text-[clamp(3rem,7vw,6.7rem)] font-black leading-[0.92] tracking-normal text-charcoal md:max-w-5xl">
            Draaqutz
          </h1>
          <p className="mt-7 max-w-full text-pretty text-lg font-medium leading-8 text-charcoal/70 md:max-w-2xl">
            Clean home-based cuts in Singapore. Bookings happen through Telegram, with slots posted when the schedule opens.
          </p>
          <div className="mt-9 flex max-w-full flex-col items-start gap-3 sm:flex-row">
            <ArrowButton href={botHref}>Book through Telegram</ArrowButton>
            <a
              href="#services"
              className="inline-flex items-center justify-center rounded-full border border-charcoal/12 bg-paper px-6 py-3 text-sm font-semibold text-charcoal transition-all duration-700 ease-heavy hover:-translate-y-0.5 active:scale-[0.98]"
            >
              View services
            </a>
          </div>
        </div>

        <div className="reveal flex min-w-0 max-w-full items-center" style={{ animationDelay: "120ms" }}>
          <HeroDetails />
        </div>
      </section>

      <section id="services" className="mx-auto max-w-7xl px-4 py-24 md:px-8 md:py-32">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="mb-4 w-max rounded-full border border-charcoal/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-charcoal/62">
              Services
            </p>
            <h2 className="max-w-full text-balance text-4xl font-extrabold leading-none tracking-normal text-charcoal md:max-w-xl md:text-6xl">
              Clear pricing for cuts, color, and housecalls.
            </h2>
            <p className="mt-6 max-w-md font-medium leading-7 text-charcoal/64">
              Housecall prices exclude haircuts. Haircuts are an additional $10 for non-east-side housecalls, and location can affect final pricing.
            </p>
          </div>
          <ServicesBoard services={services} />
        </div>
      </section>

      <section id="work">
        <PhotoGallery
          photos={gallery.map((item, index) => ({
            id: index + 1,
            src: item.image,
            alt: item.title,
            direction: index % 2 === 0 ? "left" : "right"
          }))}
        />
      </section>

      <section id="loyalty" className="mx-auto max-w-7xl px-4 py-24 md:px-8 md:py-32">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_0.78fr]">
          <Shell>
            <div className="p-7 md:p-10">
              <Medal size={32} weight="light" className="text-copper" />
              <h2 className="mt-8 max-w-3xl text-4xl font-extrabold leading-none tracking-normal text-charcoal md:text-6xl">
                Loyalty stamps tracked after completed cuts.
              </h2>
              <p className="mt-6 max-w-2xl text-lg font-medium leading-8 text-charcoal/66">
                Once a booking is marked complete, the bot records a stamp for that customer. Customers can check their count from Telegram.
              </p>
              <div className="mt-8 grid grid-cols-5 gap-3">
                {Array.from({ length: 10 }).map((_, index) => (
                  <div
                    key={index}
                    className="flex aspect-square items-center justify-center rounded-full border border-charcoal/10 bg-charcoal/[0.04]"
                  >
                    <CheckCircle size={22} weight={index < 6 ? "fill" : "light"} className={index < 6 ? "text-copper" : "text-charcoal/28"} />
                  </div>
                ))}
              </div>
            </div>
          </Shell>

          <Shell>
            <div className="flex h-full flex-col justify-between p-7 md:p-10">
              <Drop size={32} weight="light" className="text-copper" />
              <div>
                <h3 className="mt-20 text-3xl font-extrabold tracking-normal text-charcoal">
                  Sea salt spray
                </h3>
                <p className="mt-4 font-medium leading-7 text-charcoal/64">
                  Styling support for a clean, textured finish after the cut.
                </p>
              </div>
            </div>
          </Shell>
        </div>
      </section>

      <section id="book" className="mx-auto max-w-7xl px-4 py-24 md:px-8 md:py-32">
        <div className="grid grid-cols-1 overflow-hidden rounded-[2.5rem] bg-charcoal text-bone md:grid-cols-[0.9fr_1.1fr]">
          <div className="p-8 md:p-12">
            <TelegramLogo size={38} weight="light" className="text-copper" />
            <h2 className="mt-8 max-w-xl text-4xl font-extrabold leading-none tracking-normal md:text-6xl">
              Telegram is where bookings happen.
            </h2>
            <p className="mt-6 max-w-lg text-lg font-medium leading-8 text-bone/70">
              Slots open whenever the schedule is available. Customers reserve through the bot, cancel if needed, and the channel schedule updates.
            </p>
            <div className="mt-9">
              <ArrowButton href={botHref}>Open booking bot</ArrowButton>
            </div>
          </div>
          <div className="bg-bone/8 p-6 md:p-12">
            <div className="rounded-[2rem] bg-bone p-5 text-charcoal">
              <div className="flex items-center gap-3 border-b border-charcoal/10 pb-4">
                <CalendarCheck size={24} weight="light" />
                <p className="font-semibold">Sample channel schedule</p>
              </div>
              <div className="space-y-3 pt-5 text-lg">
                <p className="font-semibold">Schedule for 10/5</p>
                <p className="pt-3 font-semibold">In-House:</p>
                <p>12:00 PM - 1:00 PM {">"} Haris</p>
                <p>1:00 PM - 2:00 PM {">"} Qayyum</p>
                <p>2:00 PM - 3:00 PM {">"}</p>
                <p>3:00 PM - 4:00 PM {">"}</p>
                <p className="pt-6 italic text-charcoal/62">Book your slot early to secure your spot.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <FooterTapedDesign />
    </main>
  );
}
