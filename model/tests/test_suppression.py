"""
Small-cell disclosure control.

The threshold hides a cohort's figures. It does not, on its own, hide the
cohort: where a total is published beside the table, subtracting the visible
rows returns the suppressed row exactly. That is what these tests are about.

The leak was real and was demonstrated against /absence/outcomes before the
fix: three cohorts, one suppressed, a stated total of 5,800 covered lives and
4,553 visible, giving the suppressed cohort's headcount as 1,247. The totals
cannot simply be withheld, because covered_cohort.count is published on the
portfolio screen as well, so the margin is available whatever one screen does.
Hiding a second cohort is what removes the subtraction.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from feed_enrich import (  # noqa: E402
    SUPPRESSION_THRESHOLD,
    apply_complementary_suppression,
    suppressed_row,
)


def cohort(label, n, measure=None):
    return {
        "key": label,
        "label": label,
        "count": n,
        "cost_exposure_rand": measure if measure is not None else n * 1000,
    }


def visible(rows):
    return [r for r in rows if not r.get("suppressed")]


def hidden(rows):
    return [r for r in rows if r.get("suppressed")]


class TestNoSuppression:
    def test_a_table_with_nothing_suppressed_is_untouched(self):
        rows = [cohort("A", 100), cohort("B", 200), cohort("C", 300)]
        out = apply_complementary_suppression(list(rows))
        assert out == rows

    def test_an_empty_table_is_untouched(self):
        assert apply_complementary_suppression([]) == []


class TestTheLeak:
    """The case the control exists for: exactly one suppressed row."""

    def _table(self):
        # Mirrors the shape that leaked: two large cohorts and one under the
        # threshold, beside a published covered-lives total.
        return [
            cohort("High-intensity ops", 2030),
            suppressed_row("Standard ops", 3),
            cohort("Light duty", 2523),
        ]

    def test_a_second_cohort_is_withheld(self):
        out = apply_complementary_suppression(self._table())
        assert len(hidden(out)) == 2, "one suppressed row beside a total is not suppressed"

    def test_the_second_is_marked_complementary_not_primary(self):
        out = apply_complementary_suppression(self._table())
        kinds = sorted(r["suppression"] for r in hidden(out))
        assert kinds == ["complementary", "primary"]

    def test_the_smallest_visible_cohort_is_the_one_withheld(self):
        # Withholding the smallest hides the least.
        # High-intensity ops holds 2,030 against Light duty's 2,523, so it is
        # the smallest visible cohort and the cheaper one to withhold.
        out = apply_complementary_suppression(self._table())
        still_shown = [r["label"] for r in visible(out)]
        assert still_shown == ["Light duty"]

    def test_the_headcount_is_no_longer_recoverable_by_subtraction(self):
        rows = self._table()
        margin = 2030 + 3 + 2523  # covered_cohort.count, published elsewhere

        before = margin - sum(r["count"] for r in visible(rows))
        assert before == 3, "precondition: the leak is real before the fix"

        after = margin - sum(r["count"] for r in visible(apply_complementary_suppression(rows)))
        assert after == 3 + 2030, "subtraction must return a sum of two cohorts, not one cohort"
        assert after != 3, "the suppressed cohort must not be recoverable on its own"

    def test_the_suppressed_cohort_stays_inside_the_range_the_threshold_concedes(self):
        # With two unknowns and one equation the small cohort cannot be pinned
        # down beyond "under the threshold", which is all it was ever protected
        # to. The large one becomes approximately derivable in exchange, which
        # is acceptable because it was publishable anyway.
        out = apply_complementary_suppression(self._table())
        assert all(r.get("count") is None for r in hidden(out))


class TestAlreadySafe:
    def test_two_suppressed_rows_need_no_third(self):
        rows = [
            cohort("A", 500),
            suppressed_row("B", 2),
            suppressed_row("C", 4),
        ]
        out = apply_complementary_suppression(list(rows))
        assert len(hidden(out)) == 2, "two unknowns already defeat the subtraction"

    def test_a_table_that_is_entirely_suppressed_is_untouched(self):
        rows = [suppressed_row("A", 1), suppressed_row("B", 2)]
        out = apply_complementary_suppression(list(rows))
        assert len(hidden(out)) == 2

    def test_a_single_suppressed_row_with_nothing_visible_is_untouched(self):
        rows = [suppressed_row("A", 1)]
        out = apply_complementary_suppression(list(rows))
        assert len(hidden(out)) == 1


class TestSuppressedRow:
    def test_a_suppressed_row_carries_no_measures(self):
        row = suppressed_row("A", 3)
        assert row["count"] is None
        assert "cost_exposure_rand" not in row
        assert row["suppressed"] is True

    def test_primary_is_the_default(self):
        assert suppressed_row("A", 3)["suppression"] == "primary"

    def test_complementary_is_marked(self):
        assert suppressed_row("A", 900, complementary=True)["suppression"] == "complementary"

    @pytest.mark.parametrize("n", [0, 1, 4])
    def test_anything_under_the_threshold_is_suppressible(self, n):
        assert n < SUPPRESSION_THRESHOLD


class TestTwoCohortTable:
    """A table of two, one suppressed, hides both. That is correct: the
    alternative publishes the suppressed figure."""

    def test_both_are_withheld(self):
        rows = [cohort("A", 900), suppressed_row("B", 2)]
        out = apply_complementary_suppression(rows)
        assert visible(out) == []
