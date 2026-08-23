"use client";

// Full-screen, scroll-driven cinematic opening. The vault clip is scrubbed by
// scroll position — scrolling "opens" the vault and glides the camera inside,
// then the bright interior hands off seamlessly to the light page below.
// Falls back to a plain autoplay loop when the user prefers reduced motion.

import { useEffect, useRef, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { KeyRound, ExternalLink } from "lucide-react";

export function VaultHero() {
  const { status: authStatus } = useSession();
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [p, setP] = useState(0); // 0 → 1 scroll progress through the stage

  useEffect(() => {
    const wrap = wrapRef.current;
    const video = videoRef.current;
    if (!wrap || !video) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      video.loop = true;
      video.play().catch(() => {});
      return;
    }

    const progressRef = { current: 0 };
    const onScroll = () => {
      const total = wrap.offsetHeight - window.innerHeight;
      const scrolled = Math.min(Math.max(-wrap.getBoundingClientRect().top, 0), Math.max(1, total));
      const prog = total > 0 ? scrolled / total : 0;
      progressRef.current = prog;
      setP(prog);
    };

    let raf = 0;
    const tick = () => {
      const d = video.duration;
      if (d && !Number.isNaN(d)) {
        const target = progressRef.current * (d - 0.05);
        const cur = video.currentTime;
        const next = cur + (target - cur) * 0.15; // eased seek → smooth scrub
        if (Math.abs(target - cur) > 0.01) {
          try {
            video.currentTime = next;
          } catch {
            /* seeking may throw before metadata is ready */
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

  // Overlay copy fades and lifts as the camera enters the vault.
  const copyOpacity = Math.max(0, 1 - p / 0.55);
  const copyLift = -p * 60;
  const hintOpacity = Math.max(0, 1 - p / 0.08);

  return (
    <section ref={wrapRef} className="relative h-[300vh]" aria-label="Aegis — whitehat rescue for leaked keys">
      <div className="sticky top-0 h-screen w-full overflow-hidden bg-[#fafafa] dark:bg-[#0d0d0d]">
        <video
          ref={videoRef}
          src="/vault-hero.mp4"
          muted
          playsInline
          preload="auto"
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Soft vignette so the white glowing type stays legible over any frame. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(120% 90% at 50% 42%, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.12) 45%, rgba(0,0,0,0) 72%)" }}
          aria-hidden
        />

        {/* Overlay copy */}
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <div
            className="max-w-3xl text-center"
            style={{ opacity: copyOpacity, transform: `translateY(${copyLift}px)`, willChange: "opacity, transform" }}
          >
            <div className="inline-flex items-center gap-2 mb-7 px-3 py-1 rounded-full border border-white/25 bg-white/10 backdrop-blur-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[11px] font-semibold uppercase tracking-widest text-white/90">STRK20 Private Sprint</span>
            </div>

            <h1
              className="font-display text-5xl sm:text-6xl lg:text-7xl font-semibold text-white leading-[0.95] tracking-tight mb-6"
              style={{ textShadow: "0 2px 40px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.5)" }}
            >
              Whitehat rescue for{" "}
              <span className="font-serif font-normal italic tracking-tight text-white">leaked keys</span>
            </h1>

            <p
              className="text-lg text-white/85 leading-relaxed mb-9 max-w-xl mx-auto"
              style={{ textShadow: "0 1px 20px rgba(0,0,0,0.6)" }}
            >
              Aegis sweeps accidentally leaked keys into the STRK20 shielded vault
              before an attacker can — and returns them once you prove the repo is yours.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-4">
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
                className="text-base px-8 py-3.5 rounded-2xl border border-white/40 text-white hover:bg-white/10 transition-colors font-medium"
              >
                See it live →
              </a>
              <a
                href="https://github.com/justbiar/aegis"
                target="_blank"
                rel="noreferrer"
                className="text-sm text-white/70 hover:text-white transition-colors inline-flex items-center gap-1.5"
              >
                <ExternalLink size={15} /> View source
              </a>
            </div>
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
    </section>
  );
}
