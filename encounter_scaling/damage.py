"""Shared rolled damage components before individual defenses."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .attacks import AttackResult, _integer


@dataclass(frozen=True)
class DamageComponent:
    component_id: str
    damage_type: str
    dice: tuple[int, ...]
    die_sides: int
    flat_bonus: int = 0
    critical_dice: tuple[int, ...] | None = None
    target_ids: frozenset[str] | None = None


@dataclass(frozen=True)
class ComponentDamage:
    component_id: str
    damage_type: str
    amount: int


@dataclass(frozen=True)
class DamageResult:
    target_id: str
    critical: bool
    components: tuple[ComponentDamage, ...]
    raw_total: int


def shared_attack_damage(
    attacks: Iterable[AttackResult], components: Iterable[DamageComponent],
) -> tuple[DamageResult, ...]:
    """Apply one shared normal roll and one extra dice set for critical hits.

    Dice are supplied, never generated. Each damage type/rider is a separate
    component; target_ids restricts a conditional rider to eligible targets.
    Every applicable critical target shares that component's critical dice;
    flat bonuses apply once. A critical dice set is required only when an
    applicable critical hit needs it. Flat-only components use an empty tuple.

    Outputs are PRE-DEFENSE amounts by type, not final HP loss. The caller must
    apply saves, resistances, immunity, vulnerability and reactions under their
    printed rules. This helper is attack-only and does not create critical
    damage for saving-throw abilities or ongoing damage.
    """
    attacks, components = tuple(attacks), tuple(components)
    ids = set()
    for attack in attacks:
        if not isinstance(attack, AttackResult):
            raise TypeError("attacks must contain AttackResult values")
        if attack.target_id in ids:
            raise ValueError("duplicate target in combined attack")
        if attack.critical and not attack.hit:
            raise ValueError("a missed attack cannot be critical")
        ids.add(attack.target_id)
    component_ids = set()
    for component in components:
        if not isinstance(component, DamageComponent):
            raise TypeError("components must contain DamageComponent values")
        if not isinstance(component.component_id, str) or not component.component_id.strip():
            raise ValueError("component_id must be a nonempty string")
        if component.component_id in component_ids:
            raise ValueError("duplicate damage component")
        component_ids.add(component.component_id)
        if not isinstance(component.damage_type, str) or not component.damage_type.strip():
            raise ValueError("damage_type must be a nonempty string")
        _integer("die_sides", component.die_sides)
        if component.die_sides < 2:
            raise ValueError("die_sides must be at least 2")
        _integer("flat_bonus", component.flat_bonus)
        for rolls in (component.dice, component.critical_dice):
            if rolls is None:
                continue
            if type(rolls) is not tuple:
                raise TypeError("rolled dice must be tuples")
            for roll in rolls:
                _integer("damage die", roll)
                if not 1 <= roll <= component.die_sides:
                    raise ValueError("damage die outside its permitted range")
        if component.dice is None:
            raise TypeError("normal dice must be a tuple (empty for flat-only damage)")
        if component.critical_dice is not None and len(component.critical_dice) != len(component.dice):
            raise ValueError("critical dice must match the normal dice count")
        if component.target_ids is not None:
            if not isinstance(component.target_ids, frozenset):
                raise TypeError("target_ids must be a frozenset or None")
            if not component.target_ids <= ids:
                raise ValueError("damage component names an unknown target")
        needs_critical = any(a.hit and a.critical and (
            component.target_ids is None or a.target_id in component.target_ids
        ) for a in attacks)
        if needs_critical and component.dice and component.critical_dice is None:
            raise ValueError("applicable critical hits require shared extra damage dice")

    results = []
    for attack in attacks:
        applied = []
        if attack.hit:
            for component in components:
                if component.target_ids is not None and attack.target_id not in component.target_ids:
                    continue
                amount = sum(component.dice) + component.flat_bonus
                if attack.critical:
                    amount += sum(component.critical_dice or ())
                applied.append(ComponentDamage(component.component_id, component.damage_type, max(0, amount)))
        results.append(DamageResult(attack.target_id, attack.critical, tuple(applied),
                                    sum(c.amount for c in applied)))
    return tuple(results)
