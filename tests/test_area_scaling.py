from decimal import Decimal, ROUND_HALF_UP, localcontext
import json
from pathlib import Path
import subprocess
import sys
import unittest

from encounter_scaling import scale_area, sweep_offsets


class AreaScalingTests(unittest.TestCase):
    def test_agreed_examples(self):
        self.assertEqual([scale_area("cone", 15, n).adjusted_distance_feet for n in range(4, 9)],
                         [15, 15, 20, 20, 20])
        self.assertEqual([scale_area("circle", 10, n).adjusted_distance_feet for n in range(4, 9)],
                         [10, 10, 10, 15, 15])
        self.assertEqual([scale_area("line", 20, n, width_feet=5).adjusted_distance_feet
                          for n in range(4, 9)], [20, 25, 30, 35, 40])

    def test_small_area_and_exact_line_tie(self):
        self.assertEqual(scale_area("sweep", 5, 8, sweep_angle=180).adjusted_distance_feet, 5)
        self.assertEqual(scale_area("line", 10, 5, width_feet=5).adjusted_distance_feet, 15)

    def test_reference_rounding_and_preserved_metadata(self):
        with localcontext() as context:
            context.prec = 100
            for distance in list(range(5, 201, 5)) + [5 * 10**30]:
                for shape in ("cone", "circle", "emanation", "sweep", "line"):
                    kwargs = {"width_feet": 5} if shape == "line" else (
                        {"sweep_angle": 360} if shape == "sweep" else {})
                    values = []
                    for n in range(4, 9):
                        result = scale_area(shape, distance, n, **kwargs)
                        ratio = Decimal(n) / 4
                        raw = Decimal(distance) * (ratio if shape == "line" else ratio.sqrt())
                        expected = int((raw / 5).quantize(Decimal(1), rounding=ROUND_HALF_UP)) * 5
                        self.assertEqual(result.adjusted_distance_feet, expected)
                        self.assertEqual(result.original_distance_feet, distance)
                        self.assertEqual(result.width_feet, kwargs.get("width_feet"))
                        self.assertEqual(result.sweep_angle, kwargs.get("sweep_angle"))
                        self.assertEqual(result.targeting_policy,
                                         "enemies_only" if shape == "sweep" else "printed")
                        if n == 4:
                            self.assertEqual(result.adjusted_distance_feet, distance)
                        values.append(result.adjusted_distance_feet)
                    self.assertEqual(values, sorted(values))

    def test_sweep_templates(self):
        full = set(sweep_offsets(10, 360))
        self.assertEqual(len(full), 24)
        self.assertNotIn((0, 0), full)
        self.assertTrue({(-2, -2), (2, 2), (-2, 2), (2, -2)} <= full)
        for facing in ("north", "east", "south", "west"):
            half = set(sweep_offsets(10, 180, facing=facing))
            self.assertEqual(len(half), 14)
            self.assertTrue(half <= full)
            for x, y in half:
                self.assertGreaterEqual({"north": y, "east": x, "south": -y, "west": -x}[facing], 0)
        north = set(sweep_offsets(10, 180))
        self.assertTrue({(-2, 0), (2, 0), (-2, 2), (2, 2)} <= north)

    def test_invalid_inputs(self):
        for kwargs in [dict(players=3), dict(players=9), dict(players=True), dict(players=5.0),
                       dict(shape="cube"), dict(base_distance_feet=7), dict(base_distance_feet=0),
                       dict(base_distance_feet=True), dict(width_feet=5), dict(sweep_angle=180),
                       dict(shape="line"), dict(shape="line", width_feet=3),
                       dict(shape="sweep"), dict(shape="sweep", sweep_angle=90)]:
            args = dict(shape="cone", base_distance_feet=15, players=8)
            args.update(kwargs)
            with self.subTest(args=args), self.assertRaises((TypeError, ValueError)):
                scale_area(**args)
        for args in [(10, 90, "north"), (7, 180, "north"), (10, 180, "northeast")]:
            with self.assertRaises(ValueError):
                sweep_offsets(args[0], args[1], facing=args[2])

    def test_large_sweep_matches_approved_layout(self):
        body = {(0, 0), (1, 0), (0, 1), (1, 1)}
        full = set(sweep_offsets(10, 360, footprint_size=2))
        expected_full = {(x, y) for x in range(-2, 4) for y in range(-2, 4)} - body
        self.assertEqual(full, expected_full)
        self.assertEqual(len(full), 32)
        north = set(sweep_offsets(10, 180, footprint_size=2))
        expected_north = {(x, y) for x in range(-2, 4) for y in (1, 2, 3)} - body
        self.assertEqual(north, expected_north)
        self.assertEqual(len(north), 16)
        self.assertTrue({(-2, 1), (3, 1)} <= north)  # front-edge flanks
        self.assertNotIn((-1, 0), north)  # no rear-edge side row

    def test_square_footprints_rotate_about_the_body(self):
        for size in (1, 2, 3, 4):
            body = {(x, y) for x in range(size) for y in range(size)}
            for reach in (5, 10, 15):
                full = set(sweep_offsets(reach, 360, footprint_size=size))
                self.assertFalse(full & body)
                radius = reach // 5
                self.assertEqual(len(full), (size + 2 * radius)**2 - size**2)
                current = set(sweep_offsets(reach, 180, footprint_size=size))
                for facing in ("east", "south", "west", "north"):
                    # Clockwise rotation around the center of the occupied body.
                    current = {(y, size - 1 - x) for x, y in current}
                    actual = set(sweep_offsets(reach, 180, facing=facing, footprint_size=size))
                    self.assertEqual(actual, current)
                    self.assertTrue(actual <= full)
                    self.assertEqual(len(actual), (size + 2 * radius) * (radius + 1) - size)

    def test_invalid_footprint(self):
        for size in (0, -1, True, 2.0, "2", None):
            with self.subTest(size=size), self.assertRaises(
                ValueError if type(size) is int else TypeError
            ):
                sweep_offsets(10, 180, footprint_size=size)

    def test_cli(self):
        base = [sys.executable, "-m", "encounter_scaling", "--hp", "75", "--players", "8"]
        cwd = Path(__file__).resolve().parents[1]
        run = subprocess.run(base + ["--area", "cone", "--distance", "15"],
                             cwd=cwd, capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(json.loads(run.stdout)["area_scaling"]["adjusted_distance_feet"], 20)
        for flags in [["--area", "cone"], ["--distance", "15"],
                      ["--area", "line", "--distance", "20"],
                      ["--area", "cone", "--distance", "15", "--profile", "weaker"],
                      ["--area", "cone", "--distance", "15", "--targets", "1"]]:
            run = subprocess.run(base + flags, cwd=cwd, capture_output=True, text=True)
            self.assertNotEqual(run.returncode, 0)


if __name__ == "__main__":
    unittest.main()
