from fractions import Fraction
import math
import unittest

from encounter_scaling import scale_weaker_group


class CountScalingTests(unittest.TestCase):
    def test_count_first_reference_example(self):
        results = [scale_weaker_group(11, n, creature_count=3) for n in range(4, 9)]
        self.assertEqual([(r.adjusted_count, r.adjusted_hp) for r in results],
                         [(3, 11), (3, 14), (4, 13), (5, 12), (6, 11)])

    def test_single_creature_never_disappears(self):
        self.assertEqual(
            [(r.adjusted_count, r.adjusted_hp) for n in range(4, 9)
             for r in [scale_weaker_group(7, n, creature_count=1)]],
            [(1, 7), (1, 9), (1, 11), (1, 13), (2, 7)],
        )

    def test_exact_budget_and_endpoints(self):
        for count in range(1, 41):
            for hp in range(1, 101):
                for n in range(4, 9):
                    r = scale_weaker_group(hp, n, creature_count=count)
                    expected_count = math.floor(Fraction(count * n, 4))
                    budget = Fraction(count * hp * n, 4)
                    self.assertEqual(r.adjusted_count, expected_count)
                    self.assertEqual(r.adjusted_hp, math.ceil(budget / expected_count))
                    self.assertGreaterEqual(r.adjusted_hp, hp)
                    total = r.adjusted_count * r.adjusted_hp
                    self.assertGreaterEqual(total, budget)
                    self.assertLess(total - budget, r.adjusted_count)
                    self.assertEqual((r.original_hp, r.original_count), (hp, count))
                    if n in (4, 8):
                        self.assertEqual(r.adjusted_hp, hp)
                        self.assertEqual(r.adjusted_count, count * (n // 4))

    def test_rounding_can_reduce_total_hp_despite_more_creatures(self):
        # Document the approved formula's rounding limit, not a balance fix.
        seven = scale_weaker_group(5, 7, creature_count=7)
        eight = scale_weaker_group(5, 8, creature_count=7)
        self.assertEqual((seven.adjusted_count, seven.adjusted_hp), (12, 6))
        self.assertEqual((eight.adjusted_count, eight.adjusted_hp), (14, 5))

    def test_invalid_inputs(self):
        for key in ("players", "base_hp", "creature_count"):
            invalid = [0, -1, True, 1.5, "4", None]
            if key == "players":
                invalid += [3, 9]
            for value in invalid:
                args = dict(base_hp=11, players=4, creature_count=3)
                args[key] = value
                error = ValueError if type(value) is int else TypeError
                with self.subTest(key=key, value=value), self.assertRaises(error):
                    scale_weaker_group(**args)


if __name__ == "__main__":
    unittest.main()
