"""Public/private installation boundary; this module contains no game content."""
from pathlib import Path

REQUIRED_CONTENT = (
    'adventure_page/private-config.js',
    'database/records.jsonl',
    'database/maps/catalog.json',
    'database/maps/redraw-status.json',
    'database/keep-scaling.json',
    'encounter_scaling/data/monster_profiles.json',
    'character_page/classes.js',
    'character_page/origins.js',
    'character_page/items-spells.js',
    'character_page/adventure-catalog.js',
    'character_page/level-data.json',
    'combat_page/actions.js',
    'combat_page/monsters-fixed.js',
    'combat_page/monsters-ordinary.js',
    'keep_page/content.js',
    'adventure_page/wilderness.js',
    'adventure_page/caves-early.js',
    'adventure_page/caves-late.js',
    'adventure_page/intro.js',
    'adventure_page/hazards.js',
    'adventure_page/companions.js',
)


def missing_content(root):
    """Report required adapters without opening any credential or campaign file.

    Presence is an installation check, not a statement about the material's rights.
    The optional AI credential is deliberately never part of this preflight.
    """
    root = Path(root)
    return [relative for relative in REQUIRED_CONTENT if not (root / relative).is_file()]
