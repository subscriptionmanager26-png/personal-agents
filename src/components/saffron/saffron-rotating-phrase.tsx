"use client";

import { useEffect, useState } from "react";

const WORDS = ["hire", "train", "onboard", "deploy", "scale", "operate"];

export function SaffronRotatingPhrase() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = window.setInterval(() => {
      setVisible(false);
      window.setTimeout(() => {
        setIndex((i) => (i + 1) % WORDS.length);
        setVisible(true);
      }, 180);
    }, 2400);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span
      className="inline-block min-w-[8ch] transition-opacity duration-150"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {WORDS[index]}
    </span>
  );
}
