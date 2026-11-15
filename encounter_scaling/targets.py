"""Numeric target caps for explicitly approved fixed-count enemy abilities."""

from dataclasses import dataclass

from .hp import _positive_integer


@dataclass(frozen=True)
class ScaledTargetCap:
    players: int
    original_target_cap: int
    adjusted_target_cap: int
    policy_version: str = "target-cap-v1"


def scale_target_cap(base_target_cap: int, players: int) -> ScaledTargetCap:
    """Round original cap * players / 4 to nearest integer, halves upward.

    This computes an up-to limit, not guaranteed hits or an attack count.
    The caller must select an approved numeric-cap ability. Do not use on
    areas, printed Multiattack counts, or count-scaled weaker enemies.
    Target selection and combat resolution are separate, not implemented here.
    """
    _positive_integer("players", players)
    if not 4 <= players <= 8:
        raise ValueError("players must be between 4 and 8, excluding the DM")
    _positive_integer("base_target_cap", base_target_cap)

    # Exact half-up rounding; Python round() would use ties-to-even.
    cap = (base_target_cap * players + 2) // 4
    return ScaledTargetCap(players, base_target_cap, cap)
