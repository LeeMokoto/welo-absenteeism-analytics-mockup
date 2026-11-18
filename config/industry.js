// Welo dashboard industry profiles.
//
// One dashboard engine (index.html), multiple industry framings. Select with a
// query param on the URL, e.g.
//   index.html                      -> industrial (default)
//   index.html?industry=mining
//   index.html?industry=manufacturing
//   index.html?industry=logistics
//   index.html?industry=hospitality
//   index.html?industry=generic     -> cross-industry, no sector wording
//
// The default is `industrial`: sector-neutral blue collar wording that fits any
// employer with a shift-based frontline workforce. That is the version that
// goes to prospective buyers, because a demo framed as somebody else's industry
// asks the buyer to do the translating. Mining is still a profile rather than
// the baseline, so a mining prospect gets their own words with one query param.
//
// Each profile supplies the industry-variable copy keyed by the data-ind
// attributes in index.html. Anything not listed falls back to the markup
// default, which carries the industrial wording, so a failed config load
// degrades to the neutral version rather than to a vertical. The underlying
// model output is shared; only the framing changes. To add a vertical, copy the
// industrial block and tweak the title and copy.

// Currency: the dashboard stores every amount in Rand and converts on the fly.
// Default currency is ZAR; add ?currency=usd to a link, or use the ZAR/USD
// toggle in the header.
//
// Update the rate AND its date together. The date is shown beside every
// converted figure, and the dashboard refuses a rate with no date rather than
// pairing a fresh rate with a stale date: these figures get screenshotted into
// other people's decks, and a dollar figure carrying somebody else's date is
// worse than one carrying none.
window.WELO_FX = { zarPerUsd: 18.5, asOf: '2026-10-01' };

window.WELO_PROFILES = {
  // The shipped default. Blue collar, sector-neutral: plants, a distribution
  // centre, a depot, and a workforce mostly on a shift roster.
  industrial: {
    title: "Welo · Absenteeism Intelligence · Industrial",
    copy: {
      "metric-covered-detail": "scored industrial workforce",
      "individuals-disclaimer":
        "IDs are synthetic industrial workforce records, not real people.",
      "chronic-sub":
        "% screened positive by operational-load cohort · anchored to published SA frontline workforce benchmarks until pilot screening lands",
      "hr-absence-detail": "annualised · vs ~4% SA industrial benchmark",
      "roi-sub":
        "Projected impact across a 6,000-life industrial workforce · illustrative, benchmark-anchored on model output.",
    },
  },

  mining: {
    title: "Welo · Absenteeism Intelligence · Mining",
    copy: {
      "metric-covered-detail": "scored mining cohort",
      "individuals-disclaimer": "IDs are synthetic mining-cohort records, not real people.",
      "chronic-sub": "% screened positive by operational-load cohort · anchored to SA mining-cohort benchmarks until pilot screening lands",
      "hr-absence-detail": "annualised · vs ~4% SA mining benchmark",
      "roi-sub": "Projected impact across the 6,000-life mining cohort · benchmark-anchored on model output.",
    },
  },

  generic: {
    title: "Welo · Absenteeism Intelligence",
    copy: {
      "metric-covered-detail": "scored workforce cohort",
      "individuals-disclaimer": "IDs are synthetic, illustrative workforce records, not real people.",
      "chronic-sub": "% screened positive by operational-load cohort · anchored to industry workforce health benchmarks until pilot screening lands",
      "hr-absence-detail": "annualised · vs ~4% industry benchmark",
      "roi-sub": "Projected impact across a 6,000-life workforce cohort · illustrative, benchmark-anchored on model output.",
    },
  },
};

// Sector versions have their own calibrated synthetic cohort (loaded from
// dashboard_feed.<sector>.js) and their own benchmark framing. The `benchmarks`
// block re-skins the two illustrative clinical heatmaps and the seasonality
// panels per sector (mining/generic keep the static markup). Heat levels are
// derived from the values; driver R amounts come from `frac` x total saving.
window.WELO_PROFILES.manufacturing = {
  title: "Welo · Absenteeism Intelligence · Manufacturing",
  copy: {
    "metric-covered-detail": "scored manufacturing cohort",
    "individuals-disclaimer": "IDs are synthetic manufacturing-cohort records, not real people.",
    "chronic-sub": "% screened positive by operational-load cohort · anchored to industry workforce health benchmarks until pilot screening lands",
    "hr-absence-detail": "annualised · vs ~4% SA manufacturing benchmark",
    "roi-sub": "Projected impact across a 6,000-life manufacturing cohort · illustrative, benchmark-anchored on model output.",
  },
  benchmarks: {
    drivers: {
      note: "Line work skews musculoskeletal &amp; metabolic · dust and fume exposure lifts respiratory on finishing lines",
      rows: [
        { label: "Musculoskeletal", icon: "ic-bone", v: [30, 24, 18, 25] },
        { label: "Metabolic", icon: "ic-metabolic", v: [24, 27, 22, 25] },
        { label: "Cardiovascular", icon: "ic-heart", v: [18, 16, 15, 17] },
        { label: "Respiratory · dust/fumes", icon: "ic-lungs", v: [14, 12, 16, 13] },
        { label: "Mental health", icon: "ic-mind", v: [11, 12, 12, 12] },
        { label: "Other", icon: "ic-dots", v: [8, 9, 8, 8] },
      ],
    },
    chronic: {
      note: "Metabolic and musculoskeletal load dominate · sedentary line roles carry the obesity and pre-diabetes burden",
      rows: [
        { label: "Obesity · WHtR &gt; 0.6", icon: "ic-gauge", v: [30, 33, 27, 30] },
        { label: "Hypertension", icon: "ic-heart", v: [24, 22, 21, 23] },
        { label: "Musculoskeletal disorder", icon: "ic-bone", v: [22, 18, 15, 19] },
        { label: "Pre-diabetes", icon: "ic-droplet", v: [17, 19, 15, 17] },
        { label: "Depression / anxiety screen+", icon: "ic-mind", v: [14, 13, 14, 14] },
        { label: "Type 2 diabetes", icon: "ic-droplet-fill", v: [10, 12, 9, 11] },
      ],
    },
    seasonality: {
      subCalendar: "52-week projection · post-festive production ramp layered on the winter respiratory band",
      chipCalendar: "Ramp + winter",
      noteCalendar: "January production ramp and the mid-year winter band lift absence · steadier Q2 and Q4",
      subQuarter: "quarterly absent days · post-holiday ramp and winter both lift absence",
      chipQuarter: "Ramp + winter",
      quarters: [
        { label: "Q1 · ramp-up", base: 20600, height: 92 },
        { label: "Q2 · autumn", base: 17600, height: 80 },
        { label: "Q3 · winter", base: 20600, height: 92 },
        { label: "Q4 · wind-down", base: 17700, height: 80 },
      ],
      calendar: { monday: 1.5, friday: 0.8, sat: -0.4, sun: -0.6, winter: [22, 35, 0.9], shoulder: [21, 36, 0.4], jan: [0, 4, 0.7], extra: [] },
    },
    roi: {
      sub: "projected · illustrative benchmark applied per category",
      drivers: [
        { name: "Musculoskeletal / ergonomics", width: 92, frac: 0.30 },
        { name: "Metabolic / diabetes care", width: 82, frac: 0.26 },
        { name: "Cardiovascular management", width: 58, frac: 0.19 },
        { name: "Mental health &amp; EAP", width: 44, frac: 0.14 },
      ],
    },
  },
};
window.WELO_PROFILES.logistics = {
  title: "Welo · Absenteeism Intelligence · Logistics",
  copy: {
    "metric-covered-detail": "scored logistics cohort",
    "individuals-disclaimer": "IDs are synthetic logistics-cohort records, not real people.",
    "chronic-sub": "% screened positive by operational-load cohort · anchored to industry workforce health benchmarks until pilot screening lands",
    "hr-absence-detail": "annualised · vs ~6% SA logistics benchmark",
    "roi-sub": "Projected impact across a 6,000-life logistics cohort · illustrative, benchmark-anchored on model output.",
  },
  benchmarks: {
    drivers: {
      note: "Sedentary driving skews metabolic &amp; cardiovascular · long hours drive the fatigue and musculoskeletal load",
      rows: [
        { label: "Metabolic", icon: "ic-metabolic", v: [28, 30, 24, 28] },
        { label: "Musculoskeletal", icon: "ic-bone", v: [24, 22, 18, 22] },
        { label: "Cardiovascular", icon: "ic-heart", v: [20, 18, 16, 19] },
        { label: "Fatigue &amp; mental", icon: "ic-mind", v: [16, 14, 14, 15] },
        { label: "Respiratory", icon: "ic-lungs", v: [8, 9, 12, 9] },
        { label: "Other", icon: "ic-dots", v: [6, 7, 6, 7] },
      ],
    },
    chronic: {
      note: "Highest metabolic and obesity burden of any sector · sleep and fatigue disorders track the long-haul roster",
      rows: [
        { label: "Obesity · WHtR &gt; 0.6", icon: "ic-gauge", v: [36, 38, 31, 35] },
        { label: "Hypertension", icon: "ic-heart", v: [28, 26, 24, 27] },
        { label: "Pre-diabetes", icon: "ic-droplet", v: [22, 24, 19, 22] },
        { label: "Sleep / fatigue disorder", icon: "ic-mind", v: [20, 18, 17, 19] },
        { label: "Musculoskeletal disorder", icon: "ic-bone", v: [22, 20, 16, 20] },
        { label: "Type 2 diabetes", icon: "ic-droplet-fill", v: [15, 17, 12, 15] },
      ],
    },
    seasonality: {
      subCalendar: "52-week projection · festive peak-season freight layered on the winter respiratory band",
      chipCalendar: "Peak-season + winter",
      noteCalendar: "Peak freight Nov to Jan drives the largest spike · winter band adds a mid-year lift · Mondays run hot year-round",
      subQuarter: "quarterly absent days · festive peak freight is the year's high point",
      chipQuarter: "Peak-season Q4",
      quarters: [
        { label: "Q1 · post-peak", base: 17600, height: 80 },
        { label: "Q2 · autumn", base: 16800, height: 76 },
        { label: "Q3 · winter", base: 19900, height: 90 },
        { label: "Q4 · peak freight", base: 22200, height: 100 },
      ],
      calendar: { monday: 1.5, friday: 0.9, sat: -0.3, sun: -0.5, winter: [22, 35, 1.0], shoulder: [21, 36, 0.4], jan: null, extra: [[44, 52, 1.4], [0, 2, 0.8]] },
    },
    roi: {
      sub: "projected · illustrative benchmark applied per category",
      drivers: [
        { name: "Metabolic / diabetes care", width: 92, frac: 0.30 },
        { name: "Fatigue &amp; sleep management", width: 76, frac: 0.24 },
        { name: "Musculoskeletal / ergonomics", width: 58, frac: 0.18 },
        { name: "Cardiovascular management", width: 50, frac: 0.16 },
      ],
    },
  },
};
// Hospitality: hotels, restaurants and contract catering. The first profile
// outside heavy industry, so more of the framing changes: cover comes from
// casual and agency staff rather than overtime, weekends are worked, and the
// peaks are trading peaks (festive season, Easter, the July holidays) layered
// on the winter illness band. Its cohort, day rate and cover shares are
// directional and unsourced until the calibration sources are agreed, which is
// why the copy below says "illustrative" rather than quoting a benchmark.
window.WELO_PROFILES.hospitality = {
  title: "Welo · Absenteeism Intelligence · Hospitality",
  copy: {
    "metric-covered-detail": "scored hospitality cohort",
    "individuals-disclaimer": "IDs are synthetic hospitality-cohort records, not real people.",
    "chronic-sub": "% screened positive by operational-load cohort · illustrative until hospitality screening benchmarks are agreed",
    "hr-absence-detail": "annualised · illustrative hospitality cohort, benchmark to be agreed",
    "hr-backfill-label": "Casual and agency cover cost · 90d",
    "hr-cover-sub": "predicted shift cover gaps and the casual and agency spend to fill them",
    "roi-sub": "Projected impact across a 6,000-life hospitality cohort · illustrative calibration on model output.",
  },
  benchmarks: {
    drivers: {
      note: "Kitchens and housekeeping skew musculoskeletal and injury · late closes and long runs of shifts drive the fatigue and mental health load",
      rows: [
        { label: "Musculoskeletal", icon: "ic-bone", v: [29, 24, 17, 24] },
        { label: "Fatigue &amp; mental", icon: "ic-mind", v: [24, 19, 14, 20] },
        { label: "Respiratory &amp; gastro", icon: "ic-lungs", v: [17, 19, 18, 18] },
        { label: "Injury · burns, cuts, slips", icon: "ic-dots", v: [16, 13, 8, 13] },
        { label: "Metabolic", icon: "ic-metabolic", v: [8, 12, 14, 11] },
        { label: "Cardiovascular", icon: "ic-heart", v: [6, 8, 9, 8] },
      ],
    },
    chronic: {
      note: "A younger workforce carries less metabolic burden · mental health and alcohol load sit higher than in heavy industry",
      rows: [
        { label: "Depression / anxiety screen+", icon: "ic-mind", v: [24, 20, 17, 21] },
        { label: "Musculoskeletal disorder", icon: "ic-bone", v: [22, 18, 12, 18] },
        { label: "Obesity · WHtR &gt; 0.6", icon: "ic-gauge", v: [18, 21, 24, 21] },
        { label: "Hypertension", icon: "ic-heart", v: [14, 15, 17, 15] },
        { label: "Pre-diabetes", icon: "ic-droplet", v: [10, 12, 14, 12] },
        { label: "Type 2 diabetes", icon: "ic-droplet-fill", v: [5, 6, 8, 6] },
      ],
    },
    seasonality: {
      subCalendar: "52-week projection · festive, Easter and July trading peaks layered on the winter respiratory band",
      chipCalendar: "Trading peaks + winter",
      noteCalendar: "December is the year's high point and the July holidays land on top of winter flu · weekends are worked, so absence does not fall away on Saturday and Sunday",
      subQuarter: "quarterly absent days · the festive peak and the winter holidays carry the year",
      chipQuarter: "Festive Q4",
      quarters: [
        { label: "Q1 · post-festive", base: 20000, height: 98 },
        { label: "Q2 · autumn", base: 16400, height: 80 },
        { label: "Q3 · winter holidays", base: 19600, height: 96 },
        { label: "Q4 · festive peak", base: 20500, height: 100 },
      ],
      calendar: { monday: 1.2, friday: 1.0, sat: 0.6, sun: 0.5, winter: [22, 35, 0.9], shoulder: [21, 36, 0.4], jan: [0, 2, 0.6], extra: [[13, 15, 0.6], [48, 52, 1.1]] },
    },
    roi: {
      sub: "projected · illustrative benchmark applied per category",
      drivers: [
        { name: "Fatigue &amp; roster design", width: 92, frac: 0.30 },
        { name: "Musculoskeletal / manual handling", width: 76, frac: 0.24 },
        { name: "Mental health &amp; EAP", width: 60, frac: 0.19 },
        { name: "Injury prevention", width: 44, frac: 0.14 },
      ],
    },
  },
};
