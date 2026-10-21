"use client";

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SaffronChrome({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <header
        className={cn(
          "fixed top-0 z-40 flex w-full items-center justify-between px-6 py-5 transition-[background-color,backdrop-filter,border-color] duration-500 md:px-10",
          scrolled
            ? "border-b border-white/[0.08] bg-black/60 backdrop-blur-xl"
            : "border-b border-transparent bg-transparent",
        )}
      >
        <a href="/saffron" className="text-[11px] font-medium tracking-[0.45em] text-white/90 uppercase">
          SaffronAI
        </a>
        <nav className="hidden items-center gap-8 text-[11px] tracking-[0.18em] text-white/40 uppercase md:flex">
          <a href="#story" className="transition-colors hover:text-white">Story</a>
          <a href="#work" className="transition-colors hover:text-white">Work</a>
          <a href="#contact" className="transition-colors hover:text-white">Contact</a>
        </nav>
        <a
          href="mailto:hello@saffronai.in"
          className="text-[11px] tracking-[0.2em] text-white/50 uppercase transition-colors hover:text-white"
        >
          Email
        </a>
      </header>
      {children}
    </>
  );
}
