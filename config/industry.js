// Welo dashboard — industry profiles.
//
// One dashboard engine (index.html), multiple industry framings. Select with a
// query param on the URL, e.g.
//   index.html                      -> mining (default)
//   index.html?industry=generic     -> cross-industry / generic
//   index.html?industry=manufacturing
//   index.html?industry=logistics
//
// Each profile supplies the industry-variable copy keyed by the data-ind
// attributes in index.html. Anything not listed falls back to the markup
// default (which is the mining wording). The underlying model output is shared;
// only the framing changes. To add a vertical, copy the generic block and tweak
// the title and copy.

window.WELO_PROFILES = {
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

// Verticals that reuse the generic framing with their own title. Add or adjust
// copy here as each sector's benchmarks land.
["manufacturing", "logistics"].forEach(function (key) {
  var p = JSON.parse(JSON.stringify(window.WELO_PROFILES.generic));
  p.title = "Welo · Absenteeism Intelligence · " + key.charAt(0).toUpperCase() + key.slice(1);
  window.WELO_PROFILES[key] = p;
});
