"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  CURRENCY_CODES,
  DEFAULT_CURRENCY,
  DEFAULT_RATE,
  SYMBOL,
  ZAR,
  conversionNote,
  conversionTag,
  currencyName,
  money as fmtMoney,
  moneyCompact as fmtMoneyCompact,
  normaliseCurrency,
} from "@/lib/platform/currency";

/*
  The currency toggle, and the leaf that renders an amount.

  Two problems shaped this.

  **Most screens that show money are server components.** A server component
  cannot read a React context, and converting four screens to client components
  to add a toggle would be a large change for a small feature. So the context
  lives here and `Money` is a client leaf: a server component renders
  `<Money zar={...} />` and the leaf does the converting. Server screens stay
  server screens.

  **The first paint has to match the server.** The chosen currency lives in
  browser storage, which the server cannot see, so rendering the stored
  currency on the first client pass would be a hydration mismatch. Every leaf
  renders Rand first, exactly as the server did, and switches after mount. A
  reader who has chosen dollars sees Rand for one frame, which is the honest
  cost of not reloading the page.

  Rand is the stored unit everywhere. Nothing here writes a converted figure
  back into anything.
*/

const CurrencyContext = createContext(null);

const STORAGE_KEY = "welo.currency.v1";

export function CurrencyProvider({ rate = DEFAULT_RATE, children }) {
  // Starts at the default so the first client render matches the server's.
  const [code, setCode] = useState(DEFAULT_CURRENCY);

  useEffect(() => {
    // Guarded: storage throws in a private window and returns nothing when the
    // visitor has cleared it, and an empty result is a normal outcome.
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setCode(normaliseCurrency(stored));
    } catch {
      /* the default stands */
    }
  }, []);

  const choose = useCallback((next) => {
    const c = normaliseCurrency(next);
    setCode(c);
    try {
      window.localStorage.setItem(STORAGE_KEY, c);
    } catch {
      /* the choice holds for this page either way */
    }
  }, []);

  const value = useMemo(
    () => ({
      code,
      rate,
      choose,
      symbol: SYMBOL[code],
      name: currencyName(code),
      money: (zar) => fmtMoney(zar, code, rate),
      moneyCompact: (zar) => fmtMoneyCompact(zar, code, rate),
      note: conversionNote(code, rate),
      tag: conversionTag(code, rate),
      converted: code !== ZAR,
    }),
    [code, rate, choose],
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

/*
  Falls back to Rand with the default rate rather than throwing when there is no
  provider. A money figure rendering in the source unit outside the shell is
  correct; a screen that crashes because a provider is missing is not.
*/
export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (ctx) return ctx;
  return {
    code: DEFAULT_CURRENCY,
    rate: DEFAULT_RATE,
    choose: () => {},
    symbol: SYMBOL[DEFAULT_CURRENCY],
    name: currencyName(DEFAULT_CURRENCY),
    money: (zar) => fmtMoney(zar, DEFAULT_CURRENCY, DEFAULT_RATE),
    moneyCompact: (zar) => fmtMoneyCompact(zar, DEFAULT_CURRENCY, DEFAULT_RATE),
    note: null,
    tag: null,
    converted: false,
  };
}

/*
  One amount. `zar` is always the Rand value, whatever is displayed.

  `compact` for a headline tile, the exact form otherwise. A suppressed cell
  passes `suppressed` and renders the small-cell marker instead, so a withheld
  figure cannot accidentally become a zero in either currency.
*/
export function Money({ zar, compact = false, suppressed = false, threshold = 5 }) {
  const { money, moneyCompact } = useCurrency();
  if (suppressed) return <>{`n<${threshold}`}</>;
  return <>{compact ? moneyCompact(zar) : money(zar)}</>;
}

/*
  The unit in words, for a tile's unit line: "Rand, indicative, annual" becomes
  "US dollars, indicative, annual". Its own leaf for the same reason as Money:
  a server screen can use it without becoming a client screen.
*/
export function CurrencyName() {
  const { name } = useCurrency();
  return <>{name}</>;
}

/*
  The toggle. Two buttons rather than a select: there are two currencies and a
  select hides the one you are not on.
*/
export function CurrencyToggle() {
  const { code, choose, rate, converted } = useCurrency();

  return (
    <span className="ccy-toggle" role="group" aria-label="Display currency">
      {CURRENCY_CODES.map((c) => (
        <button
          key={c}
          type="button"
          className={"ccy-btn" + (c === code ? " active" : "")}
          aria-pressed={c === code}
          onClick={() => choose(c)}
        >
          {c}
        </button>
      ))}
      {/* The rate and its date, wherever a converted figure is on screen.
          Shown next to the control rather than once at the bottom of a page,
          because the figure a reader copies might be anywhere on it. */}
      {converted ? (
        <span className="ccy-rate" title={`Rand per US dollar as at ${rate.asOf}`}>
          {rate.zarPerUsd}/USD · {rate.asOf}
        </span>
      ) : null}
    </span>
  );
}

/*
  What an agent panel says when the reader is viewing dollars.

  The agents are grounded on the same Rand figures the screens are, and they are
  not told the display rate. Two ways to close that gap were available: give the
  model the rate and ask it to convert, or say that it does not. Converting puts
  arithmetic in the one place in this product where a wrong number would be
  stated in confident prose, so the agent keeps reasoning in the stored unit and
  the panel says so. A reader who sees R and $ side by side and knows why is
  better served than one who sees two dollar figures that disagree.
*/
export function CurrencyAgentNote() {
  const { converted, rate } = useCurrency();
  if (!converted) return null;
  return (
    <div className="ccy-note">
      The agent reasons in Rand, the unit these figures are stored in, and is not given the
      display rate, so any amount in its answer is in Rand and is not converted. Divide by{" "}
      {rate.zarPerUsd} to compare it with a dollar figure on screen.
    </div>
  );
}

/*
  The long caveat, for the foot of a screen that shows money. Renders nothing in
  Rand, so a screen can include it unconditionally.
*/
export function CurrencyNote() {
  const { note } = useCurrency();
  if (!note) return null;
  // Its own class rather than `.indicative`: that one is uppercase mono at
  // 10.5px, which is right for three words and unreadable for three sentences.
  return <div className="ccy-note">{note}</div>;
}
