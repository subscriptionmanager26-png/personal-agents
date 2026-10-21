"use client";

type VaultMonolithProps = {
  className?: string;
};

/** Foundation-inspired cut monolith frame (gold geometry on void). */
export function VaultMonolith({ className }: VaultMonolithProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 400 520"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="gold-edge" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f0d78a" />
          <stop offset="45%" stopColor="#c9a227" />
          <stop offset="100%" stopColor="#8a6b1f" />
        </linearGradient>
        <linearGradient id="slate-fill" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="rgba(18, 24, 36, 0.92)" />
          <stop offset="100%" stopColor="rgba(6, 8, 14, 0.96)" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path
        d="M200 24 L356 120 L356 400 L200 496 L44 400 L44 120 Z"
        stroke="url(#gold-edge)"
        strokeWidth="1.5"
        fill="url(#slate-fill)"
        filter="url(#glow)"
      />
      <path
        d="M200 72 L308 140 L308 360 L200 428 L92 360 L92 140 Z"
        stroke="rgba(212, 175, 95, 0.35)"
        strokeWidth="1"
        fill="none"
      />
      <path
        d="M200 120 L260 160 L260 340 L200 380 L140 340 L140 160 Z"
        stroke="rgba(212, 175, 95, 0.55)"
        strokeWidth="1.2"
        fill="none"
      />
      <path d="M200 120 L260 160 M260 340 L200 380 M200 380 L140 340 M140 160 L200 120" stroke="rgba(201, 162, 39, 0.25)" />
      <line x1="200" y1="24" x2="200" y2="120" stroke="rgba(240, 215, 138, 0.4)" strokeWidth="0.75" />
      <line x1="200" y1="380" x2="200" y2="496" stroke="rgba(240, 215, 138, 0.25)" strokeWidth="0.75" />
      <circle cx="200" cy="250" r="36" stroke="url(#gold-edge)" strokeWidth="1" fill="rgba(0,0,0,0.55)" />
      <circle cx="200" cy="250" r="52" stroke="rgba(212, 175, 95, 0.2)" strokeWidth="0.75" fill="none" />
      <circle cx="200" cy="250" r="68" stroke="rgba(130, 180, 255, 0.12)" strokeWidth="0.5" fill="none" />
    </svg>
  );
}
