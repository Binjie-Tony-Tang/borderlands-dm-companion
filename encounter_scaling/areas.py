"""Area dimensions and square-footprint sweep templates; not a combat engine."""

from __future__ import annotations

from dataclasses import dataclass
from math import isqrt

from .hp import _positive_integer


@dataclass(frozen=True)
class ScaledArea:
    players: int
    shape: str
    original_distance_feet: int
    adjusted_distance_feet: int
    width_feet: int | None
    sweep_angle: int | None
    targeting_policy: str
    policy_version: str = "area-v1"


def _grid_distance(name: str, value: int) -> None:
    _positive_integer(name, value)
    if value % 5:
        raise ValueError(f"{name} must be a multiple of 5 feet")


def scale_area(
    shape: str, base_distance_feet: int, players: int, *,
    width_feet: int | None = None, sweep_angle: int | None = None,
) -> ScaledArea:
    """Scale an approved area, preserving its shape and targeting semantics.

    Distance means length for cone/line, radius for circle, reach for sweep,
    and distance from the printed origin for emanation. Line width is fixed.
    All input distances use the project's 5-foot grid. Unsupported geometry
    is rejected rather than silently approximated. Caller selects approved
    fixed-profile abilities: this does not turn printed attacks into sweeps,
    including at four players, or scale count-first enemies' abilities.
    """
    _positive_integer("players", players)
    if not 4 <= players <= 8:
        raise ValueError("players must be between 4 and 8, excluding the DM")
    if shape not in ("cone", "line", "circle", "emanation", "sweep"):
        raise ValueError("shape must be cone, line, circle, emanation, or sweep")
    _grid_distance("base_distance_feet", base_distance_feet)
    if shape == "line":
        _grid_distance("width_feet", width_feet)
    elif width_feet is not None:
        raise ValueError("width_feet is only applicable to lines")
    if shape == "sweep":
        if type(sweep_angle) is not int or sweep_angle not in (180, 360):
            raise ValueError("sweep_angle must be 180 or 360")
    elif sweep_angle is not None:
        raise ValueError("sweep_angle is only applicable to sweeps")

    if players == 4:
        distance = base_distance_feet
    elif shape == "line":
        # nearest 5 feet, halves up: 5 * floor((L*N/4)/5 + 1/2)
        distance = 5 * ((base_distance_feet * players + 10) // 20)
    else:
        # In grid units x = L*sqrt(N)/10. Compare squared quantities exactly
        # at the half-grid threshold, avoiding floating-point tie errors.
        squared = base_distance_feet**2 * players
        lower = isqrt(squared) // 10
        round_up = squared >= 25 * (2 * lower + 1)**2
        distance = 5 * (lower + int(round_up))
    return ScaledArea(
        players, shape, base_distance_feet, distance, width_feet, sweep_angle,
        "enemies_only" if shape == "sweep" else "printed",
    )


def sweep_offsets(
    reach_feet: int, angle: int, *, facing: str = "north", footprint_size: int = 1,
) -> tuple[tuple[int, int], ...]:
    """Grid offsets relative to the attacker's southwest square; x east/y north.

    footprint_size is the side length of the square token in grid squares,
    not feet. Its occupied coordinates are 0..size-1 on both axes. Reach is
    measured beyond its edges. Exclude its whole occupied footprint; include
    corners. For 180 degrees include the front-edge row/column and the reach
    beyond it, not the rows behind that edge. Cardinal facings only.

    Returns geometric candidate squares, not hit targets: the caller must
    check enemies/obstructions and deduplicate creatures. No attack or cooldown
    is granted by this helper. Default size 1 preserves the original API.
    """
    _grid_distance("reach_feet", reach_feet)
    if type(angle) is not int or angle not in (180, 360):
        raise ValueError("angle must be 180 or 360")
    if facing not in ("north", "east", "south", "west"):
        raise ValueError("only cardinal facings are supported")
    _positive_integer("footprint_size", footprint_size)
    radius = reach_feet // 5
    last = footprint_size - 1
    offsets = []
    for y in range(-radius, footprint_size + radius):
        for x in range(-radius, footprint_size + radius):
            if 0 <= x <= last and 0 <= y <= last:
                continue
            forward = {"north": y - last, "east": x - last,
                       "south": -y, "west": -x}[facing]
            if angle == 360 or forward >= 0:
                offsets.append((x, y))
    return tuple(offsets)
