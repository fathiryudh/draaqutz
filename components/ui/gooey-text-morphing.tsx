"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface GooeyTextProps {
  texts: string[];
  morphTime?: number;
  cooldownTime?: number;
  className?: string;
  textClassName?: string;
}

export function GooeyText({
  texts,
  morphTime = 0.85,
  cooldownTime = 0.8,
  className,
  textClassName
}: GooeyTextProps) {
  const text1Ref = React.useRef<HTMLSpanElement>(null);
  const text2Ref = React.useRef<HTMLSpanElement>(null);
  const filterId = React.useId().replace(/:/g, "");

  React.useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion || texts.length <= 1) {
      if (text1Ref.current) {
        text1Ref.current.textContent = texts[0] ?? "";
        text1Ref.current.style.opacity = "100%";
      }
      if (text2Ref.current) {
        text2Ref.current.textContent = "";
        text2Ref.current.style.opacity = "0%";
      }
      return;
    }

    let animationFrame = 0;
    let textIndex = texts.length - 1;
    let time = new Date();
    let morph = 0;
    let cooldown = cooldownTime;

    const setMorph = (fraction: number) => {
      if (!text1Ref.current || !text2Ref.current) return;

      const nextFraction = Math.max(fraction, 0.001);
      text2Ref.current.style.filter = `blur(${Math.min(7 / nextFraction - 7, 80)}px)`;
      text2Ref.current.style.opacity = `${Math.pow(nextFraction, 0.4) * 100}%`;

      const previousFraction = Math.max(1 - nextFraction, 0.001);
      text1Ref.current.style.filter = `blur(${Math.min(7 / previousFraction - 7, 80)}px)`;
      text1Ref.current.style.opacity = `${Math.pow(previousFraction, 0.4) * 100}%`;
    };

    const doCooldown = () => {
      morph = 0;
      if (!text1Ref.current || !text2Ref.current) return;
      text2Ref.current.style.filter = "";
      text2Ref.current.style.opacity = "100%";
      text1Ref.current.style.filter = "";
      text1Ref.current.style.opacity = "0%";
    };

    const doMorph = () => {
      morph -= cooldown;
      cooldown = 0;
      let fraction = morph / morphTime;

      if (fraction > 1) {
        cooldown = cooldownTime;
        fraction = 1;
      }

      setMorph(fraction);
    };

    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const newTime = new Date();
      const shouldIncrementIndex = cooldown > 0;
      const dt = (newTime.getTime() - time.getTime()) / 1000;
      time = newTime;
      cooldown -= dt;

      if (cooldown <= 0) {
        if (shouldIncrementIndex) {
          textIndex = (textIndex + 1) % texts.length;
          if (text1Ref.current && text2Ref.current) {
            text1Ref.current.textContent = texts[textIndex % texts.length];
            text2Ref.current.textContent = texts[(textIndex + 1) % texts.length];
          }
        }
        doMorph();
      } else {
        doCooldown();
      }
    };

    if (text1Ref.current && text2Ref.current) {
      text1Ref.current.textContent = texts[0] ?? "";
      text2Ref.current.textContent = texts[1] ?? texts[0] ?? "";
    }

    animate();

    return () => cancelAnimationFrame(animationFrame);
  }, [texts, morphTime, cooldownTime]);

  return (
    <div className={cn("relative", className)} aria-label={texts.join(", ")}>
      <span className="sr-only">{texts.join(", ")}</span>
      <svg className="absolute h-0 w-0" aria-hidden="true" focusable="false">
        <defs>
          <filter id={filterId}>
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 255 -140"
            />
          </filter>
        </defs>
      </svg>

      <div
        className="relative flex h-full min-h-[6rem] items-center justify-center overflow-hidden"
        style={{ filter: `url(#${filterId})` }}
      >
        <span
          ref={text1Ref}
          aria-hidden="true"
          className={cn(
            "absolute inline-block w-full max-w-[min(100%,12ch)] select-none text-balance text-center text-4xl font-black leading-[0.9] tracking-normal text-charcoal sm:text-5xl md:text-6xl",
            textClassName
          )}
        />
        <span
          ref={text2Ref}
          aria-hidden="true"
          className={cn(
            "absolute inline-block w-full max-w-[min(100%,12ch)] select-none text-balance text-center text-4xl font-black leading-[0.9] tracking-normal text-charcoal sm:text-5xl md:text-6xl",
            textClassName
          )}
        />
      </div>
    </div>
  );
}
