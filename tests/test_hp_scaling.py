import math
from fractions import Fraction
import unittest

from encounter_scaling import scale_fixed_count_hp


class FixedCountHPTests(unittest.TestCase):
    def test_fixed_profile_reference_examples(self):
        self.assertEqual(
            [scale_fixed_count_hp(52, n).adjusted_hp for n in range(4, 9)],
            [52, 65, 78, 91, 104],
        )

    def test_fractional_hp_rounds_up(self):
        self.assertEqual(
            [scale_fixed_count_hp(21, n).adjusted_hp for n in range(4, 9)],
            [21, 27, 32, 37, 42],
        )

    def test_identity_bounds_and_monotonicity(self):
        for hp in range(1, 501):
            values = []
            for players in range(4, 9):
                result = scale_fixed_count_hp(hp, players, creature_count=3)
                self.assertEqual(result.original_hp, hp)
                self.assertEqual(result.creature_count, 3)
                self.assertEqual(result.adjusted_hp, math.ceil(Fraction(hp * players, 4)))
                self.assertIs(type(result.adjusted_hp), int)
                values.append(result.adjusted_hp)
            self.assertEqual(values[0], hp)
            self.assertEqual(values[-1], hp * 2)
            self.assertEqual(values, sorted(values))

    def test_large_integers_remain_exact(self):
        hp = 10**30 + 1
        self.assertEqual(scale_fixed_count_hp(hp, 5).adjusted_hp,
                         math.ceil(Fraction(hp * 5, 4)))

    def test_invalid_attendance(self):
        for players in (-1, 0, 3, 9):
            with self.subTest(players=players), self.assertRaises(ValueError):
                scale_fixed_count_hp(52, players)
        for players in (True, 4.0, "4", None):
            with self.subTest(players=players), self.assertRaises(TypeError):
                scale_fixed_count_hp(52, players)

    def test_invalid_hp_and_count(self):
        for field in ("base_hp", "creature_count"):
            for value in (0, -1, True, 1.5, "2", None):
                args = {"base_hp": 52, "players": 8, "creature_count": 1}
                args[field] = value
                expected = ValueError if type(value) is int else TypeError
                with self.subTest(field=field, value=value), self.assertRaises(expected):
                    scale_fixed_count_hp(**args)


if __name__ == "__main__":
    unittest.main()
