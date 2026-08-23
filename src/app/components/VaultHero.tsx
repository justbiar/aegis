"use client";

// One-shot cinematic opening. On load a full-screen overlay covers the page
// showing the sealed vault. The first scroll/tap plays the vault-open clip once
// (camera glides in), then the overlay zooms through the opening and fades away
// for good — the site is revealed and stays open (no scrubbing back and forth).
// Skipped on reduced-motion and after it has played once in the session.

import { useEffect, useRef, useState } from "react";

export function VaultHero() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(true);
  const [started, setStarted] = useState(false); // intent received → playing
  const [exiting, setExiting] = useState(false); // final zoom-through + fade
  const startedRef = useRef(false);

  useEffect(() => {
    // Already seen this session, or reduced motion → don't gate the site.
    let skip = false;
    try {
      skip = sessionStorage.getItem("aegis_intro_done") === "1";
    } catch {
      /* sessionStorage unavailable */
    }
    if (skip || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(false);
      return;
    }

    document.body.style.overflow = "hidden";

    const video = videoRef.current;
    if (video) {
      const pin = () => {
        video.currentTime = 0;
        video.pause();
      };
      if (video.readyState >= 1) pin();
      else video.addEventListener("loadedmetadata", pin, { once: true });
    }

    const finish = () => {
      setExiting(true);
      document.body.style.overflow = "";
      try {
        sessionStorage.setItem("aegis_intro_done", "1");
      } catch {
        /* ignore */
      }
      window.setTimeout(() => setVisible(false), 850);
    };

    const begin = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      setStarted(true);
      const v = videoRef.current;
      if (v && v.duration) {
        v.playbackRate = 1.4;
        v.play().catch(() => {});
        v.onended = finish;
        window.setTimeout(finish, 6000); // safety net
      } else {
        finish();
      }
    };

    const onWheel = () => begin();
    const onTouch = () => begin();
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) begin();
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[70] overflow-hidden bg-[#fafafa] dark:bg-[#0d0d0d] transition-[opacity,transform] duration-[850ms] ease-out cursor-pointer"
      style={{ opacity: exiting ? 0 : 1, transform: exiting ? "scale(1.35)" : "scale(1)", transformOrigin: "50% 46%" }}
      onClick={() => {
        if (!startedRef.current) {
          startedRef.current = true;
          setStarted(true);
          const v = videoRef.current;
          if (v && v.duration) {
            v.playbackRate = 1.4;
            v.play().catch(() => {});
            v.onended = () => {
              setExiting(true);
              document.body.style.overflow = "";
              try {
                sessionStorage.setItem("aegis_intro_done", "1");
              } catch {
                /* ignore */
              }
              window.setTimeout(() => setVisible(false), 850);
            };
          }
        }
      }}
      role="button"
      aria-label="Enter Aegis — open the vault"
    >
      <video
        ref={videoRef}
        src="/vault-hero.mp4"
        muted
        playsInline
        preload="auto"
        aria-hidden
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(120% 90% at 50% 44%, rgba(0,0,0,0.46) 0%, rgba(0,0,0,0.16) 46%, rgba(0,0,0,0) 74%)" }}
        aria-hidden
      />

      {/* Intro copy — fades out the moment the vault starts opening. */}
      <div
        className="absolute inset-0 flex items-center justify-center px-6 transition-opacity duration-500"
        style={{ opacity: started ? 0 : 1 }}
      >
        <div className="max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 mb-7 px-3 py-1 rounded-full border border-white/25 bg-white/10 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-white/90">STRK20 Private Sprint</span>
          </div>
          <h1
            className="font-display text-5xl sm:text-6xl lg:text-7xl font-semibold text-white leading-[0.95] tracking-tight mb-6"
            style={{ textShadow: "0 2px 40px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.5)" }}
          >
            Whitehat rescue for{" "}
            <span className="font-serif font-normal italic tracking-tight">leaked keys</span>
          </h1>
          <p className="text-lg text-white/85 leading-relaxed max-w-xl mx-auto" style={{ textShadow: "0 1px 20px rgba(0,0,0,0.6)" }}>
            Aegis sweeps accidentally leaked keys into the STRK20 shielded vault
            before an attacker can.
          </p>
        </div>
      </div>

      {/* Scroll hint */}
      <div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 text-center pointer-events-none transition-opacity duration-500"
        style={{ opacity: started ? 0 : 1 }}
        aria-hidden
      >
        <p className="text-[11px] uppercase tracking-[0.3em] text-white/80 mb-2">Scroll to open the vault</p>
        <span className="inline-block w-5 h-8 rounded-full border border-white/50 relative">
          <span className="absolute left-1/2 top-1.5 -translate-x-1/2 w-1 h-1.5 rounded-full bg-white/80 animate-bounce" />
        </span>
      </div>
    </div>
  );
}
