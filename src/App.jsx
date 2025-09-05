import { useEffect, useMemo, useRef, useState } from "react";
import { ResponsiveContainer, LineChart, Line, Tooltip as RTooltip, PieChart, Pie, Cell } from "recharts";

/**
 * Mobile-first National Debt UI (GitHub Pages-friendly)
 * - Fetches live data from Treasury Fiscal Data API (Debt to the Penny)
 * - Big current debt banner with compact/expanded & optional real-time ticking
 * - Mini deltas (per sec/min/hr/day)
 * - KPI cards: per-capita, per-taxpayer, debt-to-GDP (mock), est. interest (mock)
 * - 30-day sparkline, donut of debt composition (public vs. intragov)
 * - Toggle controls to demo different views
 */

const API_BASE =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny";

// ----- Demo assumptions / constants (adjust as desired) -----
const US_POPULATION = 335_000_000; // rough pop for per-capita demo
const US_TAXPAYERS = 168_000_000; // rough filers for per-taxpayer demo
const MOCK_DEBT_TO_GDP = 1.25; // 125% mock (you can replace with BEA GDP data)
const MOCK_EST_INTEREST_ANNUAL = 0.79 * 1_000_000_000_000; // ~$0.79T mock

function formatCurrency(n, { compact }) {
  if (n == null || isNaN(n)) return "—";
  if (compact) return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function formatNumber(n) {
  return new Intl.NumberFormat("en-US").format(n);
}

function useDebtData() {
  const [latest, setLatest] = useState(null); // { record_date, debt_held_public_amt, intragov_hold_amt, tot_pub_debt_out_amt }
  const [lastDay, setLastDay] = useState(null); // previous day
  const [trend, setTrend] = useState([]); // 30 entries for sparkline
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      try {
        setLoading(true);
        setError(null);

        // Latest day
        const latestUrl = `${API_BASE}?sort=-record_date&format=json&page[number]=1&page[size]=1`;
        // Previous day (for delta calc)
        const prevUrl = `${API_BASE}?sort=-record_date&format=json&page[number]=2&page[size]=1`;
        // Last 30 days for sparkline
        const last30Url = `${API_BASE}?sort=-record_date&format=json&page[size]=30`;

        const [r1, r2, r3] = await Promise.all([
          fetch(latestUrl),
          fetch(prevUrl),
          fetch(last30Url),
        ]);
        if (!r1.ok || !r2.ok || !r3.ok) throw new Error("Treasury API request failed");

        const j1 = await r1.json();
        const j2 = await r2.json();
        const j3 = await r3.json();

        const L = j1?.data?.[0];
        const P = j2?.data?.[0];
        const T = (j3?.data || [])
          .map(d => ({
            date: d.record_date,
            value: Number(d.tot_pub_debt_out_amt),
          }))
          .reverse(); // ascending for chart

        if (!cancelled) {
          setLatest(L);
          setLastDay(P);
          setTrend(T);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message || String(e));
          setLoading(false);
        }
      }
    }
    fetchAll();
    return () => {
      cancelled = true;
    };
  }, []);

  return { latest, lastDay, trend, loading, error };
}

export default function DebtApp() {
  const { latest, lastDay, trend, loading, error } = useDebtData();

  // UI Toggles
  const [compact, setCompact] = useState(true);
  const [showDeltas, setShowDeltas] = useState(true);
  const [tickerOn, setTickerOn] = useState(true);

  // Parse live numbers
  const totalDebt = useMemo(() => Number(latest?.tot_pub_debt_out_amt) || null, [latest]);
  const publicDebt = useMemo(() => Number(latest?.debt_held_public_amt) || null, [latest]);
  const intragovDebt = useMemo(() => Number(latest?.intragov_hold_amt) || null, [latest]);
  const prevTotalDebt = useMemo(() => Number(lastDay?.tot_pub_debt_out_amt) || null, [lastDay]);

  // Daily change and per-second slope (used for local ticking)
  const dailyChange = useMemo(() => (totalDebt && prevTotalDebt ? totalDebt - prevTotalDebt : 0), [totalDebt, prevTotalDebt]);
  const perSecond = useMemo(() => dailyChange / 86400, [dailyChange]);

  // Local ticker state (client-side smooth increment based on perSecond)
  const [tickDebt, setTickDebt] = useState(null);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);

  useEffect(() => {
    // Reset ticker anchor when new data arrives
    if (totalDebt != null) setTickDebt(totalDebt);
  }, [totalDebt]);

  useEffect(() => {
    if (!tickerOn || tickDebt == null) return;

    function step(ts) {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000; // seconds
      lastTsRef.current = ts;
      setTickDebt(d => (d == null ? null : d + perSecond * dt));
      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tickerOn, perSecond, tickDebt]);

  const displayDebt = tickerOn && tickDebt != null ? tickDebt : totalDebt;

  // KPI calcs (per-capita/per-taxpayer derived live)
  const perCapita = displayDebt != null ? displayDebt / US_POPULATION : null;
  const perTaxpayer = displayDebt != null ? displayDebt / US_TAXPAYERS : null;

  // Mini-deltas from perSecond baseline
  const deltaSec = perSecond;
  const deltaMin = perSecond * 60;
  const deltaHr = perSecond * 3600;
  const deltaDay = perSecond * 86400;

  // Donut data from latest composition
  const donutData = useMemo(() => (
    [
      { name: "Public", value: publicDebt || 0 },
      { name: "Intragovernmental", value: intragovDebt || 0 },
    ]
  ), [publicDebt, intragovDebt]);

  const COLORS = ["#2563eb", "#10b981"]; // blue, green

  return (
    <div className="min-h-screen bg-gray-50 p-4 max-w-md mx-auto">
      {/* Header / Toggles */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-lg font-semibold text-gray-800">National Debt</h1>
        <div className="flex gap-2">
          <button
            className={`px-3 py-1 rounded-full text-sm border ${compact ? "bg-gray-900 text-white" : "bg-white"}`}
            onClick={() => setCompact(v => !v)}
          >
            {compact ? "Compact" : "Expanded"}
          </button>
          <button
            className={`px-3 py-1 rounded-full text-sm border ${tickerOn ? "bg-gray-900 text-white" : "bg-white"}`}
            onClick={() => setTickerOn(v => !v)}
          >
            {tickerOn ? "Ticker On" : "Ticker Off"}
          </button>
        </div>
      </div>

      {/* Banner */}
      <div className="bg-white rounded-2xl shadow p-4">
        <p className="text-sm text-gray-500">Current National Debt{latest?.record_date ? ` • ${latest.record_date}` : ""}</p>
        <div className="mt-1 flex items-end gap-2">
          <div className="text-3xl font-extrabold text-red-600 tabular-nums">
            {loading ? "Loading…" : error ? "—" : formatCurrency(displayDebt, { compact })}
          </div>
        </div>
        {showDeltas && (
          <div className="mt-2 grid grid-cols-4 gap-2 text-center">
            <MiniDelta label="/sec" value={deltaSec} compact={compact} />
            <MiniDelta label="/min" value={deltaMin} compact={compact} />
            <MiniDelta label="/hr" value={deltaHr} compact={compact} />
            <MiniDelta label="/day" value={deltaDay} compact={compact} />
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <button
            className={`px-3 py-1 rounded-md text-sm border ${showDeltas ? "bg-gray-900 text-white" : "bg-white"}`}
            onClick={() => setShowDeltas(v => !v)}
          >
            {showDeltas ? "Hide Deltas" : "Show Deltas"}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <KPI label="Per Capita" value={perCapita} compact={compact} prefix="$" />
        <KPI label="Per Taxpayer" value={perTaxpayer} compact={compact} prefix="$" />
        <KPI label="Debt-to-GDP" value={MOCK_DEBT_TO_GDP * 100} suffix="%" decimals={0} />
        <KPI label="Est. Interest (yr)" value={MOCK_EST_INTEREST_ANNUAL} compact={compact} prefix="$" />
      </div>

      {/* 30-day Sparkline */}
      <div className="mt-4 bg-white rounded-2xl shadow p-3">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-gray-700">30-Day Trend</h2>
          <span className="text-xs text-gray-500">mock smoothing</span>
        </div>
        <div className="h-24">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ left: 0, right: 0, top: 5, bottom: 0 }}>
              <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={false} />
              <RTooltip formatter={(v) => formatCurrency(v, { compact: false })} labelFormatter={(l) => `Date: ${l}`} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Donut: Composition */}
      <div className="mt-4 bg-white rounded-2xl shadow p-3">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Debt Composition</h2>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                {donutData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <RTooltip formatter={(v, n) => [formatCurrency(v, { compact: false }), n]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 grid grid-cols-2 text-sm">
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: COLORS[0] }} /> Public</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: COLORS[1] }} /> Intragov</div>
        </div>
      </div>

      {/* Footer / Error */}
      {error && (
        <div className="mt-4 text-center text-sm text-red-600">
          Failed to load Treasury data: {error}
        </div>
      )}
      <div className="h-8" />
    </div>
  );
}

function KPI({ label, value, compact, prefix = "", suffix = "", decimals = 0 }) {
  const display = value == null ? "—" : compact
    ? `${prefix}${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value)}${suffix}`
    : `${prefix}${new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(value)}${suffix}`;
  return (
    <div className="bg-white rounded-xl shadow p-3 text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-800 tabular-nums">{display}</p>
    </div>
  );
}

function MiniDelta({ label, value, compact }) {
  const positive = (value || 0) >= 0;
  const sign = positive ? "+" : "−";
  const abs = Math.abs(value || 0);
  const display = compact ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(abs)
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(abs);
  return (
    <div className="rounded-lg bg-gray-100 py-2">
      <div className={`text-xs ${positive ? "text-emerald-600" : "text-red-600"}`}>{sign}{display}</div>
      <div className="text-[10px] text-gray-500">{label}</div>
    </div>
  );
}
