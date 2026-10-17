import { useEffect, useState, type ReactNode } from "react";
import {
  fetchNeoxaStatus,
  neoxaCancelOpenOrder,
  neoxaRunNow,
  saveNeoxaConfig,
  saveNeoxaSecrets,
  type BotMode,
  type NeoxaStatus,
} from "../api.js";

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-ink-900 border border-slate-800 rounded-lg p-4">
      <h3 className="text-xs font-semibold tracking-wider text-slate-300 uppercase mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink-900 border border-slate-800 rounded-lg p-3">
      <div className="text-[11px] tracking-wider text-slate-500 uppercase mb-1">{label}</div>
      <div className="text-lg font-semibold text-slate-200 font-mono">{value}</div>
    </div>
  );
}

const inputCls =
  "bg-ink-950 border border-slate-800 rounded px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-40";
const btnCls =
  "px-3 py-1.5 rounded text-sm font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50 border border-slate-700";

const fmtBtc = (n: number | undefined | null) => (n === undefined || n === null ? "-" : n.toFixed(8));

export function XbtTab() {
  const [status, setStatus] = useState<NeoxaStatus | undefined>(undefined);
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<BotMode>("DRY_RUN");
  const [budget, setBudget] = useState("0");
  const [chunk, setChunk] = useState("0.25");
  const [postOnly, setPostOnly] = useState(true);
  const [tiers, setTiers] = useState<Array<{ price: string; pct: string }>>([]);
  const [floatWarn, setFloatWarn] = useState("0.02");
  const [strategy, setStrategy] = useState<"DCA" | "TIERS">("DCA");
  const [intervalHours, setIntervalHours] = useState("6");
  const [candleInterval, setCandleInterval] = useState("4h");
  const [maPeriod, setMaPeriod] = useState("30");
  const [maxPrice, setMaxPrice] = useState("0");
  const [bands, setBands] = useState<Array<{ discountPct: string; chunks: string; budgetPct: string; intervalHours: string }>>([]);
  const [reset, setReset] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");

  async function reload(initial = false) {
    const s = await fetchNeoxaStatus();
    if (!s) return;
    setStatus(s);
    if (initial) {
      setEnabled(s.config.enabled);
      setMode(s.config.mode);
      setBudget(String(s.config.budgetBtc));
      setChunk(String(s.config.chunkXbt));
      setPostOnly(s.config.postOnly);
      setTiers(s.config.tiers.map((t) => ({ price: String(t.price), pct: String(t.pct) })));
      setFloatWarn(String(s.config.floatWarnBtc));
      setStrategy(s.config.strategy);
      setIntervalHours(String(s.config.dca.intervalHours));
      setCandleInterval(s.config.dca.candleInterval);
      setMaPeriod(String(s.config.dca.maPeriod));
      setMaxPrice(String(s.config.dca.maxPrice));
      setBands(
        s.config.dca.bands.map((b) => ({
          discountPct: String(b.discountPct),
          chunks: String(b.chunks),
          budgetPct: String(b.budgetPct),
          intervalHours: String(b.intervalHours ?? s.config.dca.intervalHours),
        }))
      );
      setLoaded(true);
    }
  }

  useEffect(() => {
    reload(true);
    const i = setInterval(() => reload(false), 10_000);
    return () => clearInterval(i);
  }, []);

  const parsedTiers = tiers.map((t) => ({ price: Number(t.price), pct: Number(t.pct) }));
  const pctSum = parsedTiers.reduce((s, t) => s + (Number.isFinite(t.pct) ? t.pct : 0), 0);
  const parsedBands = bands.map((b) => ({
    discountPct: Number(b.discountPct),
    chunks: Number(b.chunks),
    budgetPct: Number(b.budgetPct),
    intervalHours: Number(b.intervalHours),
  }));
  const bandPctSum = parsedBands.reduce((s, b) => s + (Number.isFinite(b.budgetPct) ? b.budgetPct : 0), 0);
  const tiersValid = parsedTiers.length > 0 && parsedTiers.every((t) => t.price > 0 && t.pct > 0) && pctSum <= 100.0001;
  const dcaValid =
    Number(intervalHours) >= 0.25 &&
    Number(maPeriod) >= 2 &&
    Number(maxPrice) >= 0 &&
    parsedBands.length > 0 &&
    parsedBands.every((b) => Number.isFinite(b.discountPct) && b.chunks >= 0 && b.budgetPct > 0 && b.budgetPct <= 100 && b.intervalHours >= 0.25);
  const valid = Number(budget) >= 0 && Number(chunk) > 0 && Number(floatWarn) >= 0 && (strategy === "DCA" ? dcaValid : tiersValid);

  async function save() {
    const r = await saveNeoxaConfig({
      enabled,
      mode,
      budgetBtc: Number(budget),
      chunkXbt: Number(chunk),
      postOnly,
      tiers: parsedTiers,
      strategy,
      floatWarnBtc: Number(floatWarn),
      dca: { intervalHours: Number(intervalHours), candleInterval, maPeriod: Number(maPeriod), maxPrice: Number(maxPrice), bands: parsedBands },
      resetCounters: reset,
    });
    setReset(false);
    setNote(r.ok ? "Saved." : `Not saved: ${r.error}`);
    reload(false);
  }

  async function saveKeys() {
    const r = await saveNeoxaSecrets(apiKey, apiSecret);
    if (r.ok) {
      setApiKey("");
      setApiSecret("");
    }
    setNote(r.ok ? "API key saved." : `Not saved: ${r.error}`);
    reload(false);
  }

  if (!status) return <div className="p-6 text-slate-500 text-sm">Loading...</div>;
  const t = status.ticker;

  return (
    <div className="space-y-6 p-6">
      {status.configured && status.float.low && (
        <div className="bg-amber-950/60 border border-amber-700 rounded-lg p-4 text-sm text-amber-200">
          <strong>Float low:</strong> only {fmtBtc(status.float.availableBtc)} BTC is available on Neoxa (warning level {status.float.warnBelowBtc} BTC). Deposit the
          next tranche of BTC on the Neoxa website so the bot can keep buying.
          {status.float.budgetRemainingBtc > 0
            ? ` Budget still to deploy: ${status.float.budgetRemainingBtc.toFixed(4)} BTC.`
            : " The configured budget is fully spent; raise Budget (and reset counters) before topping up."}
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="XBT/BTC last" value={t ? t.lastPrice.toFixed(8) : "-"} />
        <Stat label="Best bid / ask" value={t ? `${t.bestBid.toFixed(8)} / ${t.bestAsk.toFixed(8)}` : "-"} />
        <Stat label="BTC on Neoxa (available)" value={fmtBtc(status.balances?.BTC?.available)} />
        <Stat label="XBT on Neoxa" value={status.balances?.XBT ? status.balances.XBT.total.toFixed(4) : "-"} />
        <Stat label="Spent so far (BTC)" value={fmtBtc(status.state.spentBtc)} />
        <Stat label="Bought so far (XBT)" value={status.state.boughtXbt.toFixed(4)} />
        <Stat
          label="Open order"
          value={status.state.openOrderId ? `${status.state.openOrderQty} @ ${status.state.openOrderPrice}` : "none"}
        />
        <Stat label="Bot" value={status.config.enabled ? (status.config.mode === "LIVE" ? "RUNNING (live)" : "DRY RUN (no orders)") : "disabled"} />
      </div>

      <div className="bg-ink-900 border border-slate-800 rounded-lg p-4 text-sm text-slate-300 space-y-1">
        <div>
          last action: <span className="text-amber-400">{status.lastResult ? `${status.lastResult.action} - ${status.lastResult.detail}` : "none yet"}</span>
        </div>
        {status.error && <div className="text-rose-400">exchange error: {status.error}</div>}
        <div className="flex gap-2 pt-2">
          <button className={btnCls} onClick={() => neoxaRunNow().then(() => setTimeout(() => reload(false), 2000))}>
            Run now
          </button>
          <button
            className={btnCls}
            disabled={!status.state.openOrderId}
            onClick={() => neoxaCancelOpenOrder().then(() => setTimeout(() => reload(false), 1500))}
          >
            Cancel open order
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Accumulation settings">
          <div className="space-y-3 text-sm text-slate-400">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={enabled} disabled={!loaded} onChange={(e) => setEnabled(e.target.checked)} />
              Bot enabled
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={mode === "LIVE"} disabled={!loaded} onChange={(e) => setMode(e.target.checked ? "LIVE" : "DRY_RUN")} />
              Live trading (off = dry run: only reports what it would place)
            </label>
            <div className="flex items-center gap-2">
              <span className="w-44">Budget (BTC to deploy)</span>
              <input className={`${inputCls} w-36`} type="number" step="0.001" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-44">Warn when BTC float below</span>
              <input className={`${inputCls} w-36`} type="number" step="0.005" min="0" value={floatWarn} onChange={(e) => setFloatWarn(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-44">Order size (XBT)</span>
              <input className={`${inputCls} w-36`} type="number" step="0.05" min="0" value={chunk} onChange={(e) => setChunk(e.target.value)} />
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={postOnly} onChange={(e) => setPostOnly(e.target.checked)} />
              Maker-only orders (post-only, lower fee)
            </label>
            <div className="flex items-center gap-2">
              <span className="w-44">Strategy</span>
              <select className={`${inputCls} w-52`} value={strategy} onChange={(e) => setStrategy(e.target.value as "DCA" | "TIERS")}>
                <option value="DCA">Drawdown DCA (vs moving average)</option>
                <option value="TIERS">Fixed price tiers</option>
              </select>
            </div>
            {strategy === "DCA" && (
              <div className="space-y-2">
                <div className="text-xs text-slate-500">
                  Every interval the bot may buy N chunks, where N depends on how far the best ask is below the reference moving average of the exchange
                  candles. Each band can only spend its own share of the budget.
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-44">Interval (hours)</span>
                  <input className={`${inputCls} w-20`} type="number" step="0.5" min="0.25" value={intervalHours} onChange={(e) => setIntervalHours(e.target.value)} />
                  <span>MA</span>
                  <input className={`${inputCls} w-16`} type="number" step="1" min="2" value={maPeriod} onChange={(e) => setMaPeriod(e.target.value)} />
                  <span>x</span>
                  <select className={`${inputCls} w-20`} value={candleInterval} onChange={(e) => setCandleInterval(e.target.value)}>
                    <option value="1h">1h</option>
                    <option value="4h">4h</option>
                    <option value="1d">1d</option>
                  </select>
                  <span>candles</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-44">Max buy price (BTC, 0 = off)</span>
                  <input className={`${inputCls} w-36`} type="number" step="0.0001" min="0" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
                </div>
                <div className="text-xs text-slate-500">
                  Bands: discount below the MA (negative = above it), chunks per interval, the band's own interval (shorter at deeper discounts), and its share of the budget.
                </div>
                {bands.map((b, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-14">Band {i + 1}</span>
                    <input className={`${inputCls} w-16`} type="number" step="1" value={b.discountPct} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, discountPct: e.target.value } : x)))} />
                    <span>% below,</span>
                    <input className={`${inputCls} w-14`} type="number" step="1" min="0" value={b.chunks} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, chunks: e.target.value } : x)))} />
                    <span>chunks every</span>
                    <input className={`${inputCls} w-14`} type="number" step="0.5" min="0.25" value={b.intervalHours} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, intervalHours: e.target.value } : x)))} />
                    <span>h,</span>
                    <input className={`${inputCls} w-16`} type="number" step="5" min="0" value={b.budgetPct} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, budgetPct: e.target.value } : x)))} />
                    <span>%</span>
                    <button className="text-xs text-slate-500 hover:text-rose-400 px-1" disabled={bands.length <= 1} title="Remove this band" onClick={() => setBands(bands.filter((_, j) => j !== i))}>
                      remove
                    </button>
                  </div>
                ))}
                <button
                  className={btnCls}
                  disabled={bands.length >= 8}
                  onClick={() => setBands([...bands, { discountPct: "0", chunks: "1", budgetPct: "5", intervalHours: intervalHours }])}
                >
                  Add band
                </button>
                <div className={`text-xs ${bandPctSum > 100.0001 ? "text-amber-400" : "text-slate-600"}`}>
                  band shares total: {bandPctSum}%.{" "}
                  {bandPctSum > 100.0001
                    ? "Shares overlap (total above 100%): each band is limited to its own share, and the overall Budget above is the hard cap for all bands together."
                    : "Each band is limited to its share; the overall Budget is the hard cap."}
                </div>
              </div>
            )}
            {strategy === "TIERS" && (
            <div>
              <div className="text-xs text-slate-500 mb-1">
                Price tiers: a tier unlocks its share of the budget once the best ask is at or below its price.
              </div>
              {tiers.map((tier, i) => (
                <div key={i} className="flex items-center gap-2 mb-1">
                  <span className="w-14">Tier {i + 1}</span>
                  <input
                    className={`${inputCls} w-36`}
                    type="number"
                    step="0.0001"
                    value={tier.price}
                    onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                  />
                  <span>BTC</span>
                  <input
                    className={`${inputCls} w-20`}
                    type="number"
                    step="5"
                    value={tier.pct}
                    onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
                  />
                  <span>%</span>
                </div>
              ))}
              <div className={`text-xs ${pctSum > 100.0001 ? "text-rose-400" : "text-slate-600"}`}>percent total: {pctSum}</div>
            </div>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} />
              Reset spent / bought counters when saving (use after you top up the float)
            </label>
            <button className={btnCls} disabled={!valid || !loaded} onClick={save}>
              Save settings
            </button>
            {note && <p className="text-xs text-amber-400">{note}</p>}
          </div>
        </Card>

        <div className="space-y-4">
          {status.config.strategy === "DCA" && (
            <Card title="DCA status">
              <div className="text-xs text-slate-400 mb-2 space-y-0.5">
                <div>
                  Reference MA{status.config.dca.maPeriod} ({status.config.dca.candleInterval}):{" "}
                  <span className="font-mono text-slate-200">{status.dca.ma ? status.dca.ma.toFixed(8) : "-"}</span>
                  {status.dca.discountPct !== null && (
                    <span className={status.dca.discountPct >= 0 ? " text-emerald-400" : " text-slate-400"}>
                      {" "}
                      ask is {Math.abs(status.dca.discountPct).toFixed(1)}% {status.dca.discountPct >= 0 ? "below" : "above"}
                    </span>
                  )}
                </div>
                <div>
                  Active band chunks this interval: {status.dca.windowChunks.toFixed(2)}
                  {status.dca.nextWindowAt ? `; next interval starts ${new Date(status.dca.nextWindowAt).toLocaleTimeString()}` : ""}
                </div>
                <div className={status.dca.canBuyNow ? "text-emerald-400" : "text-amber-400"}>
                  {status.dca.canBuyNow ? "can buy now" : `waiting: ${status.dca.reason ?? "no data"}`}
                </div>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 text-xs">
                    <th className="py-1">Band</th>
                    <th>% below MA</th>
                    <th>Chunks</th>
                    <th>Spent / cap (BTC)</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {status.dca.bands.map((x) => (
                    <tr key={x.index} className="border-t border-slate-800/60 text-slate-300">
                      <td className="py-1">{x.index}</td>
                      <td>{x.discountPct}</td>
                      <td>
                        {x.chunks} / {x.intervalHours}h
                      </td>
                      <td className="font-mono">
                        {x.spentBtc.toFixed(5)} / {x.capBtc.toFixed(5)}
                      </td>
                      <td className={x.active ? "text-emerald-400" : "text-slate-500"}>{x.active ? "active" : x.capBtc <= 0 ? "no budget" : x.spentBtc >= x.capBtc - 1e-7 ? "used up" : "waiting"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {status.config.strategy === "TIERS" && (
          <Card title="Tier status (current ask)">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs">
                  <th className="py-1">Tier</th>
                  <th>Price</th>
                  <th>Share</th>
                  <th>Cumulative BTC</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {status.tiers.map((x) => (
                  <tr key={x.index} className="border-t border-slate-800/60 text-slate-300">
                    <td className="py-1">{x.index}</td>
                    <td className="font-mono">{x.price.toFixed(8)}</td>
                    <td>{x.pct}%</td>
                    <td className="font-mono">{x.cumulativeBtc.toFixed(6)}</td>
                    <td className={x.active ? "text-emerald-400" : "text-slate-500"}>
                      {x.active ? (status.nextTier === x.index ? "buying" : "active") : "waiting"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          )}

          <Card title="Neoxa API key (read + trade only)">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className={`inline-block w-2 h-2 rounded-full ${status.configured ? "bg-emerald-400" : "bg-slate-600"}`} />
                {status.configured ? "key configured" : "not configured"}
              </div>
              <input className={`${inputCls} w-full`} type="text" placeholder="API key (nex_...)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <input className={`${inputCls} w-full`} type="password" placeholder="API secret" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} />
              <button className={btnCls} disabled={!apiKey || !apiSecret} onClick={saveKeys}>
                Save API key
              </button>
              <p className="text-xs text-slate-600">
                Neoxa's API cannot deposit or withdraw: you move BTC in and XBT out on the website. Restrict the key to this
                machine's IP in Neoxa's key settings.
              </p>
            </div>
          </Card>
        </div>
      </div>

      <Card title="Recent orders">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 text-xs">
              <th className="py-1">Time</th>
              <th>Tier</th>
              <th>Price (BTC)</th>
              <th>Qty (XBT)</th>
              <th>Filled</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {status.recentOrders.map((o) => (
              <tr key={o.orderId} className="border-t border-slate-800/60 text-slate-300">
                <td className="py-1">{new Date(o.placedAt).toLocaleString()}</td>
                <td>{o.tier ?? "-"}</td>
                <td className="font-mono">{o.price.toFixed(8)}</td>
                <td className="font-mono">{o.quantity}</td>
                <td className="font-mono">{o.filled}</td>
                <td>{o.status}</td>
              </tr>
            ))}
            {status.recentOrders.length === 0 && (
              <tr>
                <td colSpan={6} className="py-2 text-slate-600">
                  no orders yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
