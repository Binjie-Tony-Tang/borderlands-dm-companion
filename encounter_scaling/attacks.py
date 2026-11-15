"""Per-target results from shared attack dice; no automatic reaction spending."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class AttackTarget:
    target_id: str
    armor_class: int
    advantage: bool = False
    disadvantage: bool = False
    attack_modifier: int = 0
    critical_on_hit: bool = False


@dataclass(frozen=True)
class AttackResult:
    target_id: str
    roll_mode: str
    selected_d20: int
    attack_total: int
    armor_class: int
    hit: bool
    critical: bool


def _integer(name: str, value: int) -> None:
    if type(value) is not int:
        raise TypeError(f"{name} must be an integer")


def _d20(name: str, value: int) -> None:
    _integer(name, value)
    if not 1 <= value <= 20:
        raise ValueError(f"{name} must be between 1 and 20")


def resolve_shared_attack(
    targets: Iterable[AttackTarget], *, primary_d20: int,
    attack_bonus: int, secondary_d20: int | None = None,
) -> tuple[AttackResult, ...]:
    """Resolve ONE combined attack using supplied dice; never rolls or rerolls.

    Normal targets use the first die even when another target needs two dice.
    Advantage/Disadvantage cancel per target; otherwise select max/min of the
    same shared pair. Effective AC and attack_modifier are supplied by the DM
    or future rules layer. critical_on_hit represents an already-verified
    printed condition, not an automatically inferred status.

    Natural 20 hits/criticals and natural 1 misses use each target's selected
    die. This is attack-only, not save resolution. Re-evaluate with the SAME
    dice after an authorized AC-changing reaction. No reactions are consumed,
    damage rolled, targets selected, range checked or target caps enforced.
    """
    _d20("primary_d20", primary_d20)
    if secondary_d20 is not None:
        _d20("secondary_d20", secondary_d20)
    _integer("attack_bonus", attack_bonus)
    results = []
    seen = set()
    for target in targets:
        if not isinstance(target, AttackTarget):
            raise TypeError("targets must contain AttackTarget values")
        if not isinstance(target.target_id, str) or not target.target_id.strip():
            raise ValueError("target_id must be a nonempty string")
        if target.target_id in seen:
            raise ValueError("a combined attack cannot target the same creature twice")
        seen.add(target.target_id)
        _integer("armor_class", target.armor_class)
        _integer("attack_modifier", target.attack_modifier)
        for name in ("advantage", "disadvantage", "critical_on_hit"):
            if type(getattr(target, name)) is not bool:
                raise TypeError(f"{name} must be a boolean")
        mode = "normal"
        selected = primary_d20
        if target.advantage != target.disadvantage:
            if secondary_d20 is None:
                raise ValueError("a second shared d20 is required for Advantage/Disadvantage")
            mode = "advantage" if target.advantage else "disadvantage"
            selected = (max if target.advantage else min)(primary_d20, secondary_d20)
        total = selected + attack_bonus + target.attack_modifier
        hit = selected != 1 and (selected == 20 or total >= target.armor_class)
        critical = hit and (selected == 20 or target.critical_on_hit)
        results.append(AttackResult(target.target_id, mode, selected, total,
                                    target.armor_class, hit, critical))
    return tuple(results)
