from dataclasses import replace
import unittest

from encounter_scaling import AttackTarget, DamageComponent, resolve_shared_attack, shared_attack_damage


class SharedDamageTests(unittest.TestCase):
    def setUp(self):
        self.attacks = resolve_shared_attack([
            AttackTarget('normal', 10), AttackTarget('crit', 10, advantage=True),
            AttackTarget('crit2', 10, advantage=True), AttackTarget('miss', 30),
        ], primary_d20=12, secondary_d20=20, attack_bonus=5)

    def test_shared_dice_flat_bonus_once_and_types_separate(self):
        damage = shared_attack_damage(self.attacks, [
            DamageComponent('weapon', 'Piercing', (5,), 8, 3, (4,)),
            DamageComponent('fire', 'Fire', (2,), 6, critical_dice=(3,)),
        ])
        self.assertEqual([r.raw_total for r in damage], [10, 17, 17, 0])
        self.assertEqual([(c.damage_type, c.amount) for c in damage[1].components],
                         [('Piercing', 12), ('Fire', 5)])

    def test_conditional_rider_applies_only_to_eligible_target(self):
        damage = shared_attack_damage(self.attacks, [
            DamageComponent('bonus', 'Slashing', (3,), 4, target_ids=frozenset({'normal'})),
        ])
        self.assertEqual([r.raw_total for r in damage], [3, 0, 0, 0])

    def test_flat_only_damage_is_not_doubled(self):
        damage = shared_attack_damage(self.attacks, [DamageComponent('flat', 'Necrotic', (), 6, 2)])
        self.assertEqual([r.raw_total for r in damage], [2, 2, 2, 0])

    def test_no_critical_roll_needed_for_normal_hits_or_misses(self):
        component = DamageComponent('weapon', 'Piercing', (5,), 8, 3)
        damage = shared_attack_damage([self.attacks[0], self.attacks[-1]], [component])
        self.assertEqual([r.raw_total for r in damage], [8, 0])
        with self.assertRaises(ValueError):
            shared_attack_damage(self.attacks, [component])

    def test_invalid_dice_and_duplicate_inputs(self):
        valid = DamageComponent('weapon', 'Piercing', (5,), 8, 3, (4,))
        for changes in [dict(dice=(9,)), dict(dice=(True,)), dict(dice=[5]), dict(dice=None),
                        dict(critical_dice=(1, 2)), dict(critical_dice=(0,)), dict(die_sides=1),
                        dict(flat_bonus=2.5), dict(target_ids=frozenset({'unknown'}))]:
            with self.subTest(changes=changes), self.assertRaises((TypeError, ValueError)):
                shared_attack_damage(self.attacks, [replace(valid, **changes)])
        with self.assertRaises(ValueError):
            shared_attack_damage(self.attacks, [valid, valid])
        with self.assertRaises(ValueError):
            shared_attack_damage([self.attacks[0]] * 2, [valid])
        with self.assertRaises(ValueError):
            shared_attack_damage([replace(self.attacks[-1], critical=True)], [valid])


if __name__ == '__main__':
    unittest.main()
