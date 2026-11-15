from dataclasses import replace
import unittest

from encounter_scaling import AttackTarget, resolve_shared_attack


class SharedAttackTests(unittest.TestCase):
    def test_mixed_targets_share_dice_but_not_outcomes(self):
        targets = [AttackTarget("normal", 18), AttackTarget("adv", 18, advantage=True),
                   AttackTarget("dis", 14, disadvantage=True),
                   AttackTarget("cancel", 15, advantage=True, disadvantage=True)]
        result = resolve_shared_attack(targets, primary_d20=10, secondary_d20=17, attack_bonus=5)
        self.assertEqual([r.selected_d20 for r in result], [10, 17, 10, 10])
        self.assertEqual([r.hit for r in result], [False, True, True, True])
        self.assertEqual([r.roll_mode for r in result], ["normal", "advantage", "disadvantage", "normal"])

    def test_every_pair_selects_correct_die(self):
        for first in range(1, 21):
            for second in range(1, 21):
                targets = [AttackTarget("n", 15), AttackTarget("a", 15, advantage=True),
                           AttackTarget("d", 15, disadvantage=True)]
                result = resolve_shared_attack(targets, primary_d20=first,
                                               secondary_d20=second, attack_bonus=5)
                self.assertEqual([r.selected_d20 for r in result],
                                 [first, max(first, second), min(first, second)])

    def test_cancellation_does_not_need_second_die(self):
        result = resolve_shared_attack([AttackTarget("a", 10, True, True)],
                                       primary_d20=10, attack_bonus=0)
        self.assertTrue(result[0].hit)
        with self.assertRaises(ValueError):
            resolve_shared_attack([AttackTarget("a", 10, advantage=True)], primary_d20=10, attack_bonus=0)

    def test_natural_rolls_and_per_target_criticals(self):
        targets = [AttackTarget("n", 100), AttackTarget("a", 100, advantage=True),
                   AttackTarget("d", -100, disadvantage=True)]
        result = resolve_shared_attack(targets, primary_d20=1, secondary_d20=20, attack_bonus=0)
        self.assertEqual([(r.hit, r.critical) for r in result], [(False, False), (True, True), (False, False)])
        for die, ac, expected in [(12, 10, True), (12, 20, False), (1, -100, False)]:
            r = resolve_shared_attack([AttackTarget("c", ac, critical_on_hit=True)],
                                      primary_d20=die, attack_bonus=0)[0]
            self.assertEqual(r.critical, expected)

    def test_reaction_recheck_changes_only_reacting_target(self):
        targets = [AttackTarget("a", 15), AttackTarget("b", 15)]
        before = resolve_shared_attack(targets, primary_d20=10, attack_bonus=5)
        after = resolve_shared_attack([replace(targets[0], armor_class=17), targets[1]],
                                      primary_d20=10, attack_bonus=5)
        self.assertEqual([r.hit for r in before], [True, True])
        self.assertEqual([r.hit for r in after], [False, True])
        self.assertEqual(after[1], before[1])

    def test_modifier_and_empty_target_list(self):
        r = resolve_shared_attack([AttackTarget("a", 16, attack_modifier=-2)],
                                  primary_d20=12, attack_bonus=5)[0]
        self.assertEqual(r.attack_total, 15)
        self.assertFalse(r.hit)
        self.assertEqual(resolve_shared_attack([], primary_d20=10, attack_bonus=5), ())

    def test_invalid_inputs_and_duplicate_targets(self):
        for die in (0, 21, True, 1.5, "10"):
            with self.assertRaises((TypeError, ValueError)):
                resolve_shared_attack([], primary_d20=die, attack_bonus=0)
            with self.assertRaises((TypeError, ValueError)):
                resolve_shared_attack([], primary_d20=10, secondary_d20=die, attack_bonus=0)
        for target in [AttackTarget("", 10), AttackTarget("a", True),
                       AttackTarget("a", 10, advantage=1),
                       AttackTarget("a", 10, attack_modifier=1.5),
                       AttackTarget("a", 10, critical_on_hit=1), "a"]:
            with self.assertRaises((TypeError, ValueError)):
                resolve_shared_attack([target], primary_d20=10, attack_bonus=0)
        with self.assertRaises(ValueError):
            resolve_shared_attack([AttackTarget("a", 10)] * 2, primary_d20=10, attack_bonus=0)


if __name__ == "__main__":
    unittest.main()
