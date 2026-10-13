"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps the nearest `[data-scroll-root]` pinned to the bottom as messages arrive or late
 * content (charts, file chips) grows, unless the reader has scrolled up.
 */
export function ScrollAnchor({ version }: { version: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const node = ref.current;
    const scroller = node?.closest<HTMLElement>("[data-scroll-root]");
    const content = node?.parentElement;
    if (!scroller || !content) return;
    const toBottom = () => {
      if (stick.current) scroller.scrollTop = scroller.scrollHeight;
    };
    const onScroll = () => {
      stick.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
    };
    const observer = new ResizeObserver(toBottom);
    observer.observe(content);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
    };
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
