"use client";

import { useEffect, useRef } from "react";

type Star = { x: number; y: number; z: number; phase: number };

function initStars(count: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.35 + Math.random() * 1.4;
    stars.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      z: Math.random(),
      phase: Math.random() * Math.PI * 2,
    });
  }
  return stars;
}

export function SaffronScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let raf = 0;
    const stars = initStars(420);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      const { width, height } = canvas.getBoundingClientRect();
      const cx = width / 2;
      const cy = height / 2;
      const base = Math.min(width, height);
      const t = time * 0.00035;
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 0.85);
      bg.addColorStop(0, "#06070c");
      bg.addColorStop(0.45, "#0a0d14");
      bg.addColorStop(1, "#121a28");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const diskRx = base * 0.34;
      const diskRy = base * 0.09;
      const tilt = 0.55;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);

      for (let ring = 5; ring >= 1; ring--) {
        const alpha = 0.04 + ring * 0.018;
        ctx.beginPath();
        ctx.ellipse(0, 0, diskRx * (1 + ring * 0.06), diskRy * (1 + ring * 0.08), 0, 0, Math.PI * 2);
        const ringGrad = ctx.createLinearGradient(-diskRx, 0, diskRx, 0);
        ringGrad.addColorStop(0, `rgba(255, 210, 140, ${alpha * 1.4})`);
        ringGrad.addColorStop(0.35, `rgba(200, 160, 90, ${alpha})`);
        ringGrad.addColorStop(0.5, `rgba(30, 35, 50, ${alpha * 0.3})`);
        ringGrad.addColorStop(0.65, `rgba(120, 180, 255, ${alpha * 1.1})`);
        ringGrad.addColorStop(1, `rgba(80, 130, 220, ${alpha * 0.5})`);
        ctx.strokeStyle = ringGrad;
        ctx.lineWidth = 1.2 + ring * 0.35;
        ctx.stroke();
      }

      const diskGrad = ctx.createLinearGradient(-diskRx * 1.1, 0, diskRx * 1.1, 0);
      diskGrad.addColorStop(0, "rgba(255, 196, 120, 0.55)");
      diskGrad.addColorStop(0.22, "rgba(212, 175, 95, 0.35)");
      diskGrad.addColorStop(0.48, "rgba(8, 10, 16, 0.02)");
      diskGrad.addColorStop(0.52, "rgba(8, 10, 16, 0.02)");
      diskGrad.addColorStop(0.78, "rgba(100, 165, 255, 0.4)");
      diskGrad.addColorStop(1, "rgba(140, 200, 255, 0.25)");

      ctx.beginPath();
      ctx.ellipse(0, 0, diskRx, diskRy, 0, 0, Math.PI * 2);
      ctx.fillStyle = diskGrad;
      ctx.fill();

      const warpTop = ctx.createRadialGradient(0, -diskRy * 2.2, 0, 0, -diskRy * 1.4, diskRx * 0.55);
      warpTop.addColorStop(0, "rgba(255, 210, 150, 0.35)");
      warpTop.addColorStop(1, "rgba(255, 210, 150, 0)");
      ctx.fillStyle = warpTop;
      ctx.beginPath();
      ctx.ellipse(0, -diskRy * 1.6, diskRx * 0.42, diskRy * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();

      const warpBottom = ctx.createRadialGradient(0, diskRy * 2.2, 0, 0, diskRy * 1.4, diskRx * 0.55);
      warpBottom.addColorStop(0, "rgba(130, 185, 255, 0.28)");
      warpBottom.addColorStop(1, "rgba(130, 185, 255, 0)");
      ctx.fillStyle = warpBottom;
      ctx.beginPath();
      ctx.ellipse(0, diskRy * 1.6, diskRx * 0.38, diskRy * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      const shadowR = base * 0.11;
      const shadow = ctx.createRadialGradient(cx, cy, shadowR * 0.2, cx, cy, shadowR * 1.35);
      shadow.addColorStop(0, "#000000");
      shadow.addColorStop(0.55, "#020308");
      shadow.addColorStop(0.85, "rgba(6, 8, 14, 0.85)");
      shadow.addColorStop(1, "rgba(6, 8, 14, 0)");
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.arc(cx, cy, shadowR * 1.35, 0, Math.PI * 2);
      ctx.fill();

      for (let i = 0; i < 4; i++) {
        const r = shadowR * (1.12 + i * 0.045);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(212, 175, 95, ${0.22 - i * 0.045})`;
        ctx.lineWidth = 1.1 - i * 0.15;
        ctx.stroke();
      }

      for (const star of stars) {
        const lens = 1 / (0.15 + Math.hypot(star.x, star.y) * 0.9);
        const sx = cx + star.x * base * 0.42 * lens;
        const sy = cy + star.y * base * 0.42 * lens;
        const twinkle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 3 + star.phase));
        const size = (0.4 + star.z * 1.2) * twinkle;
        ctx.fillStyle = `rgba(220, 230, 255, ${0.15 + star.z * 0.55})`;
        ctx.fillRect(sx, sy, size, size);
      }

      const bloom = ctx.createRadialGradient(cx, cy, shadowR, cx, cy, base * 0.5);
      bloom.addColorStop(0, "rgba(212, 175, 95, 0.08)");
      bloom.addColorStop(0.35, "rgba(90, 130, 200, 0.04)");
      bloom.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, width, height);

      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    />
  );
}
