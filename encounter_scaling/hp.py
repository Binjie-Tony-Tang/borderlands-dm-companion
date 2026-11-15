"""Fixed-count maximum HP scaling, approved in design topic 07."""

from dataclasses import dataclass


@dataclass(frozen=True)
class FixedCountHP:
    """HP-only result for a group whose printed creature count is retained."""

    players: int
    original_hp: int
    adjusted_hp: int
    creature_count: int
    policy_version: str = "fixed-count-hp-v1"


def _positive_integer(name: str, value: int) -> None:
    # bool is an int subclass, but is not a valid attendance/HP/count input.
    if type(value) is not int:
        raise TypeError(f"{name} must be an integer")
    if value < 1:
        raise ValueError(f"{name} must be positive")


def scale_fixed_count_hp(
    base_hp: int, players: int, *, creature_count: int = 1
) -> FixedCountHP:
    """Scale each creature's maximum HP by attendance, keeping count unchanged.

    base_hp is the official encounter's per-creature maximum HP, including
    any printed encounter override. Supply original HP on every call, never
    previously scaled or current HP. This function is only for groups assigned
    the fixed-count profile; it does not select profiles from CR, scale weaker
    groups, change damage/abilities, or rebalance an encounter by itself.
    """
    _positive_integer("players", players)
    if not 4 <= players <= 8:
        raise ValueError("players must be between 4 and 8, excluding the DM")
    _positive_integer("base_hp", base_hp)
    _positive_integer("creature_count", creature_count)

    # Exact ceil(base_hp * players / 4), without floating-point rounding.
    adjusted_hp = (base_hp * players + 3) // 4
    return FixedCountHP(players, base_hp, adjusted_hp, creature_count)
