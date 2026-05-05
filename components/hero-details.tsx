"use client";

import { CalendarDays, Home, Megaphone, Send } from "lucide-react";
import { motion } from "framer-motion";
import { GooeyText } from "@/components/ui/gooey-text-morphing";

const details = [
  {
    label: "Book on Telegram",
    description: "Reserve when slots open",
    icon: Send
  },
  {
    label: "From $15",
    description: "Men's haircut pricing",
    icon: CalendarDays
  },
  {
    label: "Home cuts",
    description: "Housecalls available",
    icon: Home
  },
  {
    label: "Pop-up cuts",
    description: "Look out for events",
    icon: Megaphone
  }
];

export function HeroDetails() {
  return (
    <div className="rounded-[2rem] border border-charcoal/10 bg-charcoal/[0.045] p-1.5">
      <div className="rounded-[calc(2rem-0.375rem)] border border-white/45 bg-paper p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.85)] md:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-copper">
          Quick details
        </p>
        <GooeyText
          texts={details.map((item) => item.label)}
          className="mt-3 h-32 rounded-[1.5rem] bg-charcoal/[0.035] px-5 sm:h-36"
          textClassName="text-[2.05rem] sm:text-[2.65rem] md:text-[3rem]"
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {details.map((item, index) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: index * 0.08,
                  duration: 0.55,
                  ease: [0.32, 0.72, 0, 1]
                }}
                whileHover={{ y: -3 }}
                className="group rounded-[1.35rem] bg-charcoal/[0.045] p-5 transition-colors duration-500 ease-heavy hover:bg-charcoal"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-charcoal text-bone transition-colors duration-500 ease-heavy group-hover:bg-bone group-hover:text-charcoal">
                  <Icon className="h-4 w-4" />
                </div>
                <h2 className="mt-7 text-2xl font-semibold tracking-tight text-charcoal transition-colors duration-500 ease-heavy group-hover:text-bone">
                  {item.label}
                </h2>
                <p className="mt-2 text-sm font-medium text-charcoal/58 transition-colors duration-500 ease-heavy group-hover:text-bone/62">
                  {item.description}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
