"use client";

// Full-screen, scroll-driven cinematic opening.
//
// A fixed overlay fully covers the page while you scroll a tall spacer: the
// vault clip is scrubbed (door opens, camera glides in). In the final stretch
// the overlay zooms "through" the bright vault opening and cross-fades away,
// handing off to the site underneath — so nothing peeks up from below; the
// page emerges from inside the vault. Reduced-motion users get a plain hero.

import { useEffect, useRef, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { KeyRound, ExternalLink } from "lucide-react";

const STAGE = 3; // spacer height in viewport heights → scroll length of the intro

export function VaultHero() {
  const { status: authStatus } = useSession();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [p, setP] = useState(0); // 0 → 1 progress through the intro
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReduced(true);
      video.loop = true;
      video.play().catch(() => {});
      return;
    }

    const progressRef = { current: 0 };
    const onScroll = () => {
      const denom = STAGE * window.innerHeight;
      const prog = Math.min(Math.max(window.scrollY / denom, 0), 1);
      progressRef.current = prog;
      setP(prog);
    };

    let raf = 0;
    const tick = () => {
      const d = video.duration;
      if (d && !Number.isNaN(d)) {
        // Vault is fully open by 85% of the scroll; the last 15% is the zoom-through.
        const target = Math.min(progressRef.current / 0.85, 1) * (d - 0.05);
        const cur = video.currentTime;
        if (Math.abs(target - cur) > 0.01) {
          try {
            video.currentTime = cur + (target - cur) * 0.15;
          } catch {
            /* seeking before metadata is ready */
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      onScroll();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };

    video.pause();
    if (video.readyState >= 1) start();
    else video.addEventListener("loadedmetadata", start, { once: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // ── Reduced-motion / no-scrub fallback: a normal framed hero ────────────
  if (reduced) {
    return (
      <section className="relative pt-28 pb-20">
        <div className="section-container grid lg:grid-cols-[1fr_420px] gap-14 items-center">
          <div className="max-w-2xl">
            <HeroCopy authStatus={authStatus} dark />
          </div>
          <div className="rounded-3xl border border-ls-gray-200 dark:border-ls-gray-800 overflow-hidden">
            <video ref={videoRef} src="/vault-hero.mp4" muted loop playsInline autoPlay className="w-full h-auto block" />
          </div>
        </div>
      </section>
    );
  }

  // Overlay copy fades/lifts over the first half; the whole overlay zooms and
  // fades in the last 15% (the "through the vault" hand-off).
  const copyOpacity = Math.max(0, 1 - p / 0.5);
  const copyLift = -p * 70;
  const hintOpacity = Math.max(0, 1 - p / 0.08);
  const handoff = Math.max(0, (p - 0.85) / 0.15); // 0 → 1 over the last stretch
  const overlayOpacity = 1 - handoff;
  const scale = 1 + handoff * 0.35;

  return (
    <>
      {/* Scroll spacer — gives the intro its scroll length. */}
      <div style={{ height: `${STAGE * 100}vh` }} aria-hidden />

      {/* Fixed full-screen overlay (above the navbar) so nothing peeks through. */}
      <div
        className="fixed inset-0 z-[60] overflow-hidden bg-[#fafafa] dark:bg-[#0d0d0d]"
        style={{ opacity: overlayOpacity, pointerEvents: p > 0.99 ? "none" : "auto" }}
        aria-label="Aegis — whitehat rescue for leaked keys"
      >
        <video
          ref={videoRef}
          src="/vault-hero.mp4"
          muted
          playsInline
          preload="auto"
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: `scale(${scale})`, transformOrigin: "50% 46%" }}
        />
        {/* Vignette keeps the glowing type legible over any frame. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(120% 90% at 50% 44%, rgba(0,0,0,0.44) 0%, rgba(0,0,0,0.14) 46%, rgba(0,0,0,0) 74%)" }}
          aria-hidden
        />

        <div className="absolute inset-0 flex items-center justify-center px-6">
          <div
            className="max-w-3xl text-center"
            style={{ opacity: copyOpacity, transform: `translateY(${copyLift}px)`, willChange: "opacity, transform" }}
          >
            <HeroCopy authStatus={authStatus} />
          </div>
        </div>

        {/* Scroll hint */}
        <div
          className="absolute bottom-8 left-1/2 -translate-x-1/2 text-center pointer-events-none"
          style={{ opacity: hintOpacity }}
          aria-hidden
        >
          <p className="text-[11px] uppercase tracking-[0.3em] text-white/80 mb-2">Scroll to open the vault</p>
          <span className="inline-block w-5 h-8 rounded-full border border-white/50 relative">
            <span className="absolute left-1/2 top-1.5 -translate-x-1/2 w-1 h-1.5 rounded-full bg-white/80 animate-bounce" />
          </span>
        </div>
      </div>
    </>
  );
}

function HeroCopy({ authStatus, dark = false }: { authStatus: string; dark?: boolean }) {
  // `dark` = rendered on the light page (reduced-motion fallback) → use ink text.
  const title = dark ? "text-black dark:text-white" : "text-white";
  const sub = dark ? "text-ls-gray-500 dark:text-ls-gray-400" : "text-white/85";
  const glow = dark ? undefined : { textShadow: "0 2px 40px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.5)" };
  const subGlow = dark ? undefined : { textShadow: "0 1px 20px rgba(0,0,0,0.6)" };

  return (
    <>
      <div
        className={`inline-flex items-center gap-2 mb-7 px-3 py-1 rounded-full border ${
          dark ? "border-ls-gray-200 dark:border-ls-gray-800" : "border-white/25 bg-white/10 backdrop-blur-sm"
        }`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        <span className={`text-[11px] font-semibold uppercase tracking-widest ${dark ? "text-ls-gray-600 dark:text-ls-gray-300" : "text-white/90"}`}>
          STRK20 Private Sprint
        </span>
      </div>

      <h1 className={`font-display text-5xl sm:text-6xl lg:text-7xl font-semibold ${title} leading-[0.95] tracking-tight mb-6`} style={glow}>
        Whitehat rescue for{" "}
        <span className="font-serif font-normal italic tracking-tight">leaked keys</span>
      </h1>

      <p className={`text-lg ${sub} leading-relaxed mb-9 max-w-xl mx-auto`} style={subGlow}>
        Aegis sweeps accidentally leaked keys into the STRK20 shielded vault
        before an attacker can — and returns them once you prove the repo is yours.
      </p>

      <div className={`flex flex-wrap items-center gap-4 ${dark ? "" : "justify-center"}`}>
        {authStatus === "authenticated" ? (
          <a href="#claim" className="btn-primary text-base px-8 py-3.5">
            <KeyRound size={16} /> Check your claim
          </a>
        ) : (
          <button
            onClick={() => signIn("github")}
            disabled={authStatus === "loading"}
            className="btn-primary text-base px-8 py-3.5 disabled:opacity-50"
          >
            <KeyRound size={16} /> Connect GitHub
          </button>
        )}
        <a
          href="#live"
          className={
            dark
              ? "btn-ghost text-base px-8 py-3.5"
              : "text-base px-8 py-3.5 rounded-2xl border border-white/40 text-white hover:bg-white/10 transition-colors font-medium"
          }
        >
          See it live →
        </a>
        <a
          href="https://github.com/justbiar/aegis"
          target="_blank"
          rel="noreferrer"
          className={`text-sm inline-flex items-center gap-1.5 transition-colors ${
            dark ? "text-ls-gray-500 hover:text-black dark:hover:text-white" : "text-white/70 hover:text-white"
          }`}
        >
          <ExternalLink size={15} /> View source
        </a>
      </div>
    </>
  );
}
