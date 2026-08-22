"use client";

// Live "mission control" console. Real data (registry repos, vault totals,
// epoch history) drives it. The scan pass is a client-side visualisation: it
// sweeps every repo node one-by-one, fast, with a terminal progress readout —
// mirroring how the agent actually walks the registry each epoch. Asset flows
// are deliberately private: masked amounts, no addresses.
//
// Loading this page is read-only (registry / vault / epochs). It never calls
// scan-registry, so it never triggers a rescue.

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
  index: number; // currently-scanning node, -1 = idle
  order: number[]; // node indices, scan order
  status: Record<number, "clean" | "exposure" | "rescue">;
}

const STAGES = ["DETECT", "DERIVE", "CHECK", "SHIELD", "CLAIM"] as const;
const CLUSTER_COLORS = ["#22d3ee", "#2fbf85", "#a78bfa", "#f5a623", "#f0555a", "#e56b43", "#38bdf8"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const repoLabel = (e?: RegistryEntry) => (e?.repo_url ?? "").replace("https://github.com/", "") || e?.name || "repo";

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

// ── Canvas graph: repo nodes clustered by category, a scan cursor sweeping
//    them one-by-one, and masked transfers flowing into the shielded vault ──
function GraphCanvas({
  entries,
  scanRef,
  rescueTick,
}: {
  entries: RegistryEntry[];
  scanRef: React.MutableRefObject<ScanState>;
  rescueTick: number;
}) {
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

    const cats = Array.from(new Set(entries.map((e) => e.category ?? "Other")));
    const catIndex = new Map(cats.map((c, i) => [c, i]));

    let W = 0;
    let H = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    type Node = { bx: number; by: number; x: number; y: number; ci: number; ph: number; hot: number };
    let nodes: Node[] = [];
    const buildNodes = () => {
      const cx = W / 2;
      const cy = H / 2;
      const ring = Math.min(W, H) * 0.36;
      nodes = entries.slice(0, 200).map((e, i) => {
        const ci = catIndex.get(e.category ?? "Other") ?? 0;
        const ca = (ci / Math.max(1, cats.length)) * Math.PI * 2;
        const clx = cx + Math.cos(ca) * ring;
        const cly = cy + Math.sin(ca) * ring;
        const a = (i * 2.399963) % (Math.PI * 2);
        const rr = 24 + ((i * 37) % 62);
        const bx = clx + Math.cos(a) * rr;
        const by = cly + Math.sin(a) * rr;
        return { bx, by, x: bx, y: by, ci, ph: Math.random() * Math.PI * 2, hot: 0 };
      });
    };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = r.width;
      H = r.height;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildNodes();
    };

    type Particle = { t: number; sx: number; sy: number; cx: number; cy: number; ex: number; ey: number; hue: string };
    let particles: Particle[] = [];
    const spawnFrom = (ni: number, hue: string) => {
      const n = nodes[ni];
      if (!n) return;
      const ex = W / 2;
      const ey = H / 2;
      const mx = (n.x + ex) / 2 + (Math.random() - 0.5) * 120;
      const my = (n.y + ey) / 2 + (Math.random() - 0.5) * 120;
      particles.push({ t: 0, sx: n.x, sy: n.y, cx: mx, cy: my, ex, ey, hue });
    };

    let raf = 0;
    let last = performance.now();
    let lastRescue = rescueRef.current;
    let prevScanIdx = -1;

    const frame = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      const cx = W / 2;
      const cy = H / 2;

      if (rescueRef.current !== lastRescue) {
        lastRescue = rescueRef.current;
        for (let i = 0; i < 6; i++) setTimeout(() => spawnFrom(Math.floor(Math.random() * nodes.length), "#2fbf85"), i * 110);
      }

      const scan = scanRef.current;
      const activeNode = scan.index >= 0 ? scan.order[scan.index] : -1;
      // When the scan cursor advances, light the new node and, for hits, flow a
      // (masked) transfer into the vault.
      if (activeNode !== prevScanIdx) {
        prevScanIdx = activeNode;
        if (activeNode >= 0 && nodes[activeNode]) {
          nodes[activeNode].hot = 1;
          const st = scan.status[activeNode];
          if (st === "rescue") spawnFrom(activeNode, "#2fbf85");
          else if (st === "exposure") spawnFrom(activeNode, "#f5a623");
          else if (Math.random() < 0.25) spawnFrom(activeNode, "#22d3ee");
        }
      }

      ctx.clearRect(0, 0, W, H);

      for (const n of nodes) {
        ctx.strokeStyle = "rgba(120,140,170,0.04)";
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
        const base =
          st === "rescue" ? "#2fbf85" : st === "exposure" ? "#f5a623" : CLUSTER_COLORS[n.ci % CLUSTER_COLORS.length];
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

      // Scan cursor ring on the node being scanned.
      if (activeNode >= 0 && nodes[activeNode]) {
        const n = nodes[activeNode];
        ctx.strokeStyle = "#22d3ee";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 8 + Math.sin(now * 0.02) * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      particles = particles.filter((p) => p.t < 1);
      for (const p of particles) {
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
      ctx.shadowColor = "#e56b43";
      ctx.shadowBlur = 26;
      ctx.fillStyle = "#e56b43";
      ctx.beginPath();
      ctx.arc(cx, cy, 9 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(229,107,67,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 16 + Math.sin(now * 0.003) * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(230,230,240,0.8)";
      ctx.font = "600 10px 'Space Mono', monospace";
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

export default function ConsolePage() {
  const clock = useClock();
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [mainnet, setMainnet] = useState<NetInfo | null>(null);
  const [sepolia, setSepolia] = useState<NetInfo | null>(null);
  const [epochs, setEpochs] = useState<Epoch[]>([]);
  const [stage, setStage] = useState(0);

  // Scan-pass visualisation state.
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
    const loadRegistry = () =>
      fetch("/api/registry").then((r) => r.json()).then((d) => setEntries(d.entries ?? [])).catch(() => {});
    const loadVault = () =>
      fetch("/api/vault").then((r) => r.json()).then((d) => {
        setMainnet(d.mainnet ?? null);
        setSepolia(d.sepolia ?? null);
      }).catch(() => {});
    const loadEpochs = () =>
      fetch("/api/epochs?limit=160").then((r) => r.json()).then((d) => {
        const es: Epoch[] = d.epochs ?? [];
        setEpochs(es);
        const latest = es[es.length - 1];
        latestEpochRef.current = latest ?? null;
        if (latest && latest.n !== lastEpochN.current) {
          if (lastEpochN.current !== -1 && latest.rescued > 0) {
            rescueTickRef.current++;
            setRescueTick(rescueTickRef.current);
          }
          lastEpochN.current = latest.n;
        }
      }).catch(() => {});
    loadRegistry();
    loadVault();
    loadEpochs();
    const reg = setInterval(loadRegistry, 60000);
    const v = setInterval(loadVault, 20000);
    const e = setInterval(loadEpochs, 8000);
    return () => {
      clearInterval(reg);
      clearInterval(v);
      clearInterval(e);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setStage((s) => (s + 1) % STAGES.length), 1400);
    return () => clearInterval(id);
  }, []);

  // The scan pass: sweep every repo one-by-one, fast, then idle and repeat.
  // Exposure/rescue "hits" per pass come from the latest real epoch.
  useEffect(() => {
    if (entries.length === 0) return;
    let cancelled = false;

    const run = async () => {
      while (!cancelled) {
        const order = entries.map((_, i) => i);
        // Assign hits from the latest real epoch (fallback: none).
        const ep = latestEpochRef.current;
        const status: Record<number, "clean" | "exposure" | "rescue"> = {};
        const pick = (n: number, kind: "exposure" | "rescue") => {
          for (let k = 0; k < n && order.length; k++) {
            const idx = order[Math.floor(Math.random() * order.length)];
            status[idx] = kind;
          }
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
          // Only log a sample of lines so the terminal reads fast, not spammy —
          // but always log hits.
          if (st || i % 4 === 0 || i === order.length - 1) {
            const tag = st === "rescue" ? "RESCUE ····.·· STRK → vault" : st === "exposure" ? "EXPOSURE flagged" : "clean";
            pushTerm(`▸ ${repo.slice(0, 34).padEnd(34, " ")} ${tag}`);
          }
          await sleep(38);
        }
        scanRef.current.index = -1;
        setProgress(100);
        const rescued = ep?.rescued ?? 0;
        pushTerm(`✓ epoch #${ep?.n ?? "—"} complete · ${order.length} scanned · ${rescued} rescued`);
        setScanning(false);
        await sleep(2600);
        if (cancelled) return;
        setProgress(0);
        pushTerm(`… idle · waiting for next scan window`);
        await sleep(1400);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [entries]);

  const latest = epochs[epochs.length - 1];
  const rescuedTotal = (mainnet?.rescuedTotal ?? 0) + (sepolia?.rescuedTotal ?? 0);
  const rescuedCount = (mainnet?.rescuedCount ?? 0) + (sepolia?.rescuedCount ?? 0);
  const pendingTotal = (mainnet?.requestedTotal ?? 0) + (sepolia?.requestedTotal ?? 0);
  const pendingCount = (mainnet?.requestedCount ?? 0) + (sepolia?.requestedCount ?? 0);
  const loaded = mainnet !== null || sepolia !== null;
  const totalExposures = epochs.reduce((s, e) => s + e.exposures, 0);
  const feed = [...epochs].reverse().slice(0, 14);

  return (
    <div className="min-h-screen bg-[#06070a] text-[#c9ccd6] font-mono text-[12px] leading-tight px-3 sm:px-5 py-4 selection:bg-[#22d3ee] selection:text-black">
      {/* TOP BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-[#1a1d26] rounded-lg px-4 py-3 bg-[#0a0c11]">
        <a href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded bg-[#e56b43] flex items-center justify-center text-black font-bold group-hover:opacity-80 transition-opacity">A</div>
          <div>
            <p className="text-[#f0f0f5] font-bold tracking-wide text-sm">AEGIS · WHITEHAT RESCUE AGENT</p>
            <p className="text-[#6b7080] text-[10px] tracking-widest uppercase">Starknet · STRK20 shielded pool · ← back to site</p>
          </div>
        </a>
        <div className="flex items-center gap-5">
          <Stat label="Repos" value={String(entries.length || "—")} tone="#22d3ee" />
          <Stat label="Rescued" value={loaded ? fmt(rescuedTotal) : "—"} sub="STRK" tone="#2fbf85" />
          <Stat label="Accounts" value={loaded ? String(rescuedCount) : "—"} tone="#a78bfa" />
          <Stat label="Pending" value={loaded ? fmt(pendingTotal) : "—"} sub="STRK" tone="#f5a623" />
          <div className="text-right">
            <p className="text-[#f0f0f5] font-bold tabular-nums text-sm">{clock}</p>
            <p className="text-[#6b7080] text-[10px] flex items-center gap-1 justify-end">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2fbf85] animate-pulse" /> UTC
            </p>
          </div>
        </div>
      </div>

      {/* EPOCH / PIPELINE STRIP */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border border-[#1a1d26] rounded-lg px-4 py-2.5 bg-[#0a0c11]">
        <span className="text-[#f0f0f5] font-bold">
          EPOCH <span className="text-[#e56b43]">#{latest?.n ?? "—"}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#12151c] text-[10px] text-[#6b7080] tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-[#2fbf85] animate-pulse" />
          SCAN ENGINE · GITHUB ACTIONS{latest ? ` · last ${ago(latest.ts)}` : ""}
        </span>
        <span className="text-[#6b7080]">·</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {STAGES.map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              <span
                className={`px-2 py-0.5 rounded text-[10px] tracking-wider transition-colors duration-300 ${
                  i === stage ? "bg-[#22d3ee] text-black font-bold" : "bg-[#12151c] text-[#6b7080]"
                }`}
              >
                {String(i + 1).padStart(2, "0")} {s}
              </span>
              {i < STAGES.length - 1 && <span className="text-[#2a2e38]">→</span>}
            </span>
          ))}
        </div>
        <span className="text-[#6b7080] ml-auto">
          scanned <span className="text-[#c9ccd6]">{latest?.scanned ?? "—"}</span> · clean{" "}
          <span className="text-[#2fbf85]">{latest?.clean ?? "—"}</span> · exposure{" "}
          <span className="text-[#f0555a]">{latest?.exposures ?? 0}</span> · rescued{" "}
          <span className="text-[#e56b43]">{latest?.rescued ?? 0}</span>
        </span>
      </div>

      {/* MAIN GRID */}
      <div className="mt-3 grid grid-cols-1 lg:grid-cols-[220px_1fr_240px] gap-3">
        <div className="space-y-3">
          <Panel title="NETWORKS">
            <NetRow label="MAINNET" info={mainnet} tone="#2fbf85" />
            <div className="h-px bg-[#1a1d26] my-2" />
            <NetRow label="SEPOLIA" info={sepolia} tone="#f5a623" />
          </Panel>
          <Panel title="EXPOSURE LEDGER">
            <BigNum value={totalExposures} label="exposures seen" tone="#f0555a" />
            <Bar label="Rescued" value={rescuedCount} max={Math.max(1, rescuedCount + totalExposures)} tone="#2fbf85" />
            <Bar label="Pending" value={pendingCount} max={Math.max(1, rescuedCount + totalExposures)} tone="#f5a623" />
            <Bar label="Exposed" value={totalExposures} max={Math.max(1, rescuedCount + totalExposures)} tone="#f0555a" />
          </Panel>
        </div>

        <div className="border border-[#1a1d26] rounded-lg bg-[#0a0c11] relative overflow-hidden min-h-[360px] lg:min-h-[420px]">
          <div className="absolute top-2 left-3 z-10">
            <p className="text-[#f0f0f5] font-bold tracking-wide">REGISTRY GRAPH · LIVE</p>
            <p className="text-[#6b7080] text-[10px]">every registered repo is a node · funds flow into the shielded vault</p>
          </div>
          <div className="absolute top-2 right-3 z-10 flex items-center gap-1.5 text-[10px]" style={{ color: scanning ? "#22d3ee" : "#6b7080" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: scanning ? "#22d3ee" : "#6b7080" }} />
            {scanning ? "SCANNING" : "IDLE"}
          </div>
          <div className="absolute inset-0">
            <GraphCanvas entries={entries} scanRef={scanRef} rescueTick={rescueTick} />
          </div>
          <p className="absolute bottom-2 left-3 z-10 text-[#4a4f5c] text-[10px]">
            transfers are private — amounts and destinations are masked (shielded note-to-note)
          </p>
        </div>

        <Panel title="ACTIVITY FEED">
          <div className="space-y-1.5 max-h-[420px] overflow-hidden">
            {feed.length === 0 && <p className="text-[#4a4f5c]">waiting for first epoch…</p>}
            {feed.map((e) => (
              <div key={e.n} className="text-[11px] leading-snug">
                <span className="text-[#4a4f5c]">#{e.n}</span>{" "}
                {e.rescued > 0 ? (
                  <span className="text-[#2fbf85]">RESCUE ····.·· STRK → vault <span className="text-[#6b7080]">({e.rescued})</span></span>
                ) : e.exposures > 0 ? (
                  <span className="text-[#f0555a]">EXPOSURE ×{e.exposures} flagged</span>
                ) : (
                  <span className="text-[#6b7080]">scanned {e.scanned} · clean</span>
                )}
                <span className="text-[#3a3e48] ml-1">{ago(e.ts)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* SCAN TERMINAL */}
      <div className="mt-3 border border-[#1a1d26] rounded-lg bg-[#08090d] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a1d26]">
          <span className="text-[#f0f0f5] font-bold tracking-wide flex items-center gap-2">
            <span className="flex gap-1">
              <span className="w-2 h-2 rounded-full bg-[#f0555a]" />
              <span className="w-2 h-2 rounded-full bg-[#f5a623]" />
              <span className="w-2 h-2 rounded-full bg-[#2fbf85]" />
            </span>
            aegis@scanner
          </span>
          <span className="text-[10px]" style={{ color: scanning ? "#22d3ee" : "#6b7080" }}>
            {scanning ? `SCANNING ${progress}%` : "IDLE"}
          </span>
        </div>
        {/* progress bar */}
        <div className="h-1 bg-[#12151c]">
          <div className="h-full transition-[width] duration-100 ease-linear" style={{ width: `${progress}%`, background: scanning ? "#22d3ee" : "#2fbf85" }} />
        </div>
        <div className="px-4 py-3 h-[168px] overflow-hidden flex flex-col justify-end">
          {term.length === 0 && <p className="text-[#4a4f5c]">booting scanner…</p>}
          {term.map((l, i) => (
            <p
              key={i}
              className={`whitespace-pre leading-snug ${
                l.includes("RESCUE")
                  ? "text-[#2fbf85]"
                  : l.includes("EXPOSURE")
                  ? "text-[#f5a623]"
                  : l.startsWith("$") || l.startsWith("✓")
                  ? "text-[#c9ccd6]"
                  : l.startsWith("…")
                  ? "text-[#4a4f5c]"
                  : "text-[#6b7080]"
              }`}
            >
              {l}
            </p>
          ))}
        </div>
      </div>

      {/* EPOCH WALL */}
      <div className="mt-3 border border-[#1a1d26] rounded-lg bg-[#0a0c11] px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[#f0f0f5] font-bold tracking-wide">EPOCH WALL · EVERY SCAN SINCE LAUNCH</p>
          <span className="text-[10px] text-[#6b7080]">
            <span className="text-[#2fbf85]">■</span> clean <span className="text-[#f5a623]">■</span> exposure{" "}
            <span className="text-[#e56b43]">■</span> rescue
          </span>
        </div>
        <div className="flex flex-wrap gap-[3px]">
          {epochs.length === 0 && <p className="text-[#4a4f5c] text-[11px]">no epochs recorded yet — the scanner writes one per run</p>}
          {epochs.map((e) => {
            const color = e.rescued > 0 ? "#e56b43" : e.exposures > 0 ? "#f5a623" : "#1c8f5f";
            return (
              <div
                key={e.n}
                title={`Epoch #${e.n} · scanned ${e.scanned} · ${e.rescued} rescued · ${e.exposures} exposed`}
                className="w-[11px] h-[11px] rounded-[2px]"
                style={{ backgroundColor: color, opacity: e.rescued > 0 || e.exposures > 0 ? 1 : 0.4 }}
              />
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-[#3a3e48] text-[10px] text-center">
        AEGIS · read-only console · a leaked key is a race — the agent just has to be faster
      </p>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className="text-right">
      <p className="text-[10px] uppercase tracking-widest text-[#6b7080]">{label}</p>
      <p className="font-bold tabular-nums text-sm" style={{ color: tone }}>
        {value} {sub && <span className="text-[10px] text-[#6b7080]">{sub}</span>}
      </p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-[#1a1d26] rounded-lg bg-[#0a0c11] px-4 py-3">
      <p className="text-[#f0f0f5] font-bold tracking-wide mb-2.5">{title}</p>
      {children}
    </div>
  );
}

function NetRow({ label, info, tone }: { label: string; info: NetInfo | null; tone: string }) {
  return (
    <div>
      <p className="text-[10px] tracking-widest" style={{ color: tone }}>
        {label}
      </p>
      <p className="text-[#c9ccd6] tabular-nums mt-0.5">
        {info ? fmt(info.balance ?? 0) : "—"} <span className="text-[10px] text-[#6b7080]">STRK bal</span>
      </p>
      <p className="text-[#6b7080] text-[10px] mt-0.5">
        rescued {info ? fmt(info.rescuedTotal) : "—"} · {info?.rescuedCount ?? 0} acct
      </p>
    </div>
  );
}

function BigNum({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="mb-2.5">
      <p className="font-bold tabular-nums leading-none" style={{ color: tone, fontSize: 30 }}>
        {value}
      </p>
      <p className="text-[#6b7080] text-[10px] uppercase tracking-widest mt-1">{label}</p>
    </div>
  );
}

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="mb-1.5">
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-[#6b7080]">{label}</span>
        <span className="text-[#c9ccd6] tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[#12151c] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: tone }} />
      </div>
    </div>
  );
}
