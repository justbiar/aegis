"use client";

// Live "mission control" console, themed to match the Subframe site (light/dark
// aware, near-monochrome). Real data (registry repos, vault totals, epoch
// history) drives it; the scan pass is a client-side visualisation sweeping
// every repo node with a terminal readout. Asset flows are private — masked
// amounts, no addresses. Read-only: never calls scan-registry, never rescues.
//
// Used both at /console (embedded={false}) and as a section on the home page
// (embedded). The canvas reads the current theme every frame so it follows the
// toggle live.

import { useEffect, useRef, useState } from "react";

interface RegistryEntry {
  repo_url: string;
  name?: string;
  category?: string;
}
interface NetInfo {
  balance: number | null;
  rescuedTotal: number;
  rescuedCount: number;
  requestedTotal: number;
  requestedCount: number;
}
interface Epoch {
  n: number;
  ts: number;
  scanned: number;
  clean: number;
  exposures: number;
  rescued: number;
  rescuedStrk: number;
  errors: number;
  durationMs: number;
}
interface ScanState {
  index: number;
  order: number[];
  status: Record<number, "clean" | "exposure" | "rescue">;
}

const STAGES = ["DETECT", "DERIVE", "CHECK", "SHIELD", "CLAIM"] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const repoLabel = (e?: RegistryEntry) => (e?.repo_url ?? "").replace("https://github.com/", "") || e?.name || "repo";
const isDarkNow = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");

function useClock() {
  const [t, setT] = useState("--:--:--");
  useEffect(() => {
    const tick = () => setT(new Date().toISOString().slice(11, 19));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

// ── Canvas graph — theme-aware, near-monochrome. ────────────────────────────
function GraphCanvas({ entries, scanRef, rescueTick }: { entries: RegistryEntry[]; scanRef: React.MutableRefObject<ScanState>; rescueTick: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rescueRef = useRef(0);
  useEffect(() => {
    rescueRef.current = rescueTick;
  }, [rescueTick]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0;
    let H = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    type Node = { bx: number; by: number; x: number; y: number; ph: number; hot: number };
    let nodes: Node[] = [];
    const build = () => {
      const cx = W / 2;
      const cy = H / 2;
      const ring = Math.min(W, H) * 0.36;
      const cats = Array.from(new Set(entries.map((e) => e.category ?? "Other")));
      const ci = new Map(cats.map((c, i) => [c, i]));
      nodes = entries.slice(0, 200).map((e, i) => {
        const k = ci.get(e.category ?? "Other") ?? 0;
        const ca = (k / Math.max(1, cats.length)) * Math.PI * 2;
        const clx = cx + Math.cos(ca) * ring;
        const cly = cy + Math.sin(ca) * ring;
        const a = (i * 2.399963) % (Math.PI * 2);
        const rr = 24 + ((i * 37) % 62);
        const bx = clx + Math.cos(a) * rr;
        const by = cly + Math.sin(a) * rr;
        return { bx, by, x: bx, y: by, ph: Math.random() * Math.PI * 2, hot: 0 };
      });
    };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = r.width;
      H = r.height;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    };

    type P = { t: number; sx: number; sy: number; cx: number; cy: number; ex: number; ey: number; hue: string };
    let ps: P[] = [];
    const spawn = (ni: number, hue: string) => {
      const n = nodes[ni];
      if (!n) return;
      const ex = W / 2;
      const ey = H / 2;
      ps.push({ t: 0, sx: n.x, sy: n.y, cx: (n.x + ex) / 2 + (Math.random() - 0.5) * 120, cy: (n.y + ey) / 2 + (Math.random() - 0.5) * 120, ex, ey, hue });
    };

    let raf = 0;
    let last = performance.now();
    let lastRescue = rescueRef.current;
    let prev = -1;

    const frame = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      const dark = isDarkNow();
      // Theme palette.
      const pal = dark
        ? { node: "#8f8f8f", line: "rgba(255,255,255,0.07)", vault: "#f2f2f0", vaultRing: "rgba(242,242,240,0.3)", cursor: "#f2f2f0", scan: "#c9ccd6", rescue: "#2fbf85", exposure: "#f5a623", label: "rgba(242,242,240,0.75)" }
        : { node: "#8a8a8a", line: "rgba(0,0,0,0.06)", vault: "#171717", vaultRing: "rgba(23,23,23,0.28)", cursor: "#171717", scan: "#5c5c5c", rescue: "#0e9f6e", exposure: "#b7791f", label: "rgba(23,23,23,0.75)" };
      const cx = W / 2;
      const cy = H / 2;

      if (rescueRef.current !== lastRescue) {
        lastRescue = rescueRef.current;
        for (let i = 0; i < 6; i++) setTimeout(() => spawn(Math.floor(Math.random() * nodes.length), pal.rescue), i * 110);
      }

      const scan = scanRef.current;
      const active = scan.index >= 0 ? scan.order[scan.index] : -1;
      if (active !== prev) {
        prev = active;
        if (active >= 0 && nodes[active]) {
          nodes[active].hot = 1;
          const st = scan.status[active];
          if (st === "rescue") spawn(active, pal.rescue);
          else if (st === "exposure") spawn(active, pal.exposure);
          else if (Math.random() < 0.25) spawn(active, pal.scan);
        }
      }

      ctx.clearRect(0, 0, W, H);
      for (const n of nodes) {
        ctx.strokeStyle = pal.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(n.x, n.y);
        ctx.lineTo(cx, cy);
        ctx.stroke();
      }
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.ph += dt * 0.001;
        n.x = n.bx + Math.cos(n.ph) * 3;
        n.y = n.by + Math.sin(n.ph * 1.3) * 3;
        n.hot *= 0.94;
        const st = scan.status[i];
        const base = st === "rescue" ? pal.rescue : st === "exposure" ? pal.exposure : pal.node;
        const r = 2.1 + n.hot * 3.6;
        if (n.hot > 0.05) {
          ctx.shadowColor = base;
          ctx.shadowBlur = 12 * n.hot;
        }
        ctx.fillStyle = base;
        ctx.globalAlpha = 0.5 + n.hot * 0.5;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
      if (active >= 0 && nodes[active]) {
        const n = nodes[active];
        ctx.strokeStyle = pal.cursor;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 8 + Math.sin(now * 0.02) * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ps = ps.filter((p) => p.t < 1);
      for (const p of ps) {
        p.t += dt * 0.0011;
        const u = p.t;
        const iu = 1 - u;
        const x = iu * iu * p.sx + 2 * iu * u * p.cx + u * u * p.ex;
        const y = iu * iu * p.sy + 2 * iu * u * p.cy + u * u * p.ey;
        ctx.shadowColor = p.hue;
        ctx.shadowBlur = 10;
        ctx.fillStyle = p.hue;
        ctx.globalAlpha = Math.sin(u * Math.PI);
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
      const pulse = 1 + Math.sin(now * 0.003) * 0.08;
      ctx.shadowColor = pal.vault;
      ctx.shadowBlur = 22;
      ctx.fillStyle = pal.vault;
      ctx.beginPath();
      ctx.arc(cx, cy, 9 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = pal.vaultRing;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 16 + Math.sin(now * 0.003) * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = pal.label;
      ctx.font = "600 10px 'Fragment Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("SHIELDED VAULT", cx, cy + 34);
      raf = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [entries, scanRef]);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
}

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const ago = (ts: number) => {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

export function LiveConsole({ embedded = false }: { embedded?: boolean }) {
  const clock = useClock();
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [mainnet, setMainnet] = useState<NetInfo | null>(null);
  const [sepolia, setSepolia] = useState<NetInfo | null>(null);
  const [epochs, setEpochs] = useState<Epoch[]>([]);
  const [stage, setStage] = useState(0);
  const scanRef = useRef<ScanState>({ index: -1, order: [], status: {} });
  const [progress, setProgress] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [term, setTerm] = useState<string[]>([]);
  const pushTerm = (line: string) => setTerm((t) => [...t.slice(-9), line]);
  const [rescueTick, setRescueTick] = useState(0);
  const rescueTickRef = useRef(0);
  const lastEpochN = useRef<number>(-1);
  const latestEpochRef = useRef<Epoch | null>(null);

  useEffect(() => {
    const loadRegistry = () => fetch("/api/registry").then((r) => r.json()).then((d) => setEntries(d.entries ?? [])).catch(() => {});
    const loadVault = () => fetch("/api/vault").then((r) => r.json()).then((d) => { setMainnet(d.mainnet ?? null); setSepolia(d.sepolia ?? null); }).catch(() => {});
    const loadEpochs = () => fetch("/api/epochs?limit=160").then((r) => r.json()).then((d) => {
      const es: Epoch[] = d.epochs ?? [];
      setEpochs(es);
      const latest = es[es.length - 1];
      latestEpochRef.current = latest ?? null;
      if (latest && latest.n !== lastEpochN.current) {
        if (lastEpochN.current !== -1 && latest.rescued > 0) { rescueTickRef.current++; setRescueTick(rescueTickRef.current); }
        lastEpochN.current = latest.n;
      }
    }).catch(() => {});
    loadRegistry();
    loadVault();
    loadEpochs();
    const reg = setInterval(loadRegistry, 60000);
    const v = setInterval(loadVault, 20000);
    const e = setInterval(loadEpochs, 8000);
    return () => { clearInterval(reg); clearInterval(v); clearInterval(e); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setStage((s) => (s + 1) % STAGES.length), 1400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (entries.length === 0) return;
    let cancelled = false;
    const run = async () => {
      while (!cancelled) {
        const order = entries.map((_, i) => i);
        const ep = latestEpochRef.current;
        const status: Record<number, "clean" | "exposure" | "rescue"> = {};
        const pick = (n: number, kind: "exposure" | "rescue") => {
          for (let k = 0; k < n && order.length; k++) status[order[Math.floor(Math.random() * order.length)]] = kind;
        };
        pick(ep?.rescued ?? 0, "rescue");
        pick(ep?.exposures ?? 0, "exposure");
        scanRef.current = { index: -1, order, status };
        setScanning(true);
        pushTerm(`$ aegis scan --registry  (${order.length} repos)`);
        for (let i = 0; i < order.length; i++) {
          if (cancelled) return;
          scanRef.current.index = i;
          const repo = repoLabel(entries[order[i]]);
          const st = status[order[i]];
          setProgress(Math.round(((i + 1) / order.length) * 100));
          if (st || i % 4 === 0 || i === order.length - 1) {
            const tag = st === "rescue" ? "RESCUE ····.·· STRK -> vault" : st === "exposure" ? "EXPOSURE flagged" : "clean";
            pushTerm(`> ${repo.slice(0, 34).padEnd(34, " ")} ${tag}`);
          }
          await sleep(38);
        }
        scanRef.current.index = -1;
        setProgress(100);
        pushTerm(`ok epoch #${ep?.n ?? "—"} complete · ${order.length} scanned · ${ep?.rescued ?? 0} rescued`);
        setScanning(false);
        await sleep(2600);
        if (cancelled) return;
        setProgress(0);
        pushTerm(`… idle · waiting for next scan window`);
        await sleep(1400);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [entries]);

  const latest = epochs[epochs.length - 1];
  const recentNs = epochs.slice(-5).map((e) => e.n);
  const rescuedTotal = (mainnet?.rescuedTotal ?? 0) + (sepolia?.rescuedTotal ?? 0);
  const rescuedCount = (mainnet?.rescuedCount ?? 0) + (sepolia?.rescuedCount ?? 0);
  const pendingTotal = (mainnet?.requestedTotal ?? 0) + (sepolia?.requestedTotal ?? 0);
  const pendingCount = (mainnet?.requestedCount ?? 0) + (sepolia?.requestedCount ?? 0);
  const loaded = mainnet !== null || sepolia !== null;
  const totalExposures = epochs.reduce((s, e) => s + e.exposures, 0);
  const feed = [...epochs].reverse().slice(0, 14);

  return (
    <div className={`${embedded ? "" : "min-h-screen bg-[#fafafa] dark:bg-[#0d0d0d]"} text-[#171717] dark:text-[#f2f2f0] font-mono text-[12px] leading-tight ${embedded ? "" : "px-3 sm:px-5 py-4"}`}>
      {/* TOP BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-ls-gray-200 dark:border-ls-gray-800 rounded-2xl px-4 py-3 bg-white dark:bg-[#161616]">
        {embedded ? (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold" style={{ background: "var(--graphite)", color: "var(--on-graphite)" }}>A</div>
            <div>
              <p className="font-bold tracking-wide text-sm">LIVE CONSOLE</p>
              <p className="text-ls-gray-500 text-[10px] tracking-widest uppercase">the agent, running · read-only</p>
            </div>
          </div>
        ) : (
          <a href="/" className="flex items-center gap-3 group">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold group-hover:opacity-80 transition-opacity" style={{ background: "var(--graphite)", color: "var(--on-graphite)" }}>A</div>
            <div>
              <p className="font-bold tracking-wide text-sm">AEGIS · WHITEHAT RESCUE AGENT</p>
              <p className="text-ls-gray-500 text-[10px] tracking-widest uppercase">Starknet · STRK20 shielded pool · ← back to site</p>
            </div>
          </a>
        )}
        <div className="flex items-center gap-5">
          <Stat label="Repos" value={String(entries.length || "—")} />
          <Stat label="Rescued" value={loaded ? fmt(rescuedTotal) : "—"} sub="STRK" positive />
          <Stat label="Accounts" value={loaded ? String(rescuedCount) : "—"} />
          <Stat label="Pending" value={loaded ? fmt(pendingTotal) : "—"} sub="STRK" />
          <div className="text-right">
            <p className="font-bold tabular-nums text-sm">{clock}</p>
            <p className="text-ls-gray-500 text-[10px] flex items-center gap-1 justify-end">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> UTC
            </p>
          </div>
        </div>
      </div>

      {/* EPOCH PROGRESSION */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border border-ls-gray-200 dark:border-ls-gray-800 rounded-2xl px-4 py-2.5 bg-white dark:bg-[#161616]">
        <span className="text-[10px] uppercase tracking-widest text-ls-gray-500">Epoch</span>
        <div className="flex items-center gap-2 flex-wrap">
          {recentNs.length === 0 && <span className="text-ls-gray-400">#—</span>}
          {recentNs.map((n, i) => {
            const isLatest = i === recentNs.length - 1;
            return (
              <span key={n} className="flex items-center gap-2">
                <span className={`tabular-nums ${isLatest ? "font-bold text-lg text-black dark:text-white" : "text-sm text-ls-gray-400"}`}>#{n}</span>
                {!isLatest && <span className="text-ls-gray-300 dark:text-ls-gray-700">→</span>}
              </span>
            );
          })}
          {recentNs.length > 0 && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="live" />}
        </div>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-ls-gray-100 dark:bg-ls-gray-800 text-[10px] text-ls-gray-500 tracking-wider">
          SCAN ENGINE · LIVE{latest ? ` · last ${ago(latest.ts)}` : ""}
        </span>
        <span className="text-ls-gray-500 ml-auto">
          scanned <span className="text-black dark:text-white">{latest?.scanned ?? "—"}</span> · clean{" "}
          <span className="text-emerald-600 dark:text-emerald-400">{latest?.clean ?? "—"}</span> · exposure{" "}
          <span className="text-amber-600 dark:text-amber-500">{latest?.exposures ?? 0}</span> · rescued{" "}
          <span className="text-black dark:text-white">{latest?.rescued ?? 0}</span>
        </span>
      </div>

      {/* MAIN GRID */}
      <div className="mt-3 grid grid-cols-1 lg:grid-cols-[220px_1fr_240px] gap-3">
        <div className="space-y-3">
          <Panel title="NETWORKS">
            <NetRow label="MAINNET" info={mainnet} />
            <div className="h-px bg-ls-gray-200 dark:bg-ls-gray-800 my-2" />
            <NetRow label="SEPOLIA" info={sepolia} />
          </Panel>
          <Panel title="EXPOSURE LEDGER">
            <p className="font-bold tabular-nums leading-none text-black dark:text-white" style={{ fontSize: 30 }}>{totalExposures}</p>
            <p className="text-ls-gray-500 text-[10px] uppercase tracking-widest mt-1 mb-2.5">exposures seen</p>
            <Bar label="Rescued" value={rescuedCount} max={Math.max(1, rescuedCount + totalExposures)} tone="#0e9f6e" />
            <Bar label="Pending" value={pendingCount} max={Math.max(1, rescuedCount + totalExposures)} tone="#b7791f" />
            <Bar label="Exposed" value={totalExposures} max={Math.max(1, rescuedCount + totalExposures)} toneVar />
          </Panel>
        </div>

        <div className="border border-ls-gray-200 dark:border-ls-gray-800 rounded-2xl bg-white dark:bg-[#161616] relative overflow-hidden min-h-[360px] lg:min-h-[420px]">
          <div className="absolute top-2 left-3 z-10">
            <p className="font-bold tracking-wide text-black dark:text-white">REGISTRY GRAPH · LIVE</p>
            <p className="text-ls-gray-500 text-[10px]">every registered repo is a node · funds flow into the shielded vault</p>
          </div>
          <div className="absolute top-2 right-3 z-10 flex items-center gap-1.5 text-[10px]">
            <span className={`w-1.5 h-1.5 rounded-full ${scanning ? "bg-emerald-500 animate-pulse" : "bg-ls-gray-400"}`} />
            <span className={scanning ? "text-emerald-600 dark:text-emerald-400" : "text-ls-gray-500"}>{scanning ? "SCANNING" : "IDLE"}</span>
          </div>
          <div className="absolute inset-0">
            <GraphCanvas entries={entries} scanRef={scanRef} rescueTick={rescueTick} />
          </div>
          <p className="absolute bottom-2 left-3 z-10 text-ls-gray-400 text-[10px]">transfers are private — amounts and destinations are masked (shielded note-to-note)</p>
        </div>

        <Panel title="ACTIVITY FEED">
          <div className="space-y-1.5 max-h-[420px] overflow-hidden">
            {feed.length === 0 && <p className="text-ls-gray-400">waiting for first epoch…</p>}
            {feed.map((e) => (
              <div key={e.n} className="text-[11px] leading-snug">
                <span className="text-ls-gray-400">#{e.n}</span>{" "}
                {e.rescued > 0 ? (
                  <span className="text-emerald-600 dark:text-emerald-400">RESCUE ····.·· STRK → vault <span className="text-ls-gray-500">({e.rescued})</span></span>
                ) : e.exposures > 0 ? (
                  <span className="text-amber-600 dark:text-amber-500">EXPOSURE ×{e.exposures} flagged</span>
                ) : (
                  <span className="text-ls-gray-500">scanned {e.scanned} · clean</span>
                )}
                <span className="text-ls-gray-400 ml-1">{ago(e.ts)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* PIPELINE */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border border-ls-gray-200 dark:border-ls-gray-800 rounded-2xl px-4 py-2.5 bg-white dark:bg-[#161616]">
        <span className="text-[10px] uppercase tracking-widest text-ls-gray-500 mr-1">Pipeline</span>
        {STAGES.map((s, i) => (
          <span key={s} className="flex items-center gap-1.5">
            <span
              className={`px-2 py-0.5 rounded text-[10px] tracking-wider transition-colors duration-300 ${i === stage ? "font-bold" : "bg-ls-gray-100 dark:bg-ls-gray-800 text-ls-gray-500"}`}
              style={i === stage ? { background: "var(--graphite)", color: "var(--on-graphite)" } : undefined}
            >
              {String(i + 1).padStart(2, "0")} {s}
            </span>
            {i < STAGES.length - 1 && <span className="text-ls-gray-300 dark:text-ls-gray-700">→</span>}
          </span>
        ))}
      </div>

      {/* TERMINAL */}
      <div className="mt-3 border border-ls-gray-200 dark:border-ls-gray-800 rounded-2xl bg-white dark:bg-[#0f0f0f] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-ls-gray-200 dark:border-ls-gray-800">
          <span className="font-bold tracking-wide flex items-center gap-2 text-black dark:text-white">
            <span className="flex gap-1">
              <span className="w-2 h-2 rounded-full bg-ls-gray-300 dark:bg-ls-gray-600" />
              <span className="w-2 h-2 rounded-full bg-ls-gray-300 dark:bg-ls-gray-600" />
              <span className="w-2 h-2 rounded-full bg-ls-gray-300 dark:bg-ls-gray-600" />
            </span>
            aegis@scanner
          </span>
          <span className={`text-[10px] ${scanning ? "text-emerald-600 dark:text-emerald-400" : "text-ls-gray-500"}`}>{scanning ? `SCANNING ${progress}%` : "IDLE"}</span>
        </div>
        <div className="h-1 bg-ls-gray-100 dark:bg-ls-gray-800">
          <div className="h-full transition-[width] duration-100 ease-linear bg-emerald-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="px-4 py-3 h-[168px] overflow-hidden flex flex-col justify-end">
          {term.length === 0 && <p className="text-ls-gray-400">booting scanner…</p>}
          {term.map((l, i) => (
            <p
              key={i}
              className={`whitespace-pre leading-snug ${
                l.includes("RESCUE") ? "text-emerald-600 dark:text-emerald-400" : l.includes("EXPOSURE") ? "text-amber-600 dark:text-amber-500" : l.startsWith("$") || l.startsWith("ok") ? "text-black dark:text-white" : l.startsWith("…") ? "text-ls-gray-400" : "text-ls-gray-500"
              }`}
            >
              {l}
            </p>
          ))}
        </div>
      </div>

      {/* EPOCH WALL */}
      <div className="mt-3 border border-ls-gray-200 dark:border-ls-gray-800 rounded-2xl bg-white dark:bg-[#161616] px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <p className="font-bold tracking-wide text-black dark:text-white">EPOCH WALL · EVERY SCAN</p>
          <span className="text-[10px] text-ls-gray-500">
            <span className="text-ls-gray-400">■</span> clean <span className="text-amber-600 dark:text-amber-500">■</span> exposure <span className="text-emerald-600 dark:text-emerald-400">■</span> rescue
          </span>
        </div>
        <div className="flex flex-wrap gap-[3px]">
          {epochs.length === 0 && <p className="text-ls-gray-400 text-[11px]">no epochs recorded yet — the scanner writes one per run</p>}
          {epochs.map((e) => {
            const cls = e.rescued > 0 ? "bg-emerald-500" : e.exposures > 0 ? "bg-amber-500" : "bg-ls-gray-300 dark:bg-ls-gray-700";
            return <div key={e.n} title={`Epoch #${e.n} · scanned ${e.scanned} · ${e.rescued} rescued · ${e.exposures} exposed`} className={`w-[11px] h-[11px] rounded-[2px] ${cls}`} />;
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="text-right">
      <p className="text-[10px] uppercase tracking-widest text-ls-gray-500">{label}</p>
      <p className={`font-bold tabular-nums text-sm ${positive ? "text-emerald-600 dark:text-emerald-400" : "text-black dark:text-white"}`}>
        {value} {sub && <span className="text-[10px] text-ls-gray-500">{sub}</span>}
      </p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-ls-gray-200 dark:border-ls-gray-800 rounded-2xl bg-white dark:bg-[#161616] px-4 py-3">
      <p className="font-bold tracking-wide mb-2.5 text-black dark:text-white">{title}</p>
      {children}
    </div>
  );
}

function NetRow({ label, info }: { label: string; info: NetInfo | null }) {
  return (
    <div>
      <p className="text-[10px] tracking-widest text-ls-gray-500">{label}</p>
      <p className="tabular-nums mt-0.5 text-black dark:text-white">
        {info ? fmt(info.balance ?? 0) : "—"} <span className="text-[10px] text-ls-gray-500">STRK bal</span>
      </p>
      <p className="text-ls-gray-500 text-[10px] mt-0.5">rescued {info ? fmt(info.rescuedTotal) : "—"} · {info?.rescuedCount ?? 0} acct</p>
    </div>
  );
}

function Bar({ label, value, max, tone, toneVar }: { label: string; value: number; max: number; tone?: string; toneVar?: boolean }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="mb-1.5">
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-ls-gray-500">{label}</span>
        <span className="text-black dark:text-white tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-ls-gray-100 dark:bg-ls-gray-800 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${toneVar ? "bg-ls-gray-400 dark:bg-ls-gray-500" : ""}`} style={tone ? { width: `${pct}%`, backgroundColor: tone } : { width: `${pct}%` }} />
      </div>
    </div>
  );
}
