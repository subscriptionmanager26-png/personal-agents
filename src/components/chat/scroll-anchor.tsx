"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps the nearest `[data-scroll-root]` pinned to the bottom when `version` changes,
 * unless the reader has scrolled up to look at older messages.
 */
export function ScrollAnchor({ version }: { version: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>("[data-scroll-root]");
    if (!scroller) return;
    const onScroll = () => {
      stick.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!stick.current) return;
    const frame = requestAnimationFrame(() => {
      const scroller = ref.current?.closest<HTMLElement>("[data-scroll-root]");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [version]);

  return <div ref={ref} aria-hidden />;
}
