"use client";

import { List, Scissors, X } from "@phosphor-icons/react";
import { useState } from "react";

const links = [
  { href: "#services", label: "Services" },
  { href: "#work", label: "Cuts" },
  { href: "#loyalty", label: "Loyalty" },
  { href: "#book", label: "Book" }
];

export function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-20 px-4 pt-5">
      <nav className="mx-auto flex max-w-6xl items-center justify-between rounded-full border border-charcoal/10 bg-paper/82 px-4 py-3 shadow-[0_18px_50px_-28px_rgba(17,16,14,0.45)] backdrop-blur-xl">
        <a href="#" className="group flex items-center gap-2" aria-label="Draaqutz home">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-charcoal text-bone transition-transform duration-500 ease-heavy group-hover:rotate-[-8deg]">
            <Scissors size={18} weight="light" />
          </span>
          <span className="text-sm font-semibold uppercase tracking-[0.22em] text-charcoal">
            Draaqutz
          </span>
        </a>

        <div className="hidden items-center gap-7 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-charcoal/68 transition-colors duration-500 ease-heavy hover:text-charcoal"
            >
              {link.label}
            </a>
          ))}
        </div>

        <a
          href="#book"
          className="hidden rounded-full bg-charcoal px-5 py-2.5 text-sm font-medium text-bone transition-transform duration-500 ease-heavy active:scale-[0.98] md:inline-flex"
        >
          Book on Telegram
        </a>

        <button
          type="button"
          aria-label="Toggle navigation"
          onClick={() => setOpen((value) => !value)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-charcoal text-bone transition-transform duration-500 ease-heavy active:scale-[0.96] md:hidden"
        >
          {open ? <X size={19} weight="light" /> : <List size={21} weight="light" />}
        </button>
      </nav>

      {open ? (
        <div className="mx-auto mt-3 max-w-6xl rounded-[1.75rem] border border-charcoal/10 bg-paper/95 p-3 shadow-[0_22px_70px_-36px_rgba(17,16,14,0.55)] backdrop-blur-xl md:hidden">
          {links.map((link, index) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block rounded-full px-4 py-3 text-base font-medium text-charcoal transition-all duration-500 ease-heavy hover:bg-charcoal hover:text-bone"
              style={{ animationDelay: `${index * 70}ms` }}
            >
              {link.label}
            </a>
          ))}
        </div>
      ) : null}
    </header>
  );
}
