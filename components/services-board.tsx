"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

type Service = {
  category: string;
  name: string;
  price: string;
};

const categories = ["Haircuts", "Color services", "Housecall services"];
const accents = ["bg-copper", "bg-charcoal", "bg-[#587568]"];

function ServiceCard({
  service,
  index
}: {
  service: Service;
  index: number;
}) {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [5, -5]), {
    damping: 18,
    stiffness: 140
  });
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-5, 5]), {
    damping: 18,
    stiffness: 140
  });
  const accent = accents[index % accents.length];

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ delay: index * 0.06, duration: 0.45 }}
      style={{ rotateX, rotateY, perspective: 900 }}
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        mouseX.set((event.clientX - (rect.x + rect.width / 2)) / rect.width);
        mouseY.set((event.clientY - (rect.y + rect.height / 2)) / rect.height);
      }}
      onMouseLeave={() => {
        mouseX.set(0);
        mouseY.set(0);
      }}
      className="relative rounded-xl border-[3px] border-charcoal bg-paper p-5 shadow-[6px_6px_0_0_rgba(17,16,14,0.95)] transition-shadow duration-300 hover:shadow-[8px_8px_0_0_rgba(17,16,14,0.95)]"
    >
      <motion.div
        className={`absolute -right-4 -top-4 flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-charcoal ${accent} text-bone shadow-[3px_3px_0_0_rgba(17,16,14,0.95)]`}
        animate={{
          rotate: [0, 8, 0, -8, 0],
          y: [0, -4, 3, 0]
        }}
        transition={{ duration: 5, repeat: Infinity, ease: [0.76, 0, 0.24, 1] }}
      >
        <span className="text-sm font-black">{service.price}</span>
      </motion.div>
      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-charcoal/45">
        {service.category}
      </p>
      <h3 className="mt-4 max-w-[12rem] text-2xl font-black leading-none tracking-tight text-charcoal">
        {service.name}
      </h3>
    </motion.div>
  );
}

export function ServicesBoard({ services }: { services: Service[] }) {
  return (
    <div className="relative overflow-hidden rounded-[1.75rem] bg-[#f0f0f0] p-4 shadow-[inset_0_0_0_1px_rgba(17,16,14,0.08)] md:p-6">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(rgba(17,16,14,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(17,16,14,0.08) 1px, transparent 1px)",
          backgroundSize: "18px 18px"
        }}
      />
      <div className="relative">
        <div className="mb-5 flex flex-wrap gap-2">
          {categories.map((category) => (
            <span
              key={category}
              className="rounded-full border-2 border-charcoal bg-paper px-3 py-1 text-xs font-black uppercase tracking-[0.12em] shadow-[2px_2px_0_0_rgba(17,16,14,0.95)]"
            >
              {category}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {services.map((service, index) => (
            <ServiceCard key={`${service.category}-${service.name}`} service={service} index={index} />
          ))}
        </div>
        <p className="mt-5 rounded-xl border-[3px] border-charcoal bg-charcoal px-4 py-3 text-sm font-semibold leading-6 text-bone shadow-[4px_4px_0_0_rgba(17,16,14,0.95)]">
          Housecall prices are travel fees. Haircuts are charged separately, with an additional $10 haircut fee for non-east-side housecalls. Final pricing may vary by location.
        </p>
      </div>
    </div>
  );
}
