"""Approved attendance scaling rules; official source records stay unchanged."""

from .hp import FixedCountHP, scale_fixed_count_hp
from .count import CountScaledGroup, scale_weaker_group
from .targets import ScaledTargetCap, scale_target_cap
from .areas import ScaledArea, scale_area, sweep_offsets
from .attacks import AttackTarget, AttackResult, resolve_shared_attack
from .damage import DamageComponent, ComponentDamage, DamageResult, shared_attack_damage

__all__ = ["FixedCountHP", "scale_fixed_count_hp", "CountScaledGroup", "scale_weaker_group",
           "ScaledTargetCap", "scale_target_cap", "ScaledArea", "scale_area", "sweep_offsets",
           "AttackTarget", "AttackResult", "resolve_shared_attack",
           "DamageComponent", "ComponentDamage", "DamageResult", "shared_attack_damage"]
