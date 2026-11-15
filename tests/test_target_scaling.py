from fractions import Fraction
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest

from encounter_scaling import scale_target_cap


class TargetScalingTests(unittest.TestCase):
    def test_approved_table(self):
        for cap, expected in [(1, [1, 1, 2, 2, 2]),
                              (2, [2, 3, 3, 4, 4]),
                              (3, [3, 4, 5, 5, 6])]:
            self.assertEqual([scale_target_cap(cap, n).adjusted_target_cap
                              for n in range(4, 9)], expected)

    def test_exact_rounding_identity_and_monotonicity(self):
        for cap in list(range(1, 501)) + [10**30 + 1]:
            values = []
            for n in range(4, 9):
                result = scale_target_cap(cap, n)
                self.assertEqual(result.original_target_cap, cap)
                self.assertEqual(result.adjusted_target_cap,
                                 math.floor(Fraction(cap * n, 4) + Fraction(1, 2)))
                self.assertIs(type(result.adjusted_target_cap), int)
                values.append(result.adjusted_target_cap)
            self.assertEqual(values[0], cap)
            self.assertEqual(values[-1], cap * 2)
            self.assertEqual(values, sorted(values))

    def test_invalid_inputs(self):
        for key in ("base_target_cap", "players"):
            for value in [0, -1, True, 1.5, "4", None] + ([3, 9] if key == "players" else []):
                args = dict(base_target_cap=1, players=4)
                args[key] = value
                with self.subTest(key=key, value=value), self.assertRaises(
                    ValueError if type(value) is int else TypeError
                ):
                    scale_target_cap(**args)

    def test_cli_returns_hp_and_target_cap(self):
        run = self.run_cli("--targets", "1")
        self.assertEqual(run.returncode, 0, run.stderr)
        result = json.loads(run.stdout)
        self.assertEqual(result["adjusted_hp"], 78)
        self.assertEqual(result["target_scaling"]["adjusted_target_cap"], 2)

    def test_cli_rejects_target_scaling_for_weaker_groups(self):
        run = self.run_cli("--profile", "weaker", "--targets", "1")
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("weaker abilities stay printed", run.stderr)

    @staticmethod
    def run_cli(*args):
        return subprocess.run(
            [sys.executable, "-m", "encounter_scaling", "--hp", "52", "--players", "6", *args],
            cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True,
        )


if __name__ == "__main__":
    unittest.main()
