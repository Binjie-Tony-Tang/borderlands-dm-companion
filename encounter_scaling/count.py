"""Approved count-first scaling for homogeneous weaker-enemy groups."""

from dataclasses import dataclass

from .hp import _positive_integer


@dataclass(frozen=True)
class CountScaledGroup:
    players: int
    original_hp: int
    adjusted_hp: int
    original_count: int
    adjusted_count: int
    policy_version: str = "count-first-v1"


def scale_weaker_group(
    base_hp: int, players: int, *, creature_count: int
) -> CountScaledGroup:
    """Scale from original encounter values, not current/previously scaled HP.

    Call once per prepared homogeneous enemy group. The caller must select
    this profile; named/unique creatures should use fixed-count scaling.
    Damage and abilities are unchanged. An absent group is not a valid input.
    """
    _positive_integer("players", players)
    if not 4 <= players <= 8:
        raise ValueError("players must be between 4 and 8, excluding the DM")
    _positive_integer("base_hp", base_hp)
    _positive_integer("creature_count", creature_count)

    count = creature_count * players // 4
    numerator = creature_count * base_hp * players
    denominator = 4 * count
    hp = (numerator + denominator - 1) // denominator
    return CountScaledGroup(players, base_hp, hp, creature_count, count)
