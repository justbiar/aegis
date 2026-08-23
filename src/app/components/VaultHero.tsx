"use client";

// One-shot cinematic opening. A full-screen overlay shows the sealed vault. The
// first scroll/tap plays the vault-open clip once; as the door opens, a circular
// aperture grows from the vault's centre and the REAL site (sitting behind the
// overlay) shows through it — so you first glimpse the site inside the vault,
// then it opens up to full screen. Plays once per session; skipped on reduced
// motion.

import { useEffect, useRef, useState } from "react";

export function VaultHero() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(true);
  const [started, setStarted] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
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
    const overlay = overlayRef.current;
    const site = document.getElementById("main-content");
    const S0 = 0.42; // site starts small, deep inside the vault
    if (video) {
      const pin = () => {
        video.currentTime = 0;
        video.pause();
      };
      if (video.readyState >= 1) pin();
      else video.addEventListener("loadedmetadata", pin, { once: true });
    }

    let raf = 0;
    let finished = false;

    // reveal 0 → 1: the vault opening (mask hole) grows, and the real site
    // behind it scales up from deep inside toward the camera → feels like flying
    // into the vault to the site sitting at its back, not a flat cut-out.
    const applyState = (r: number) => {
      if (overlay) {
        const hole = r * 155;
        const mask = `radial-gradient(circle at 50% 46%, transparent ${hole}%, black ${hole + 10}%)`;
        overlay.style.webkitMaskImage = mask;
        overlay.style.maskImage = mask;
      }
      if (site) {
        const s = S0 + (1 - S0) * r;
        site.style.transformOrigin = "50% 46%";
        site.style.transform = `scale(${s})`;
        site.style.opacity = String(0.4 + 0.6 * r);
      }
    };

    const resetSite = () => {
      if (!site) return;
      site.style.transform = "";
      site.style.opacity = "";
      site.style.transformOrigin = "";
      site.style.willChange = "";
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      document.body.style.overflow = "";
      resetSite();
      try {
        sessionStorage.setItem("aegis_intro_done", "1");
      } catch {
        /* ignore */
      }
      setVisible(false);
    };

    const loop = () => {
      const v = videoRef.current;
      if (v && v.duration) {
        const p = v.currentTime / v.duration;
        // The site emerges once the door begins to crack (~35% of the clip).
        const reveal = Math.min(Math.max((p - 0.35) / 0.63, 0), 1);
        applyState(reveal);
        if (v.ended || p >= 0.995) {
          applyState(1);
          finish();
          return;
        }
      }
      raf = requestAnimationFrame(loop);
    };

    // Prime the site deep inside the (still-sealed) vault.
    if (site) site.style.willChange = "transform, opacity";
    applyState(0);

    const begin = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      setStarted(true);
      const v = videoRef.current;
      if (v && v.duration) {
        v.playbackRate = 1.25;
        v.play().catch(() => {});
        raf = requestAnimationFrame(loop);
        window.setTimeout(finish, 8000); // safety net
      } else {
        finish();
      }
    };

    const onWheel = () => begin();
    const onTouch = () => begin();
    const onClick = () => begin();
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) begin();
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });
    window.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = "";
      resetSite();
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[70] overflow-hidden bg-[#fafafa] dark:bg-[#0d0d0d] cursor-pointer"
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
