"use client";

import { useState, useEffect } from "react";

const WORKING_DAYS = 260; // US standard working days per year, please change if you want to

function fmtUSD(n) {
  if (!isFinite(n)) n = 0;
  return "$" + Math.round(n).toLocaleString("en-US");
}
function fmtUSDshort(n) {
  if (!isFinite(n)) n = 0;
  const a = Math.abs(n);
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return "$" + Math.round(n / 1e3) + "k";
  return "$" + Math.round(n).toLocaleString("en-US");
}

export default function RoiCalculator() {
  const [headcount, setHeadcount] = useState(500);
  const [salary, setSalary] = useState(65000);
  const [absence, setAbsence] = useState(4.2);
  const [reduction, setReduction] = useState(1.0);
  const [fee, setFee] = useState(12);
  const [months, setMonths] = useState(3);
  const [r, setR] = useState(null);

  function num(v) {
    return v === "" ? 0 : Number(v);
  }

  function calculate() {
    const hc = num(headcount);
    const sal = num(salary);
    const rate = num(absence) / 100;
    const cut = num(reduction) / 100;
    const f = num(fee);
    const mo = num(months);

    const costPerDay = sal / WORKING_DAYS;
    const annualCost = hc * (WORKING_DAYS * rate) * costPerDay;
    const payrollPct = sal > 0 ? (annualCost / (hc * sal)) * 100 : 0;

    const effCut = Math.min(cut, rate);
    const saving = hc * (WORKING_DAYS * effCut) * costPerDay;

    const pilotCost = hc * f * mo;
    const net = saving - pilotCost;
    const roi = pilotCost > 0 ? saving / pilotCost : 0;
    const payback = saving > 0 ? (pilotCost / saving) * 12 : 0;

    setR({ costPerDay, annualCost, payrollPct, saving, pilotCost, net, roi, payback });
  }

  // compute once on mount so the panel is not empty
  useEffect(() => {
    calculate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="roi">
      <style>{styles}</style>

      <div className="roi-eyebrow">Workforce Health Intelligence</div>
      <h1 className="roi-h1">
        What is absenteeism
        <br />
        costing your business?
      </h1>
      <p className="roi-lede">
        Estimate the annual cost of unplanned health absence across your workforce, and
        what a modest reduction is worth. Adjust the inputs to match your business, then
        calculate.
      </p>

      <div className="roi-grid">
        {/* INPUTS */}
        <div className="roi-card">
          <div className="roi-marker">01 / Your workforce</div>

          <div className="roi-field">
            <label className="roi-lbl">Headcount in scope</label>
            <div className="roi-inputbox">
              <input
                type="number"
                value={headcount}
                min={0}
                step={10}
                onChange={(e) => setHeadcount(e.target.value === "" ? "" : Number(e.target.value))}
              />
              <span className="roi-sfx">people</span>
            </div>
          </div>

          <div className="roi-field">
            <label className="roi-lbl">Average annual salary</label>
            <div className="roi-inputbox">
              <span className="roi-pfx">$</span>
              <input
                type="number"
                value={salary}
                min={0}
                step={1000}
                onChange={(e) => setSalary(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </div>
            <div className="roi-hint">Total cost of employment, per employee.</div>
          </div>

          <div className="roi-field">
            <div className="roi-rangerow">
              <label className="roi-lbl">Current absence rate</label>
              <span className="roi-rangeval">{Number(absence).toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={0.1}
              value={absence}
              onChange={(e) => setAbsence(Number(e.target.value))}
            />
            <div className="roi-hint">Share of working days lost to unplanned health absence.</div>
          </div>

          <div className="roi-marker" style={{ marginTop: 26 }}>
            02 / The intervention
          </div>

          <div className="roi-field">
            <div className="roi-rangerow">
              <label className="roi-lbl">Targeted reduction</label>
              <span className="roi-rangeval">{Number(reduction).toFixed(1)} pts</span>
            </div>
            <input
              type="range"
              min={0.2}
              max={3}
              step={0.1}
              value={reduction}
              onChange={(e) => setReduction(Number(e.target.value))}
            />
          </div>

          <div className="roi-field">
            <label className="roi-lbl">Pilot fee</label>
            <div className="roi-inputbox">
              <span className="roi-pfx">$</span>
              <input
                type="number"
                value={fee}
                min={0}
                step={1}
                onChange={(e) => setFee(e.target.value === "" ? "" : Number(e.target.value))}
              />
              <span className="roi-sfx">/ emp / mo</span>
            </div>
          </div>

          <div className="roi-field">
            <div className="roi-rangerow">
              <label className="roi-lbl">Pilot length</label>
              <span className="roi-rangeval">{months} months</span>
            </div>
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
            />
          </div>

          <button className="roi-btn" onClick={calculate}>
            Calculate my number
          </button>
        </div>

        {/* RESULTS */}
        <div>
          <div className="roi-resulthead">
            <h2>Your modelled result</h2>
            <span className="roi-pill">Projected · not yet measured</span>
          </div>

          <div className="roi-bigstat">
            <div className="roi-k">Estimated annual cost of absence</div>
            <div className="roi-v">{r ? fmtUSDshort(r.annualCost) : "$0"}</div>
            <div className="roi-s">
              {r
                ? `Roughly ${r.payrollPct.toFixed(1)}% of payroll · ${fmtUSD(r.costPerDay)} per absent day`
                : "\u00A0"}
            </div>
          </div>

          <div className="roi-savecard">
            <div className="roi-k">Projected annual saving</div>
            <div className="roi-v">{r ? fmtUSDshort(r.saving) : "$0"}</div>
            <div className="roi-s">
              {r ? `From a ${Number(reduction).toFixed(1)}-point reduction in absence rate.` : "\u00A0"}
            </div>
          </div>

          <div className="roi-statgrid">
            <div className="roi-stat">
              <div className="roi-k">Pilot cost</div>
              <div className="roi-statv">{r ? fmtUSDshort(r.pilotCost) : "$0"}</div>
              <div className="roi-statS">{months} months</div>
            </div>
            <div className="roi-stat">
              <div className="roi-k">Net first-year</div>
              <div className={"roi-statv " + (r && r.net < 0 ? "roi-neg" : "roi-pos")}>
                {r ? fmtUSDshort(r.net) : "$0"}
              </div>
              <div className="roi-statS">saving less pilot</div>
            </div>
            <div className="roi-stat">
              <div className="roi-k">Return on pilot</div>
              <div className="roi-statv">{r ? r.roi.toFixed(1) : "0.0"}&times;</div>
              <div className="roi-statS">saving / pilot cost</div>
            </div>
            <div className="roi-stat">
              <div className="roi-k">Payback</div>
              <div className="roi-statv">{r && r.payback > 0 ? r.payback.toFixed(1) : "\u2013"}</div>
              <div className="roi-statS">months</div>
            </div>
          </div>

          <div className="roi-takeaway">
            {r && r.roi >= 1 ? (
              <>
                At these inputs, a{" "}
                <strong>{Number(reduction).toFixed(1)}-point reduction</strong> in absence more
                than covers the cost of the pilot.
              </>
            ) : (
              <>
                At these inputs the saving does not yet cover the pilot. Try a longer horizon or a
                larger targeted reduction to find the break-even point.
              </>
            )}
          </div>
        </div>
      </div>

      <div className="roi-disclaimer">
        Modelled estimate based on the figures you enter, using a 260 working-day year. Actual
        outcomes vary by workforce.
      </div>
    </div>
  );
}

const styles = `
  .roi {
    --paper:#FAF6EF; --card:#FFFFFF; --ink:#1A1714; --body:#57514B; --muted:#8A827A;
    --brick:#BB3D2E; --brick-dark:#9A3124; --green:#2E7D55; --line:#ECE5DA; --wash:#F4EEE4;
    --pill:#FCEDDD; --pill-ink:#9A5A1E;
    --sans:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    --mono:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace;
    font-family:var(--sans); color:var(--ink); max-width:1080px; margin:0 auto;
    padding:40px 22px 64px; line-height:1.5; -webkit-font-smoothing:antialiased;
  }
  .roi * { box-sizing:border-box; }
  .roi-eyebrow { display:flex; align-items:center; gap:9px; font-size:13px; font-weight:600;
    letter-spacing:.14em; text-transform:uppercase; color:var(--brick); margin-bottom:16px; }
  .roi-eyebrow::before { content:""; width:8px; height:8px; border-radius:50%; background:var(--brick); }
  .roi-h1 { font-size:40px; line-height:1.08; letter-spacing:-.02em; font-weight:700; }
  .roi-lede { color:var(--body); font-size:17px; line-height:1.6; margin-top:16px; max-width:620px; }
  .roi-grid { display:grid; grid-template-columns:minmax(300px,.95fr) minmax(320px,1.1fr);
    gap:22px; align-items:start; margin-top:36px; }
  @media (max-width:820px){ .roi-grid{ grid-template-columns:1fr; } .roi-h1{ font-size:32px; } }
  .roi-card { background:var(--card); border:1px solid var(--line); border-radius:16px;
    padding:28px 26px; box-shadow:0 1px 2px rgba(26,23,20,.03),0 8px 24px rgba(26,23,20,.04); }
  .roi-marker { font-family:var(--mono); font-size:12px; color:var(--brick); letter-spacing:.08em; margin-bottom:18px; }
  .roi-field { margin-bottom:22px; }
  .roi-field:last-of-type { margin-bottom:0; }
  .roi-lbl { display:block; font-family:var(--mono); font-size:11px; letter-spacing:.07em;
    text-transform:uppercase; color:var(--muted); margin-bottom:8px; }
  .roi-inputbox { display:flex; align-items:center; border:1px solid var(--line); border-radius:11px;
    background:var(--card); transition:border-color .15s; }
  .roi-inputbox:focus-within { border-color:var(--brick); }
  .roi-pfx { padding-left:14px; color:var(--muted); font-size:15px; }
  .roi-sfx { padding-right:14px; color:var(--muted); font-size:13px; }
  .roi-inputbox input { flex:1; border:none; outline:none; background:transparent; padding:13px 14px;
    font-size:16px; color:var(--ink); font-family:var(--sans); width:100%; }
  .roi-hint { font-size:12.5px; color:var(--muted); margin-top:7px; line-height:1.45; }
  .roi input[type=range] { width:100%; accent-color:var(--brick); margin-top:6px; }
  .roi-rangerow { display:flex; justify-content:space-between; align-items:baseline; }
  .roi-rangeval { font-family:var(--mono); font-size:13px; color:var(--ink); }
  .roi-btn { appearance:none; border:none; cursor:pointer; background:var(--brick); color:#fff;
    font-family:var(--sans); font-size:15px; font-weight:600; padding:14px 22px; border-radius:11px;
    margin-top:22px; width:100%; transition:background .15s; }
  .roi-btn:hover { background:var(--brick-dark); }
  .roi-pill { font-family:var(--mono); font-size:11px; background:var(--pill); color:var(--pill-ink);
    padding:5px 11px; border-radius:999px; white-space:nowrap; }
  .roi-resulthead { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; }
  .roi-resulthead h2 { font-size:16px; font-weight:700; }
  .roi-bigstat { background:var(--ink); border-radius:13px; padding:22px; color:#F2ECE3; }
  .roi-bigstat .roi-k { color:#B7A99A; }
  .roi-bigstat .roi-v { font-size:36px; font-weight:700; letter-spacing:-.01em; }
  .roi-bigstat .roi-s { font-size:13px; color:#B7A99A; margin-top:7px; }
  .roi-k { font-family:var(--mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase;
    color:var(--muted); margin-bottom:8px; }
  .roi-savecard { border:2px solid var(--brick); border-radius:13px; padding:22px; margin-top:14px; }
  .roi-savecard .roi-k { color:var(--brick-dark); }
  .roi-savecard .roi-v { font-size:36px; font-weight:700; color:var(--brick-dark); letter-spacing:-.01em; }
  .roi-savecard .roi-s { font-size:13px; color:var(--muted); margin-top:7px; }
  .roi-statgrid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:14px; }
  .roi-stat { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; }
  .roi-stat .roi-k { font-size:10px; margin-bottom:6px; }
  .roi-statv { font-size:23px; font-weight:700; letter-spacing:-.01em; }
  .roi-statS { font-size:11px; color:var(--muted); margin-top:4px; }
  .roi-pos { color:var(--green); }
  .roi-neg { color:var(--brick); }
  .roi-takeaway { background:var(--wash); border:1px solid var(--line); border-radius:12px;
    padding:16px 18px; margin-top:14px; font-size:14px; line-height:1.55; color:var(--ink); }
  .roi-takeaway strong { color:var(--brick-dark); }
  .roi-disclaimer { margin-top:28px; padding-top:18px; border-top:1px solid var(--line);
    font-size:12px; line-height:1.6; color:var(--muted); max-width:780px; }
`;
