"""Focused compatibility checks for the reported chart metrics."""
import unittest

from chart_stats import stats2
from simfile import Timing


class ChartStatsTest(unittest.TestCase):
    def test_peak_density_keeps_scalar_search_for_negative_stops(self):
        timing = Timing(0, [(0, 60)], [(4, -3)])
        rows = [(beat, timing.beat_to_time(beat), "1000") for beat in (0, 1, 3, 4, 5, 8)]
        self.assertEqual([time for _, time, _ in rows], [0, 1, 3, 4, 2, 5])
        self.assertEqual(stats2(rows)["peak_nps_2s"], 1.5)


if __name__ == "__main__":
    unittest.main()
