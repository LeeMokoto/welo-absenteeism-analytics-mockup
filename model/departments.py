"""Where the industrial tenant's people work.

The base industrial cohort was generated without departments, and its
predictions are committed (data/outputs/predictions.csv). Those predictions
are the model's real output and the whole base feed rests on them, so this
module does not regenerate them: it groups the rows that already exist.

That constrains what a department can honestly be here. It cannot be drawn at
random, because then every department would have the same absence rate and the
screens that exist to show where absence lands would show that it lands evenly,
which is both useless and false to how an industrial site works. And it cannot
be drawn from the working pattern and then used to *change* that pattern, the
way the hospitality profile does, because that would mean re-scoring.

So it is derived from the work each row already does. In heavy industry the
department largely is the work: underground crews run the longest consecutive
shifts, the most overtime and the worst sleep; a processing plant runs steady
cycles; engineering carries the callouts; surface and admin are lighter. The
generator produced those working patterns directly, so reading a department
back off them reproduces the association a real roster would have, rather than
inventing one.

What this is not: the departments are not in the client's data, because there
is no client. They are a plausible structure over a synthetic cohort, and the
feed marks them as such. When a tenant's own department field arrives it
replaces this entirely, and nothing downstream changes, because everything
downstream reads the column and not this file.

The one thing to be careful of is making the department a restatement of the
operational-load cohort, which is built from the same three inputs. Real
departments overlap heavily: a plant has some of the hardest jobs on the site
and some of the easiest. So each department gets a preferred position on the
intensity scale and a width, rather than a slice of it, and rows are sampled
against those preferences. The result is a gradient with real overlap instead
of six bands sorted end to end.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# The inputs that decide where someone works. The same three the operational
# load cohort is built from, because they are the levers the platform says it
# can act on with rostering, and because a department that did not differ on
# them would not differ on anything a roster change could reach.
INTENSITY_INPUTS = (
    "workload_index_current",
    "overtime_hours_14d",
    "consecutive_shifts_worked",
)

# `centre` is where the department sits on the intensity scale, 0 lightest to
# 1 heaviest; `width` is how far it spreads. Wide widths are deliberate: an
# engineering function covers the whole site and draws from everywhere, while
# admin is tightly clustered at the light end.
#
# Shares are what the realised split should come to, and are fitted below
# rather than assumed: the preferences alone would not produce them.
# The names are deliberately sector neutral. This demo goes to buyers across
# heavy industry, and a department list written for one of them makes every
# other buyer do the translating; lib/platform/demoVocabulary.test.mjs enforces
# that and caught the first draft of this list, which was written for a mine.
INDUSTRIAL_DEPARTMENTS = (
    {"label": "Production operations", "share": 0.24, "centre": 0.84, "width": 0.24},
    {"label": "Plant and processing", "share": 0.22, "centre": 0.60, "width": 0.28},
    {"label": "Engineering and maintenance", "share": 0.16, "centre": 0.68, "width": 0.34},
    {"label": "Logistics and materials", "share": 0.14, "centre": 0.44, "width": 0.30},
    {"label": "Site services", "share": 0.16, "centre": 0.30, "width": 0.28},
    {"label": "Support and admin", "share": 0.08, "centre": 0.08, "width": 0.20},
)

_FIT_ROUNDS = 60


def intensity(df: pd.DataFrame) -> np.ndarray:
    """Each row's operational intensity, as a rank in [0, 1].

    A rank rather than a z-score, so the scale does not move when the cohort's
    distribution does and a department's `centre` means the same thing in any
    tenant. Each input is ranked on its own first, so one input with a long
    tail cannot dominate the composite.
    """
    missing = [c for c in INTENSITY_INPUTS if c not in df.columns]
    if missing:
        raise KeyError(f"cohort is missing intensity inputs: {missing}")
    parts = [df[c].rank(pct=True, method="average").to_numpy(dtype=float) for c in INTENSITY_INPUTS]
    composite = np.mean(parts, axis=0)
    # Rank once more: the mean of three uniforms is not uniform, and a
    # department's centre is meant to read as a position in the workforce.
    return pd.Series(composite).rank(pct=True, method="average").to_numpy(dtype=float)


def _weights(pct: np.ndarray, spec) -> np.ndarray:
    """Each row's affinity for each department, fitted to the target shares.

    The preference curves alone give the wrong split, because a wide department
    collects rows a narrow one would have taken. So a per-department multiplier
    is fitted until the expected shares match the targets. This is iterative
    proportional fitting, and it converges in a few rounds for shares this far
    from zero.
    """
    centres = np.array([d["centre"] for d in spec])
    widths = np.array([d["width"] for d in spec])
    targets = np.array([d["share"] for d in spec], dtype=float)
    targets = targets / targets.sum()

    z = (pct[:, None] - centres[None, :]) / widths[None, :]
    affinity = np.exp(-0.5 * z**2)

    scale = np.ones(len(spec))
    for _ in range(_FIT_ROUNDS):
        w = affinity * scale[None, :]
        w = w / w.sum(axis=1, keepdims=True)
        got = w.mean(axis=0)
        # Guard the degenerate case rather than dividing by zero: a department
        # no row has any affinity for cannot be fitted, and silently returning
        # NaN would put an empty department on the screen.
        if np.any(got <= 0):
            raise ValueError("a department attracted no rows; check its centre and width")
        scale *= targets / got

    w = affinity * scale[None, :]
    return w / w.sum(axis=1, keepdims=True)


def assign(df: pd.DataFrame, spec=INDUSTRIAL_DEPARTMENTS, seed: int = 7) -> pd.Series:
    """A department for every row, sampled from its affinities.

    Sampled rather than taken as the strongest affinity: an argmax would sort
    the workforce into six contiguous bands of intensity, which is the exact
    artefact this is written to avoid.
    """
    pct = intensity(df)
    w = _weights(pct, spec)
    rng = np.random.default_rng(seed)
    # One uniform per row against the cumulative affinities: vectorised, and
    # reproducible for a given seed and row order.
    draw = rng.random(len(df))
    idx = (w.cumsum(axis=1) < draw[:, None]).sum(axis=1).clip(0, len(spec) - 1)
    labels = np.array([d["label"] for d in spec])
    return pd.Series(labels[idx], index=df.index, name="department")
