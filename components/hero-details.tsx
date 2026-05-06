"use client";

import { GooeyText } from "@/components/ui/gooey-text-morphing";

const quickDetails = ["Easy Booking", "Fades for $15", "House Calls", "Pop-Ups", "Free Styling"];

export function HeroDetails() {
  return (
    <div className="w-full min-w-0 max-w-full rounded-[2rem] border border-charcoal/10 bg-charcoal/[0.045] p-1.5">
      <div className="rounded-[calc(2rem-0.375rem)] border border-white/45 bg-paper p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.85)] md:p-6">
        <GooeyText
          texts={quickDetails}
          className="mt-3 h-48 w-full min-w-0 rounded-[1.5rem] bg-charcoal/[0.035] px-4 sm:h-56 sm:px-5 md:h-[19rem]"
          textClassName="text-[2rem] font-black min-[360px]:text-[2.2rem] sm:text-[3.2rem] md:text-[4.35rem]"
        />
      </div>
    </div>
  );
}
