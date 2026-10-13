"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionClass() {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition || w.webkitSpeechRecognition) as (new () => Recognition) | undefined;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it in the browser's site settings.",
  "service-not-allowed": "Voice input is not available in this browser.",
  "audio-capture": "No microphone found.",
  network: "Voice input needs a connection to the browser's speech service.",
};

const subscribe = () => () => {};

/** Browser speech-to-text. Final phrases go to `onFinal`; `interim` is the phrase still being spoken. */
export function useDictation(onFinal: (text: string) => void) {
  const supported = useSyncExternalStore(subscribe, () => Boolean(recognitionClass()), () => false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string>();
  const recognition = useRef<Recognition | null>(null);
  const onFinalRef = useRef(onFinal);

  useEffect(() => {
    onFinalRef.current = onFinal;
  });
  useEffect(() => () => recognition.current?.abort(), []);

  const stop = useCallback(() => recognition.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = recognitionClass();
    if (!Ctor || recognition.current) return;
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const result = e.results[i];
        if (result.isFinal) {
          const phrase = result[0].transcript.trim();
          if (phrase) onFinalRef.current(phrase);
        } else {
          live += result[0].transcript;
        }
      }
      setInterim(live.trim());
    };
    r.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") setError(ERRORS[e.error] ?? "Voice input stopped.");
    };
    r.onend = () => {
      recognition.current = null;
      setListening(false);
      setInterim("");
    };
    setError(undefined);
    recognition.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      recognition.current = null;
      setError("Voice input could not start.");
    }
  }, []);

  return { supported, listening, interim, error, start, stop };
}
