"use client";

import { useEffect, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import { motion, type Variants, useMotionValue } from "framer-motion";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Direction = "left" | "right";

type GalleryPhoto = {
  id: number;
  src: StaticImageData;
  alt: string;
  direction: Direction;
};

const positions = {
  desktop: [
    { x: "-320px", y: "15px", zIndex: 50 },
    { x: "-160px", y: "32px", zIndex: 40 },
    { x: "0px", y: "8px", zIndex: 30 },
    { x: "160px", y: "22px", zIndex: 20 },
    { x: "320px", y: "44px", zIndex: 10 }
  ]
};

export function PhotoGallery({
  photos,
  animationDelay = 0.2
}: {
  photos: GalleryPhoto[];
  animationDelay?: number;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const visibilityTimer = setTimeout(() => setIsVisible(true), animationDelay * 1000);
    const animationTimer = setTimeout(() => setIsLoaded(true), (animationDelay + 0.35) * 1000);

    return () => {
      clearTimeout(visibilityTimer);
      clearTimeout(animationTimer);
    };
  }, [animationDelay]);

  const mobilePhotos = photos.slice(0, 5);
  const activePhotos = mobilePhotos.map((photo, index) => ({
    ...photo,
    order: index,
    ...positions.desktop[index]
  }));

  const containerVariants: Variants = {
    hidden: { opacity: 1 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.1
      }
    }
  };

  const photoVariants: Variants = {
    hidden: () => ({
      x: 0,
      y: 0,
      rotate: 0,
      scale: 1
    }),
    visible: (custom: { x: string; y: string; order: number }) => ({
      x: custom.x,
      y: custom.y,
      rotate: 0,
      scale: 1,
      transition: {
        type: "spring" as const,
        stiffness: 70,
        damping: 12,
        mass: 1,
        delay: custom.order * 0.15
      }
    })
  };

  return (
    <div className="relative overflow-hidden py-20 md:py-28">
      <div className="absolute inset-x-0 top-48 -z-10 hidden h-[300px] bg-[linear-gradient(to_right,rgba(17,16,14,0.25)_1px,transparent_1px),linear-gradient(to_bottom,rgba(17,16,14,0.25)_1px,transparent_1px)] bg-[size:3rem_3rem] opacity-20 [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)] md:block" />
      <div className="mx-auto max-w-7xl px-4 text-center md:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-copper">
          Recent cuts
        </p>
        <h2 className="mx-auto mt-4 max-w-3xl text-4xl font-extrabold leading-none tracking-normal text-charcoal md:text-6xl">
          A closer look at the work.
        </h2>
      </div>

      <motion.div
        className="-mx-4 mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain px-4 pb-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:hidden"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: isVisible ? 1 : 0, y: isVisible ? 0 : 12 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        {mobilePhotos.map((photo) => (
          <div key={photo.id} className="snap-center first:pl-2 last:pr-2">
            <Photo
              width={250}
              height={250}
              src={photo.src}
              alt={photo.alt}
              direction={photo.direction}
              rotationSeed={photo.id}
              interactive={false}
            />
          </div>
        ))}
      </motion.div>

      <div className="relative mb-8 mt-12 hidden h-[350px] w-full items-center justify-center md:block lg:flex">
        <motion.div
          className="relative mx-auto flex w-full max-w-7xl justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: isVisible ? 1 : 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <motion.div
            className="relative flex w-full justify-center"
            variants={containerVariants}
            initial="hidden"
            animate={isLoaded ? "visible" : "hidden"}
          >
            <div className="relative h-[220px] w-[220px]">
              {[...activePhotos].reverse().map((photo) => (
                <motion.div
                  key={photo.id}
                  className="absolute left-0 top-0"
                  style={{ zIndex: photo.zIndex }}
                  variants={photoVariants}
                  custom={{
                    x: photo.x,
                    y: photo.y,
                    order: photo.order
                  }}
                >
                  <Photo
                    width={220}
                    height={220}
                    src={photo.src}
                    alt={photo.alt}
                    direction={photo.direction}
                    rotationSeed={photo.id}
                  />
                </motion.div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      </div>

      <div className="flex w-full justify-center">
        <Button asChild variant="outline">
          <a href="https://www.instagram.com/draaqutz" target="_blank" rel="noreferrer">
            View more on Instagram
          </a>
        </Button>
      </div>
    </div>
  );
}

export function Photo({
  src,
  alt,
  className,
  direction,
  rotationSeed,
  width,
  height,
  interactive = true,
  ...props
}: {
  src: StaticImageData;
  alt: string;
  className?: string;
  direction?: Direction;
  rotationSeed: number;
  width: number;
  height: number;
  interactive?: boolean;
}) {
  const rotation = (1 + (rotationSeed % 3)) * (direction === "left" ? -1 : 1);
  const x = useMotionValue(200);
  const y = useMotionValue(200);

  function handleMouse(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    x.set(event.clientX - rect.left);
    y.set(event.clientY - rect.top);
  }

  const resetMouse = () => {
    x.set(200);
    y.set(200);
  };

  return (
    <motion.div
      drag={interactive}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      whileTap={interactive ? { scale: 1.16, zIndex: 9999 } : { scale: 0.98 }}
      whileHover={
        interactive
          ? {
              scale: 1.08,
              rotateZ: 2 * (direction === "left" ? -1 : 1),
              zIndex: 9999
            }
          : undefined
      }
      whileDrag={
        interactive
          ? {
              scale: 1.08,
              zIndex: 9999
            }
          : undefined
      }
      initial={{ rotate: 0 }}
      animate={{ rotate: rotation }}
      style={{
        width,
        height,
        perspective: 400,
        zIndex: 1,
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
        touchAction: interactive ? "none" : "pan-x"
      }}
      className={cn(
        className,
        "relative mx-auto shrink-0",
        interactive ? "cursor-grab active:cursor-grabbing" : "cursor-default"
      )}
      onMouseMove={handleMouse}
      onMouseLeave={resetMouse}
      draggable={false}
      tabIndex={0}
    >
      <div className="relative h-full w-full overflow-hidden rounded-3xl border border-white/70 bg-paper shadow-[0_24px_60px_-32px_rgba(17,16,14,0.55)]">
        <Image
          className="rounded-3xl object-cover"
          fill
          src={src}
          alt={alt}
          sizes={`${width}px`}
          {...props}
          draggable={false}
        />
      </div>
    </motion.div>
  );
}
