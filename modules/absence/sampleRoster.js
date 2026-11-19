/*
  An example roster, for a demo tenant that has not uploaded its own.

  Four Monday-to-Sunday weeks for a few hundred people, generated the same way
  every time from the tenant's own groupings: departments where the data has
  them, operational-load cohorts where it does not. A grouping with higher mean
  fatigue in the data gets more late closes, more six-day weeks and more split
  shifts, so the example shows the patterns the data already points to. No
  sector's shift names are written here.

  Every staff reference is synthetic. The screen labels this as an example, and
  so does the agent tool that reads it.
*/

const START = Date.UTC(2026, 10, 2); // Monday 2 November 2026
const WEEKS = 4;
const TARGET_STAFF = 240;

// Shift shapes as [start hour, start minute, length in minutes].
const EARLY = [6, 0, 8 * 60];
const DAY = [9, 0, 8 * 60];
const LATE = [14, 0, 8 * 60];
const CLOSE = [16, 30, 7 * 60];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, "0");
function stamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/*
  The groupings an example roster is built over: each with a label, a head
  count and its mean fatigue. Suppressed rows are skipped, since their counts
  are withheld.
*/
export function rosterGroups(portfolio) {
  const cohorts = portfolio?.cohorts || {};
  const rows = Array.isArray(cohorts.cohort_department) ? cohorts.cohort_department : cohorts.cohort_load || [];
  return rows
    .filter((r) => !r.suppressed && r.count > 0)
    .map((r) => ({ label: r.label, count: r.count, mean_fatigue: r.mean_fatigue ?? 50 }));
}

export function sampleRoster(groups, { seed = 7 } = {}) {
  const rand = mulberry32(seed);
  const total = groups.reduce((s, g) => s + g.count, 0) || 1;
  const fatigues = groups.map((g) => g.mean_fatigue);
  const lo = Math.min(...fatigues);
  const hi = Math.max(...fatigues);
  const shifts = [];
  let ref = 0;

  for (const g of groups) {
    const heat = hi > lo ? (g.mean_fatigue - lo) / (hi - lo) : 0.5; // 0 coolest, 1 hottest
    const people = Math.max(6, Math.round((g.count / total) * TARGET_STAFF));
    for (let n = 0; n < people; n++) {
      ref += 1;
      const staff = `S${String(ref).padStart(4, "0")}`;
      let pattern = null;
      for (let w = 0; w < WEEKS; w++) {
        // A person works one pattern for the week, as real rosters do. Hotter
        // groupings sit on late and closing patterns more often, work more
        // six-day weeks, and get swapped onto an opposite shift more often:
        // the swap is where a rest breach usually comes from.
        // Most people stay on last week's pattern; a change of pattern at the
        // week boundary is another place a short rest appears.
        const lateShare = 0.15 + 0.45 * heat;
        if (!pattern || rand() > 0.7) {
          const r = rand();
          pattern = r < lateShare / 2 ? CLOSE : r < lateShare ? LATE : r < lateShare + 0.3 ? EARLY : DAY;
        }
        const opposite = pattern === CLOSE || pattern === LATE ? EARLY : CLOSE;
        const sixDays = rand() < 0.05 + 0.3 * heat;
        const off = new Set();
        while (off.size < (sixDays ? 1 : 2)) off.add(Math.floor(rand() * 7));
        for (let d = 0; d < 7; d++) {
          if (off.has(d)) continue;
          const dayStart = START + (w * 7 + d) * 86400000;
          let segments;
          if (rand() < 0.005 + 0.03 * heat) {
            segments = [[10, 0, 4 * 60], [17, 0, 4 * 60]]; // a split day
          } else {
            const shape = rand() < 0.01 + 0.04 * heat ? opposite : pattern;
            // A six-day week runs shorter shifts to stay inside the ordinary
            // week; now and then a shift runs two hours over.
            const len = (sixDays ? 7.5 * 60 : shape[2]) + (rand() < 0.02 + 0.06 * heat ? 120 : 0);
            segments = [[shape[0], shape[1], len]];
          }
          for (const [h, m, len] of segments) {
            const s = dayStart + (h * 60 + m) * 60000;
            const e = s + len * 60000;
            const changedLate = rand() < 0.01 + 0.02 * heat;
            shifts.push({
              staff_ref: staff,
              department: g.label,
              start: stamp(s),
              end: stamp(e),
              published_at: stamp(s - 10 * 86400000),
              changed_at: changedLate ? stamp(s - 20 * 3600000) : null,
            });
          }
        }
      }
    }
  }
  return shifts;
}

// The example as a CSV, in the format the upload expects.
export function rosterToCsv(shifts) {
  const head = "staff_ref,department,start,end,published_at,changed_at";
  return [head, ...shifts.map((s) => [s.staff_ref, s.department, s.start, s.end, s.published_at || "", s.changed_at || ""].join(","))].join("\n");
}
