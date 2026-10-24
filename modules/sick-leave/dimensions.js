/*
  The demo tenant's workforce dimensions.

  One definition, imported by the data generator, the cost model and the
  screens, so a site or function name cannot be spelled one way in the data and
  another way in the interface.

  These are deliberately sector-neutral blue collar. This demo goes to
  prospective buyers right across heavy industry, and all of them run the same
  shape of workforce: shift-based frontline operations, a maintenance trade, a
  warehouse, a services layer and a thin office. A buyer should be able to map
  their own sites onto these in one glance, which they cannot do if the demo is
  named after somebody else's industry.

  lib/platform/demoVocabulary.test.mjs holds this to an absolute rule: no demo
  surface carries a named client or a word only one vertical uses.

  What makes this a blue collar product rather than an HR dashboard is the cover
  requirement below. When a frontline operator is absent the work does not wait:
  somebody is paid overtime to stand in, or the line stops. That is why
  coverRequiredShare sits here next to the function it belongs to rather than in
  a spreadsheet, and it is the reason the same absence rate costs an industrial
  employer several times what it costs an office.
*/

export const SITES = [
  { name: "Main plant", weight: 30 },
  { name: "North plant", weight: 28 },
  { name: "Distribution centre", weight: 26 },
  { name: "Depot and workshop", weight: 16 },
];

export const SITE_NAMES = SITES.map((s) => s.name);

/*
  Functions, with the share of absences in each that actually has to be
  backfilled. Frontline production is close to total: a shift post is either
  filled or the plant runs short. Administration is low, because an office
  absence is usually absorbed rather than covered.
*/
export const FUNCTIONS = [
  { name: "Production and operations", coverRequiredShare: 0.9 },
  { name: "Warehouse and logistics", coverRequiredShare: 0.8 },
  { name: "Engineering and maintenance", coverRequiredShare: 0.7 },
  { name: "Facilities and services", coverRequiredShare: 0.5 },
  { name: "Administration", coverRequiredShare: 0.15 },
];

export const FUNCTION_NAMES = FUNCTIONS.map((f) => f.name);

export const COVER_REQUIRED_SHARE = Object.fromEntries(
  FUNCTIONS.map((f) => [f.name, f.coverRequiredShare]),
);

/*
  Shift patterns, with scheduled working days per twelve months. This is the
  denominator of the sick leave rate, and it is the reason a blue collar rate
  cannot be compared with an office one without it: a continuous roster is
  rostered for 182 days a year, so the same number of sick days is a materially
  higher rate than it would be on a 232 day office calendar.
*/
export const SHIFTS = [
  { name: "Continuous (4 on 4 off)", scheduledDaysPerYear: 182 },
  { name: "Rotating three-shift", scheduledDaysPerYear: 219 },
  { name: "Day shift", scheduledDaysPerYear: 232 },
  { name: "Standard business hours", scheduledDaysPerYear: 232 },
];

export const SHIFT_NAMES = SHIFTS.map((s) => s.name);

export const SCHEDULED_DAYS_PER_YEAR = Object.fromEntries(
  SHIFTS.map((s) => [s.name, s.scheduledDaysPerYear]),
);

/*
  Which functions sit at which site, as weights. A distribution centre is mostly
  warehouse; a plant is mostly production. Every site carries some maintenance,
  some services and a little administration, because every real one does.
*/
export const SITE_FUNCTION_MIX = {
  "Main plant": [
    ["Production and operations", 46],
    ["Engineering and maintenance", 22],
    ["Warehouse and logistics", 12],
    ["Facilities and services", 10],
    ["Administration", 10],
  ],
  "North plant": [
    ["Production and operations", 44],
    ["Engineering and maintenance", 24],
    ["Warehouse and logistics", 11],
    ["Facilities and services", 11],
    ["Administration", 10],
  ],
  "Distribution centre": [
    ["Warehouse and logistics", 48],
    ["Production and operations", 14],
    ["Engineering and maintenance", 14],
    ["Facilities and services", 12],
    ["Administration", 12],
  ],
  "Depot and workshop": [
    ["Engineering and maintenance", 38],
    ["Warehouse and logistics", 26],
    ["Facilities and services", 14],
    ["Production and operations", 10],
    ["Administration", 12],
  ],
};

/*
  Shift mix by function. Frontline production runs the continuous and rotating
  rosters; the office does not.
*/
export const FUNCTION_SHIFT_MIX = {
  "Production and operations": [
    ["Continuous (4 on 4 off)", 52],
    ["Rotating three-shift", 42],
    ["Day shift", 6],
  ],
  "Warehouse and logistics": [
    ["Day shift", 50],
    ["Rotating three-shift", 34],
    ["Continuous (4 on 4 off)", 16],
  ],
  "Engineering and maintenance": [
    ["Day shift", 54],
    ["Rotating three-shift", 30],
    ["Continuous (4 on 4 off)", 16],
  ],
  "Facilities and services": [
    ["Day shift", 62],
    ["Rotating three-shift", 24],
    ["Continuous (4 on 4 off)", 14],
  ],
  Administration: [["Standard business hours", 100]],
};

/*
  Condition mix by function, as multipliers on the base ICD-10 chapter weights.

  These are illustrative and stay illustrative until client data lands, but the
  direction is the recognisable blue collar one: frontline and trade work carries
  the musculoskeletal and injury load, warehouse work carries lifting strain,
  the office carries proportionally more of the mental and behavioural chapter
  and almost none of the injury chapter.
*/
export const FUNCTION_CHAPTER_MOD = {
  "Production and operations": {
    "Musculoskeletal (M)": 1.5,
    "Injury and external causes (S and T)": 1.6,
    "Respiratory (J)": 1.2,
  },
  "Warehouse and logistics": {
    "Musculoskeletal (M)": 1.4,
    "Injury and external causes (S and T)": 1.2,
    "Circulatory (I)": 1.1,
  },
  "Engineering and maintenance": {
    "Injury and external causes (S and T)": 1.4,
    "Musculoskeletal (M)": 1.3,
  },
  "Facilities and services": {
    "Musculoskeletal (M)": 1.2,
    "Infectious and parasitic (A and B)": 1.2,
  },
  Administration: {
    "Mental and behavioural (F)": 1.4,
    "Musculoskeletal (M)": 0.6,
    "Injury and external causes (S and T)": 0.4,
  },
};

// Functions whose absence has to be covered on the day rather than absorbed.
// Used for copy that explains why the cover gap is the number that matters.
export const SHIFT_CRITICAL_FUNCTIONS = FUNCTIONS.filter(
  (f) => f.coverRequiredShare >= 0.7,
).map((f) => f.name);
