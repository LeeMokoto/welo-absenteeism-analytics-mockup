/*
  Roster checks.

  A roster is where fatigue is designed in or designed out, before anyone is
  short of sleep. These checks read a roster and count, by department, the
  shifts and the people that break a rest rule or a fatigue rule. They are the
  same rules for everyone on the roster, which is the point: a roster check is
  about how work is arranged, not about any one person's health, so nothing
  here reads or needs health data.

  Two kinds of rule, kept apart because they carry different weight:

  - **Legal minimums.** South Africa's Basic Conditions of Employment Act,
    section 15, and Sectoral Determination 14 (Hospitality), clause 17, require
    a daily rest of at least 12 consecutive hours between ending and starting
    work, and a weekly rest of at least 36 consecutive hours. The Act and the
    determination limit ordinary hours to 45 a week; rostered hours above that
    are overtime, which needs agreement and has its own limits. Written
    agreements can vary some of these (live-in staff with a long meal interval,
    a 60-hour rest every second week), so a breach here is a flag to check, not
    a finding of non-compliance. This is not legal advice.
  - **Fatigue policy.** A late close followed by an early open, split shifts,
    runs of late finishes, and changes made at short notice. None is unlawful
    in itself; each is a known driver of fatigue and absence. The thresholds
    are a starting policy a tenant can change.

  What leaves this file is counts by department. No staff reference is
  returned, and a department with fewer people on the roster than the
  suppression threshold reports no figures, the same rule the cohorts follow.

  Times are read as written, without a time zone: "2026-11-06T22:00" is ten at
  night wherever the check runs, so a browser's clock cannot move a shift.

  Pure and synchronous, so the screen, the agent tool and the tests share it.
*/

export const SUPPRESSION_THRESHOLD = 5;

export const DEFAULT_POLICY = {
  daily_rest_hours: 12,
  weekly_rest_hours: 36,
  weekly_ordinary_hours: 45,
  late_finish_hour: 22,
  early_start_hour: 9,
  split_gap_hours: 2,
  late_run_length: 3,
  short_notice_hours: 48,
};

export const RULES = [
  {
    key: "daily_rest",
    kind: "legal",
    label: "Daily rest under 12 hours",
    source: "BCEA s15(1)(a); Sectoral Determination 14, cl 17(1)(a)",
    describe: (p) => `Less than ${p.daily_rest_hours} consecutive hours between ending one shift and starting the next.`,
  },
  {
    key: "weekly_rest",
    kind: "legal",
    label: "No 36-hour weekly rest",
    source: "BCEA s15(1)(b); Sectoral Determination 14, cl 17(1)(b)",
    describe: (p) => `No break of ${p.weekly_rest_hours} consecutive hours in a Monday-to-Sunday week. A break that runs across the week boundary counts in full.`,
  },
  {
    key: "weekly_hours",
    kind: "legal",
    label: "Over 45 hours rostered in a week",
    source: "BCEA s9; Sectoral Determination 14, cl 9",
    describe: (p) => `More than ${p.weekly_ordinary_hours} hours rostered in a week. Hours above that are overtime, which needs agreement.`,
  },
  {
    key: "late_then_early",
    kind: "fatigue",
    label: "Late close, then early open",
    source: "Fatigue policy",
    describe: (p) => `A shift ending at or after ${p.late_finish_hour}:00 followed by one starting before ${p.early_start_hour}:00 the next day.`,
  },
  {
    key: "split_shift",
    kind: "fatigue",
    label: "Split shift",
    source: "Fatigue policy",
    describe: (p) => `Two shifts on the same day with a gap of ${p.split_gap_hours} hours or more between them.`,
  },
  {
    key: "late_run",
    kind: "fatigue",
    label: "Run of late finishes",
    source: "Fatigue policy",
    describe: (p) => `${p.late_run_length} or more shifts in a row ending at or after ${p.late_finish_hour}:00.`,
  },
  {
    key: "short_notice",
    kind: "fatigue",
    label: "Changed at short notice",
    source: "Fatigue policy",
    describe: (p) => `A shift published or changed less than ${p.short_notice_hours} hours before it starts.`,
  },
];
export const RULE_KEYS = RULES.map((r) => r.key);

// Columns that would identify a person. A roster carrying one is refused: the
// check needs an anonymised reference and nothing more.
const IDENTIFYING_COLUMNS = ["name", "first_name", "surname", "full_name", "email", "id_number", "phone", "cell", "employee_number"];

// --- Time ---------------------------------------------------------------------

const TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/;

// Minutes since 1970 for a local timestamp, read as written. UTC arithmetic is
// used only so no time zone shifts it.
export function toMinutes(text) {
  const m = TIME.exec(String(text || "").trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi) / 60000;
}

const DAY = 24 * 60;
const hourOf = (min) => Math.floor((min % DAY) / 60);
const dayOf = (min) => Math.floor(min / DAY);
// Monday-based week number: 1970-01-01 was a Thursday, so shift by three days.
const weekOf = (min) => Math.floor((dayOf(min) + 3) / 7);

// --- Parsing -----------------------------------------------------------------

/*
  Read a roster CSV: staff_ref, department, start, end, and optionally
  published_at and changed_at. Simple comma-separated values, no quoted fields.
  Returns the shifts and the problems found, by line, without echoing values
  back, since a mistyped column could hold a name.
*/
export function parseRosterCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return { shifts: [], errors: ["The file is empty."] };
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const identifying = header.filter((h) => IDENTIFYING_COLUMNS.includes(h));
  if (identifying.length) {
    return {
      shifts: [],
      errors: [`The roster has columns that identify people (${identifying.join(", ")}). Remove them and use an anonymised staff reference.`],
      refused: true,
    };
  }
  const need = ["staff_ref", "department", "start", "end"];
  const missing = need.filter((c) => !header.includes(c));
  if (missing.length) return { shifts: [], errors: [`Missing columns: ${missing.join(", ")}.`] };
  const col = Object.fromEntries(header.map((h, i) => [h, i]));

  const shifts = [];
  const errors = [];
  lines.slice(1).forEach((line, i) => {
    const cells = line.split(",").map((c) => c.trim());
    const row = (k) => (col[k] != null ? cells[col[k]] : undefined);
    const shift = {
      staff_ref: row("staff_ref"),
      department: row("department"),
      start: row("start"),
      end: row("end"),
      published_at: row("published_at") || null,
      changed_at: row("changed_at") || null,
    };
    const problem = shiftProblem(shift);
    if (problem) errors.push(`Line ${i + 2}: ${problem}`);
    else shifts.push(shift);
  });
  return { shifts, errors };
}

function shiftProblem(s) {
  if (!s.staff_ref) return "no staff reference.";
  if (!s.department) return "no department.";
  const a = toMinutes(s.start);
  const b = toMinutes(s.end);
  if (a == null || b == null) return "start and end must look like 2026-11-06T22:00.";
  if (b <= a) return "the shift ends before it starts.";
  if (b - a > 16 * 60) return "the shift is longer than 16 hours, which looks like a typing error.";
  for (const k of ["published_at", "changed_at"]) {
    if (s[k] && toMinutes(s[k]) == null) return `${k} must look like 2026-11-06T22:00.`;
  }
  return null;
}

// --- Checking ----------------------------------------------------------------

/*
  Which rules each shift breaks, per person. Internal: the public result is
  counts by department, so staff references never leave checkRoster.
*/
function breachesFor(shifts, p) {
  const byStaff = new Map();
  for (const s of shifts) {
    const start = toMinutes(s.start);
    const end = toMinutes(s.end);
    const notice = [s.changed_at, s.published_at].map(toMinutes).filter((v) => v != null);
    const list = byStaff.get(s.staff_ref) || [];
    list.push({ ...s, startMin: start, endMin: end, noticeMin: notice.length ? Math.max(...notice) : null });
    byStaff.set(s.staff_ref, list);
  }

  const out = [];
  for (const [staff, list] of byStaff) {
    list.sort((a, b) => a.startMin - b.startMin);
    const hit = list.map(() => new Set());
    const late = (s) => hourOf(s.endMin) >= p.late_finish_hour || dayOf(s.endMin) > dayOf(s.startMin);

    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      const gapH = (cur.startMin - prev.endMin) / 60;
      const sameDay = dayOf(cur.startMin) === dayOf(prev.startMin);
      if (sameDay && gapH >= p.split_gap_hours) {
        hit[i].add("split_shift");
      } else if (gapH < p.daily_rest_hours && !sameDay) {
        hit[i].add("daily_rest");
      }
      if (late(prev) && dayOf(cur.startMin) === dayOf(prev.endMin) + (hourOf(prev.endMin) >= p.late_finish_hour ? 1 : 0) && hourOf(cur.startMin) < p.early_start_hour && !sameDay) {
        hit[i].add("late_then_early");
      }
    }

    // Runs of late finishes, counted on the shift that completes the run.
    let run = 0;
    list.forEach((s, i) => {
      run = late(s) ? run + 1 : 0;
      if (run >= p.late_run_length) hit[i].add("late_run");
    });

    list.forEach((s, i) => {
      if (s.noticeMin != null && (s.startMin - s.noticeMin) / 60 < p.short_notice_hours) hit[i].add("short_notice");
    });

    // Weekly rules, per Monday-to-Sunday week the person works in.
    const weeks = new Map();
    list.forEach((s, i) => {
      const w = weekOf(s.startMin);
      if (!weeks.has(w)) weeks.set(w, []);
      weeks.get(w).push(i);
    });
    for (const [w, idx] of weeks) {
      const hours = idx.reduce((h, i) => h + (list[i].endMin - list[i].startMin) / 60, 0);
      if (hours > p.weekly_ordinary_hours) idx.forEach((i) => hit[i].add("weekly_hours"));
      // Each rest period is measured in full, from the end of one shift to the
      // start of the next, and counts for every week it touches. Cutting it at
      // Monday 00:00 would turn a Sunday-afternoon finish and a Monday off
      // into a short rest that never happened. Before the person's first
      // shift and after their last, the roster cannot say, so that rest is
      // given the benefit of the doubt.
      const weekStart = (w * 7 - 3) * DAY;
      const weekEnd = weekStart + 7 * DAY;
      let longest = 0;
      for (let k = 0; k <= list.length; k++) {
        const restStart = k === 0 ? -Infinity : list[k - 1].endMin;
        const restEnd = k === list.length ? Infinity : list[k].startMin;
        if (restEnd <= weekStart || restStart >= weekEnd) continue;
        longest = Math.max(longest, (restEnd - restStart) / 60);
      }
      if (longest < p.weekly_rest_hours) idx.forEach((i) => hit[i].add("weekly_rest"));
    }

    list.forEach((s, i) => out.push({ staff, department: s.department, rules: hit[i] }));
  }
  return out;
}

/*
  Check a roster. Returns, for the whole roster and each department, how many
  shifts and how many people break each rule. A department under the threshold
  is listed as suppressed with no figures.
*/
export function checkRoster(shifts, { policy = {}, threshold = SUPPRESSION_THRESHOLD } = {}) {
  const p = { ...DEFAULT_POLICY, ...policy };
  const rows = breachesFor(shifts || [], p);

  const tally = (subset) => {
    const staff = new Set(subset.map((r) => r.staff));
    const rules = {};
    for (const key of RULE_KEYS) {
      const hits = subset.filter((r) => r.rules.has(key));
      const people = new Set(hits.map((r) => r.staff));
      rules[key] = {
        shifts: hits.length,
        staff: people.size,
        staff_share: staff.size ? Math.round((people.size / staff.size) * 1000) / 1000 : 0,
      };
    }
    return { staff: staff.size, shifts: subset.length, rules };
  };

  const departments = [...new Set(rows.map((r) => r.department))].sort();
  const byDepartment = departments.map((label) => {
    const subset = rows.filter((r) => r.department === label);
    const people = new Set(subset.map((r) => r.staff)).size;
    if (people < threshold) return { label, suppressed: true, suppressed_below: threshold };
    return { label, ...tally(subset) };
  });

  // Totals cover reportable departments only. Including a suppressed one would
  // let anyone recover its figures by subtracting the visible departments.
  const reportable = new Set(byDepartment.filter((d) => !d.suppressed).map((d) => d.label));
  const withheld = byDepartment.filter((d) => d.suppressed).length;

  return {
    policy: p,
    rules: RULES.map(({ key, kind, label, source, describe }) => ({ key, kind, label, source, description: describe(p) })),
    total: tally(rows.filter((r) => reportable.has(r.department))),
    by_department: byDepartment,
    withheld_departments: withheld,
    note:
      "Counts by department only. The legal rules flag a roster to check against any written agreements in place; they are not a finding of non-compliance and not legal advice.",
  };
}
