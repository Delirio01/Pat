"use client";

import { useEffect, useRef } from "react";

type Particle = {
  // current position in 3D (world space)
  x: number;
  y: number;
  z: number;
  // velocity in 3D
  vx: number;
  vy: number;
  vz: number;
  // target direction on the sphere (unit vector)
  nx: number;
  ny: number;
  nz: number;
  // personal oscillators for "alive" motion
  phase: number;
  driftPhase: number;
  driftAmp: number;
  hue: number;
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randomUnitVector() {
  // Uniform sampling on sphere surface
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  const z = 2 * v - 1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: r * Math.cos(theta), y: r * Math.sin(theta), z };
}

function createParticle(baseRadius: number) {
  const n = randomUnitVector();
  const radius = baseRadius + rand(-10, 10);
  return {
    x: n.x * radius,
    y: n.y * radius,
    z: n.z * radius,
    vx: rand(-0.15, 0.15),
    vy: rand(-0.15, 0.15),
    vz: rand(-0.15, 0.15),
    nx: n.x,
    ny: n.y,
    nz: n.z,
    phase: rand(0, Math.PI * 2),
    driftPhase: rand(0, Math.PI * 2),
    driftAmp: rand(6, 22),
    hue: rand(185, 220),
  } satisfies Particle;
}

export default function GalaxyBackground({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    let particles: Particle[] = [];
    let raf = 0;
    let last = performance.now();
    let pointer = { x: 0, y: 0, active: false };

    const resize = () => {
      const dpr = clampNumber(window.devicePixelRatio || 1, 1, 2);
      const w = Math.max(1, Math.floor(window.innerWidth));
      const h = Math.max(1, Math.floor(window.innerHeight));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const target = clampNumber(Math.floor((w * h) / 6800), 240, 900);
      const baseRadius = clampNumber(Math.min(w, h) * 0.22, 120, 240);
      particles = Array.from({ length: target }, () => createParticle(baseRadius));
    };

    resize();

    const draw = (t: number) => {
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      const cx = w / 2;
      const cy = h / 2;

      const dt = clampNumber((t - last) / 16.67, 0.25, 2.0);
      last = t;

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      const baseRadius = clampNumber(Math.min(w, h) * 0.22, 120, 240);
      const breathe = 1 + 0.055 * Math.sin(t * 0.00065);
      const surfaceWave = 0.04 * Math.sin(t * 0.00115);

      // gentle rotation + subtle pointer parallax
      const rotY = t * 0.00026 + (pointer.active ? pointer.x * 0.0014 : 0);
      const rotX = t * 0.00018 + (pointer.active ? pointer.y * 0.0012 : 0);
      const cosy = Math.cos(rotY);
      const siny = Math.sin(rotY);
      const cosx = Math.cos(rotX);
      const sinx = Math.sin(rotX);

      const focal = 720;
      const alivePull = reduceMotion ? 0.10 : 0.16;
      const damping = reduceMotion ? 0.86 : 0.84;
      const maxSpeed = reduceMotion ? 2.2 : 3.2;
      const wanderScale = reduceMotion ? 0.35 : 0.75;

      for (const p of particles) {
        // individual "alive" offsets: wander away then return
        p.phase += 0.014 * dt;
        p.driftPhase += 0.008 * dt;

        const s0 = Math.sin(p.driftPhase);
        const s1 = Math.sin(p.driftPhase * 0.93 + 1.7);
        const s2 = Math.sin(p.driftPhase * 1.08 + 3.2);

        const drift = p.driftAmp * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(p.phase)));
        const wx = drift * s0 * wanderScale;
        const wy = drift * s1 * wanderScale;
        const wz = drift * s2 * wanderScale;

        // target point on a breathing, rippling sphere
        const ripple =
          1 +
          0.06 * Math.sin(p.phase + p.nx * 2.3 + p.ny * 1.7 + p.nz * 2.9) +
          surfaceWave * Math.sin(p.phase * 1.6 + p.nx * 3.2 - p.nz * 2.2);
        const targetR = baseRadius * breathe * ripple;

        const tx = p.nx * targetR + wx;
        const ty = p.ny * targetR + wy;
        const tz = p.nz * targetR + wz;

        // spring towards target
        const ax = (tx - p.x) * alivePull;
        const ay = (ty - p.y) * alivePull;
        const az = (tz - p.z) * alivePull;

        p.vx = (p.vx + ax) * damping;
        p.vy = (p.vy + ay) * damping;
        p.vz = (p.vz + az) * damping;

        // cap speed so it feels organic
        p.vx = clampNumber(p.vx, -maxSpeed, maxSpeed);
        p.vy = clampNumber(p.vy, -maxSpeed, maxSpeed);
        p.vz = clampNumber(p.vz, -maxSpeed, maxSpeed);

        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;

        // very slow hue drift
        p.hue += 0.012 * dt;
        if (p.hue > 240) p.hue = 185;

        // rotate sphere in 3D (x then y)
        const x1 = p.x;
        const y1 = p.y * cosx - p.z * sinx;
        const z1 = p.y * sinx + p.z * cosx;
        const x2 = x1 * cosy + z1 * siny;
        const y2 = y1;
        const z2 = -x1 * siny + z1 * cosy;

        // project
        const zCam = z2 + baseRadius * 2.2;
        const scale = focal / (focal + zCam);
        const sx = cx + x2 * scale;
        const sy = cy + y2 * scale;
        if (sx < -80 || sx > w + 80 || sy < -80 || sy > h + 80) continue;

        const depthAlpha = clampNumber(scale * 0.9, 0.18, 0.95);
        const twinkle = 0.72 + 0.28 * Math.sin(p.phase * 1.9);
        const a = clampNumber(0.04 + 0.18 * depthAlpha, 0.04, 0.22) * twinkle;
        const r = clampNumber(0.7 + 2.7 * depthAlpha, 0.7, 3.0);

        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 4.4);
        g.addColorStop(0, `hsla(${p.hue}, 92%, 72%, ${a})`);
        g.addColorStop(0.22, `hsla(${p.hue}, 92%, 62%, ${a * 0.55})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 4.4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = "source-over";
      const vignette = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.6);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(0.75, "rgba(0,0,0,0.22)");
      vignette.addColorStop(1, "rgba(0,0,0,0.70)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);

      if (!reduceMotion) raf = window.requestAnimationFrame(draw);
    };

    raf = window.requestAnimationFrame(draw);

    const onResize = () => resize();
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        window.cancelAnimationFrame(raf);
        raf = 0;
      } else if (!reduceMotion && raf === 0) {
        last = performance.now();
        raf = window.requestAnimationFrame(draw);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      const nx = (e.clientX / w) * 2 - 1;
      const ny = (e.clientY / h) * 2 - 1;
      pointer = { x: clampNumber(nx, -1, 1), y: clampNumber(ny, -1, 1), active: true };
    };
    const onPointerLeave = () => {
      pointer = { x: 0, y: 0, active: false };
    };

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);

    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [enabled]);

  if (!enabled) return null;

  return <canvas ref={canvasRef} className="jarvis-galaxy-canvas" aria-hidden="true" />;
}
