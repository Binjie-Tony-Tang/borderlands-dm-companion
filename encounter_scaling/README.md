# Attendance-scaling calculators

Original project algorithms using the Python standard library. They do not contain
or download creature cards, adventures or rules books. All source values are inputs.

```sh
python3 -m encounter_scaling --hp 20 --players 6 --count 2 --profile fixed
python3 -m encounter_scaling --hp 9 --players 6 --count 3 --profile weaker
python3 -m encounter_scaling --hp 20 --players 6 --targets 1
python3 -m unittest discover -s tests
```

On Windows use `py -3` instead of `python3` where appropriate. The calculators work
without the private dashboard content pack. Four players is the identity case.

- Fixed-count HP: `ceil(original_HP * players / 4)`; count stays unchanged.
- Count-first: `floor(original_count * players / 4)`; per-creature HP compensates
  for integer rounding of the group's total HP budget.
- Target limits: round the approved original limit times `players / 4` half up.
- Areas: line length changes linearly; radii and cone lengths change by the square
  root of attendance ratio. Round supported distances to the nearest 5 feet.
- Damage calculations share physical rolls while applying per-target defenses.

The caller selects an approved profile and supplies original values. These
calculations do not decide narrative eligibility, infer a source licence or
promise that an encounter is balanced. See the root README for formulas,
constraints and the physical-table workflow.
