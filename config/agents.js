// Welo dashboard agent client.
//
// The dashboard's AI agents (Analyst, Case Assistant, Cover Coordinator) are
// powered by the Anthropic Messages API. The API key MUST stay server-side, so
// this browser client never holds it: it talks to the Welo agent proxy (the
// welo_inference FastAPI service, see model/welo_inference/agents.py), which
// holds the key and calls Anthropic.
//
// Wiring the proxy in:
//   index.html?api=https://welo-inference-xxxx.run.app     (per-link), or
//   set window.WELO_API_BASE = "https://..." before this file loads.
//
// With no proxy configured, or if the proxy is unreachable, every call falls
// back to a built-in, non-AI summary so the shareable static build still works
// in a meeting or a screenshot. Nothing here breaks offline.

(function () {
  var params = new URLSearchParams(location.search);
  var base = (params.get('api') || window.WELO_API_BASE || '').replace(/\/+$/, '');

  var state = { base: base, available: false, model: null, agents: [], checked: false };

  function url(path) { return base + path; }
  function safeParse(s) { try { return JSON.parse(s); } catch (e) { return {}; } }

  // Probe the proxy once. Resolves to the state object either way.
  function status() {
    if (!base) { state.checked = true; return Promise.resolve(state); }
    return fetch(url('/agents'))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j) { state.available = !!j.available; state.model = j.model; state.agents = j.agents || []; }
        state.checked = true;
        return state;
      })
      .catch(function () { state.checked = true; return state; });
  }

  function runFallback(agent, question, data, handlers) {
    var fb = window.WeloAgents.fallback;
    var msg = (fb[agent] || fb._default)(question, data);
    if (handlers.onToken) handlers.onToken(msg);
    if (handlers.onDone) handlers.onDone(msg, { fallback: true });
  }

  // Stream an agent answer. handlers: onToken(text), onDone(fullText, meta),
  // onError(err). Returns an abort function. Falls back to a built-in summary
  // when the proxy is absent, not ready, or errors mid-flight.
  function ask(agent, question, data, handlers) {
    handlers = handlers || {};
    if (!base || !state.available) { runFallback(agent, question, data, handlers); return function () {}; }

    var ctrl = new AbortController();
    var full = '';
    var started = false;

    fetch(url('/agents/' + agent + '/stream'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question, data: data }),
      signal: ctrl.signal,
    }).then(function (resp) {
      if (!resp.ok || !resp.body) throw new Error('agent http ' + resp.status);
      var reader = resp.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      function pump() {
        return reader.read().then(function (res) {
          if (res.done) { if (handlers.onDone) handlers.onDone(full, {}); return; }
          buf += dec.decode(res.value, { stream: true });
          var frames = buf.split('\n\n');
          buf = frames.pop();
          for (var i = 0; i < frames.length; i++) {
            var ev = 'message', dataLine = '';
            frames[i].split('\n').forEach(function (line) {
              if (line.indexOf('event:') === 0) ev = line.slice(6).trim();
              else if (line.indexOf('data:') === 0) dataLine += line.slice(5).trim();
            });
            if (ev === 'error') { throw new Error(safeParse(dataLine).error || 'agent error'); }
            if (ev === 'done') { continue; }
            var payload = safeParse(dataLine);
            if (payload && payload.text) {
              started = true;
              full += payload.text;
              if (handlers.onToken) handlers.onToken(payload.text);
            }
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      // If tokens already streamed, surface the error; otherwise fall back
      // silently to the offline summary so the demo never dead-ends.
      if (started) { if (handlers.onError) handlers.onError(err); }
      else { runFallback(agent, question, data, handlers); }
    });

    return function () { ctrl.abort(); };
  }

  window.WeloAgents = { status: status, ask: ask, state: state, fallback: {} };

  // -- Offline fallbacks -------------------------------------------------------
  // Deterministic, data-driven summaries used when no live agent is configured.
  // They read the same grounding object the live agents receive, so the shape
  // of the output matches and the panel looks the same either way.
  var F = window.WeloAgents.fallback;

  function fmtDays(n) { return (Math.round(n * 10) / 10) + ' days'; }

  F.case = function (q, d) {
    d = d || {};
    var drivers = (d.drivers || []).slice(0, 3);
    var lines = [];
    lines.push('Support plan (built-in summary, no live AI configured)');
    lines.push('');
    lines.push('Risk band: ' + (d.risk_band || 'n/a') + '. Fatigue score ' +
      (d.fatigue_burnout_score != null ? Math.round(d.fatigue_burnout_score) : 'n/a') +
      ' (' + (d.fatigue_band || 'n/a') + '). Predicted ' +
      (d.predicted_absent_days_90d != null ? fmtDays(d.predicted_absent_days_90d) : 'n/a') + ' absent over 90 days.');
    lines.push('');
    if (drivers.length) {
      lines.push('Act on the leading drivers:');
      drivers.forEach(function (dr, i) {
        lines.push((i + 1) + '. ' + (dr.label || 'driver') +
          (dr.value != null ? ' (' + dr.value + ')' : (dr.shap_hours != null ? ' (+' + dr.shap_hours + ' h)' : '')) +
          ': schedule an occupational-health touchpoint and, where relevant, a medical-programme referral via existing medical aid.');
      });
    } else {
      lines.push('No elevated drivers: keep under routine monitoring.');
    }
    lines.push('');
    lines.push('Framing: screening signals for a qualified OH team, not a diagnosis. Synthetic record.');
    return lines.join('\n');
  };

  function rand(n) {
    if (n == null) return 'n/a';
    n = Math.round(n);
    if (n >= 1e6) return 'R ' + (n / 1e6).toFixed(1) + 'm';
    if (n >= 1e3) return 'R ' + Math.round(n / 1e3) + 'k';
    return 'R ' + n;
  }
  function pct(x) { return x == null ? 'n/a' : Math.round(x * 100) + '%'; }

  F.analyst = function (q, d) {
    d = d || {};
    var lines = ['Portfolio read (built-in summary, no live AI configured)', ''];
    lines.push((d.covered_lives != null ? d.covered_lives.toLocaleString() : 'The') +
      ' covered lives, ' + (d.predicted_absent_days_90d != null ? Math.round(d.predicted_absent_days_90d).toLocaleString() : 'n/a') +
      ' predicted absent days over 90 days, ' + rand(d.cost_exposure_rand_90d) + ' cost exposure. ' +
      pct(d.fatigue_high_or_critical_share) + ' sit in the high or critical fatigue band.');
    // find the single cohort with the highest high/critical concentration
    var best = null, bestLens = null;
    Object.keys(d.cohorts_by_lens || {}).forEach(function (lens) {
      (d.cohorts_by_lens[lens] || []).forEach(function (c) {
        if (!best || (c.high_or_critical_share || 0) > (best.high_or_critical_share || 0)) { best = c; bestLens = lens; }
      });
    });
    if (best) {
      lines.push('');
      lines.push('Where to start: the "' + best.cohort + '" cohort (' + bestLens + ' lens) carries the ' +
        'highest concentration at ' + pct(best.high_or_critical_share) + ' high or critical, ' +
        best.absent_days_per_head_annual + ' days per head per year, ' + rand(best.cost_exposure_rand) + ' exposure. ' +
        'Target it first for the highest return.');
    }
    lines.push('');
    lines.push('Addressable saving across the workforce: ' + rand(d.addressable_saving_rand) + '.');
    lines.push('');
    lines.push('Configure a Welo agent endpoint (?api=...) to ask open questions of this data.');
    return lines.join('\n');
  };

  F.coordinator = function (q, d) {
    d = d || {};
    var hh = d.headline || {}, cov = d.cover || {}, fr = d.frequency || {}, rtw = d.return_to_work || {};
    var lines = ['Cover and roster read (built-in summary, no live AI configured)', ''];
    var rate = hh.absence_rate != null ? (hh.absence_rate * 100).toFixed(1) + '%' : 'n/a';
    lines.push('Predicted absence rate ' + rate + '. Next 90 days: ' +
      (hh.cover_gap_days_90d != null ? Math.round(hh.cover_gap_days_90d).toLocaleString() : 'n/a') +
      ' cover-gap days needing backfill, ' + rand(hh.backfill_cost_rand_90d) + ' backfill cost, ' +
      (hh.rtw_caseload != null ? hh.rtw_caseload.toLocaleString() : 'n/a') + ' in the return-to-work caseload.');
    // heaviest cover-gap cohort
    var cohorts = d.by_cohort || [];
    var hot = cohorts.slice().sort(function (a, b) { return (b.cover_gap_days_90d || 0) - (a.cover_gap_days_90d || 0); })[0];
    if (hot) {
      lines.push('');
      lines.push('Gap lands hardest on "' + hot.label + '": ' + Math.round(hot.cover_gap_days_90d || 0).toLocaleString() +
        ' cover-gap days, ' + rand(hot.backfill_cost_rand_90d) + ' backfill, ' + (hot.overtime_mean_14d || 'n/a') +
        'h mean overtime per 14 days. Build a relief buffer here first and cap overtime before it compounds.');
    }
    if (fr.trigger_count != null) {
      lines.push('');
      lines.push(fr.trigger_count.toLocaleString() + ' people hit the frequency trigger (4+ spells / year): route to return-to-work interviews.');
    }
    lines.push('');
    lines.push('Configure a Welo agent endpoint (?api=...) for live rostering recommendations.');
    return lines.join('\n');
  };

  F._default = function (q, d) {
    return 'No live agent configured. Add ?api=<welo-inference-url> to enable ' +
      'the Anthropic-powered agents.';
  };
})();
