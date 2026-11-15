"""Run the Borderlands DM companion on this computer."""

import argparse
from collections import deque
from datetime import datetime
from functools import lru_cache
from hashlib import sha256
from http.client import HTTPConnection, HTTPException
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from tempfile import NamedTemporaryFile
from threading import Lock
from urllib.parse import parse_qs, urlsplit
import webbrowser

from encounter_scaling.count import scale_weaker_group
from encounter_scaling.hp import scale_fixed_count_hp
from public_content import missing_content
from library_index import LibraryIndex
from lorekeeper import Lorekeeper


ROOT = Path(__file__).resolve().parent
SAVE = ROOT / "local_data" / "character.json"
HOST = "127.0.0.1"
PORT = 8765
PAGE = "/character_page/"
KEEP_PAGE = "/keep_page/"
ADVENTURE_PAGE = "/adventure_page/"
COMBAT_PAGE = "/combat_page/"
LIBRARY_PAGE = "/library_page/"
PAGES = (PAGE, KEEP_PAGE, ADVENTURE_PAGE, COMBAT_PAGE, LIBRARY_PAGE, "/session_page/")
PAGE_FOLDERS = {Path(page.strip("/")) for page in PAGES}
API = "/api/character"
KEEP_SCALING_API = "/api/keep/scaling"
CREATURES_API = "/api/adventure/creatures"
LIBRARY_API = "/api/library"
RECORD_API = "/api/library/record"
LOREKEEPER_API = "/api/lorekeeper/ask"
LEVEL_DATA_JS = "/api/level-data.js"
APP_VERSION = "1.0"
MAX_SAVE_BYTES = 1024 * 1024
HISTORY_LIMIT = 20
UNSAVED_TAG = '"uninitialized"'
APP_INSTANCE = sha256(os.fsencode(ROOT)).hexdigest()
RECORD_FOLDERS = {
    "backgrounds", "classes", "equipment", "magic-items", "monsters", "npcs", "shops", "species", "spells",
}
KEEP_SOURCE_FOLDERS = {"keep-on-the-borderlands-adventure-booklet", "enemy-cards", "npc-cards", "shops"}
KEEP_SNAPSHOT_FIELDS = {"day", "hour", "period", "quests", "flags", "uses", "effects", "log"}
KEEP_QUEST_STATUSES = ("active", "completed", "rewarded")
KEEP_EFFECT_KINDS = ("house-round", "research")
MAX_SAFE_INTEGER = (1 << 53) - 1
MAP = Path("database/maps/keep-on-the-borderlands/keep-on-the-borderlands-redraw-v1.png")
KEEP_MAP_ORIGINAL = Path("database/maps/originals/keep-on-the-borderlands.png")
ADVENTURE_MAPS = {"wilderness", "trail", "woods", "fens", "tamarack-stand", "caves-of-chaos"} | {
    f"cave-{letter}" for letter in "abcdefghijk"
}
CARD_ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
ARCHIVE_TIMESTAMP = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
    r"(?:\.[0-9]{1,3})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])"
)
SHEET_FIELDS = {"inventory", "equipped", "spellIds", "wornIds", "abilities", "stats", "power", "state"}
ABILITY_FIELDS = {"STR", "DEX", "CON", "INT", "WIS", "CHA"}
STAT_LIMITS = {
    "maxHp": (1, 9999),
    "ac": (0, 999),
    "initiative": (-99, 99),
    "speed": (0, 999),
    "gold": (0, 999999),
    "spellDC": (0, 999),
    "currentHp": (0, 9999),
    "tempHp": (0, 9999),
}


def encode(document):
    return (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def valid_card_id(value):
    return isinstance(value, str) and CARD_ID.fullmatch(value) is not None


def integer_between(value, low, high):
    return type(value) is int and low <= value <= high


def valid_card_list(values):
    return (
        isinstance(values, list)
        and all(valid_card_id(value) for value in values)
        and len(set(values)) == len(values)
    )


def validate_sheet(sheet):
    if not isinstance(sheet, dict) or not sheet.keys() <= SHEET_FIELDS:
        raise ValueError("Invalid character sheet.")
    if "state" in sheet:
        validate_character_state(sheet["state"])

    inventory = sheet.get("inventory", {})
    if not isinstance(inventory, dict) or any(
        not valid_card_id(item) or type(quantity) is not int or quantity < 1
        for item, quantity in inventory.items()
    ):
        raise ValueError("Invalid inventory.")

    equipped = sheet.get("equipped", {})
    if (
        not isinstance(equipped, dict)
        or not equipped.keys() <= {"armor", "weapon", "offhand"}
        or any(item is not None and not valid_card_id(item) for item in equipped.values())
    ):
        raise ValueError("Invalid equipped items.")

    if not valid_card_list(sheet.get("spellIds", [])):
        raise ValueError("Invalid spell list.")
    if not valid_card_list(sheet.get("wornIds", [])):
        raise ValueError("Invalid worn items.")

    abilities = sheet.get("abilities", {})
    if (
        not isinstance(abilities, dict)
        or not abilities.keys() <= ABILITY_FIELDS
        or any(not integer_between(value, -20, 20) for value in abilities.values())
    ):
        raise ValueError("Invalid ability modifiers.")

    stats = sheet.get("stats", {})
    if (
        not isinstance(stats, dict)
        or not stats.keys() <= STAT_LIMITS.keys()
        or any(not integer_between(value, *STAT_LIMITS[field]) for field, value in stats.items())
    ):
        raise ValueError("Invalid character statistics.")

    power = sheet.get("power", {})
    if not isinstance(power, dict) or any(
        not isinstance(key, str) or not integer_between(value, 0, 999)
        for key, value in power.items()
    ):
        raise ValueError("Invalid Power Tokens.")


def validate_character(character):
    if not isinstance(character, dict) or character.keys() - {"sheet", "level", "subclassId"} != {
        "name", "classId", "backgroundId", "speciesId", "prepared"
    }:
        raise ValueError("Invalid character data.")

    name = character["name"]
    if not isinstance(name, str) or len(name) > 60:
        raise ValueError("Invalid character name.")
    for field in ("classId", "backgroundId", "speciesId"):
        if not valid_card_id(character[field]):
            raise ValueError("Invalid card selection.")

    level = character.get("level", 1)
    if not integer_between(level, 1, 3):
        raise ValueError("Only the printed levels 1–3 are supported.")
    levels = level_data()
    subclass = character.get("subclassId")
    if (level == 3 and subclass not in levels["subclasses"].get(character["classId"], {})) or (level < 3 and subclass is not None):
        raise ValueError("Invalid subclass selection.")
    prepared = character["prepared"]
    spell_count = levels["preparedCounts"]["wizard"][str(level)] if character["classId"] == "wizard" else 0
    if (
        not isinstance(prepared, list)
        or len(prepared) != spell_count
        or any(not valid_card_id(spell) for spell in prepared)
        or len(set(prepared)) != spell_count
    ):
        raise ValueError("Invalid prepared spells.")
    if "sheet" in character:
        validate_sheet(character["sheet"])


def empty_roster():
    return {"version": 2, "playerCount": 4, "slots": [None] * 4, "archive": []}


@lru_cache(maxsize=1)
def level_data():
    return json.loads((ROOT / "character_page/level-data.json").read_text(encoding="utf-8"))


def validate_character_state(state):
    if (
        not isinstance(state, dict)
        or not state.keys() <= {"id", "conditions", "death", "uses", "turns", "concentration", "pendingConcentration", "baseMaxHp"}
        or not valid_card_id(state.get("id"))
        or not isinstance(state.get("conditions"), list)
        or not isinstance(state.get("death"), dict)
        or not isinstance(state.get("uses"), dict)
        or not integer_between(state.get("turns"), 0, MAX_SAFE_INTEGER)
    ):
        raise ValueError("Invalid persistent character state.")
    for effect in state["conditions"]:
        validate_combat_effect(effect)
    death = state["death"]
    if any(not integer_between(death.get(field, 0), 0, 3) for field in ("successes", "failures")) or any(type(death.get(field, False)) is not bool for field in ("stable", "dead")):
        raise ValueError("Invalid saved death state.")


def validate_session(session):
    if not isinstance(session, dict) or session.keys() - {"pending"} != {"elapsedSeconds", "companions"} or not integer_between(session["elapsedSeconds"], 0, MAX_SAFE_INTEGER) or not isinstance(session["companions"], list) or len(session["companions"]) > 64:
        raise ValueError("Invalid adventure session.")
    if "pending" in session and (not isinstance(session["pending"], list) or any(not isinstance(prompt, dict) for prompt in session["pending"])):
        raise ValueError("Invalid pending adventure rolls.")
    ids = set()
    for companion in session["companions"]:
        if (not isinstance(companion, dict) or not valid_card_id(companion.get("id")) or companion["id"] in ids
            or not valid_card_id(companion.get("monster")) or not (ROOT / "database/records/monsters" / (companion["monster"] + ".md")).is_file()
            or not isinstance(companion.get("name"), str) or not integer_between(companion.get("maxHp"), 1, 9999)
            or not integer_between(companion.get("hp"), 0, companion["maxHp"]) or type(companion.get("active")) is not bool
            or companion.get("remainingFights") not in (None, 1) or not isinstance(companion.get("conditions"), list)):
            raise ValueError("Invalid companion.")
        ids.add(companion["id"])
        for effect in companion["conditions"]:
            validate_combat_effect(effect)


def validate_keep_map(mapping, valid_value):
    if not isinstance(mapping, dict) or any(
        not isinstance(key, str) or not key.strip() or len(key) > 120 or not valid_value(value)
        for key, value in mapping.items()
    ):
        raise ValueError("Invalid Keep progress entry.")


def validate_keep_snapshot(keep, *, with_undo=False):
    legacy_fields = {"stock", "undo"} if with_undo else {"stock"}
    if not isinstance(keep, dict) or keep.keys() - legacy_fields != KEEP_SNAPSHOT_FIELDS:
        raise ValueError("Invalid Keep state.")
    if (
        not integer_between(keep["day"], 1, 999)
        or not integer_between(keep["hour"], 0, 23)
        or keep["period"] not in ("day", "night")
    ):
        raise ValueError("Invalid Keep time.")
    for field in ("stock", "uses"):
        if field in keep:
            validate_keep_map(keep[field], lambda value: integer_between(value, 0, MAX_SAFE_INTEGER))
    validate_keep_map(keep["quests"], lambda value: value in KEEP_QUEST_STATUSES)
    validate_keep_map(keep["flags"], lambda value: type(value) is bool)

    effects = keep["effects"]
    if not isinstance(effects, list) or any(
        not isinstance(effect, dict)
        or effect.keys() != {"slot", "kind", "untilDay", "untilHour"}
        or not integer_between(effect["slot"], 0, 7)
        or effect["kind"] not in KEEP_EFFECT_KINDS
        or not integer_between(effect["untilDay"], 1, 1000)
        or not integer_between(effect["untilHour"], 0, 23)
        for effect in effects
    ):
        raise ValueError("Invalid Keep effects.")
    if not isinstance(keep["log"], list) or any(not isinstance(entry, str) for entry in keep["log"]):
        raise ValueError("Invalid Keep log.")


def validate_keep(keep):
    validate_keep_snapshot(keep, with_undo=True)
    undo = keep.get("undo")
    if undo is None:
        return
    if (
        not isinstance(undo, dict)
        or undo.keys() != {"message", "beforeKeep", "slots"}
        or not isinstance(undo["message"], str)
        or not isinstance(undo["slots"], list)
        or len(undo["slots"]) > 8
    ):
        raise ValueError("Invalid Keep undo.")
    validate_keep_snapshot(undo["beforeKeep"])
    indices = set()
    for slot in undo["slots"]:
        if (
            not isinstance(slot, dict)
            or slot.keys() != {"index", "before", "after"}
            or not integer_between(slot["index"], 0, 7)
            or slot["index"] in indices
        ):
            raise ValueError("Invalid Keep undo slot.")
        indices.add(slot["index"])
        validate_character(slot["before"])
        validate_character(slot["after"])


def validate_save(document):
    if (
        not isinstance(document, dict)
        or document.keys() - {"keep", "adventure", "combat", "session"} != {"version", "playerCount", "slots", "archive"}
        or type(document["version"]) is not int
        or document["version"] != 2
    ):
        raise ValueError("Unsupported character save format.")

    player_count = document["playerCount"]
    slots = document["slots"]
    if (
        type(player_count) is not int
        or not 4 <= player_count <= 8
        or not isinstance(slots, list)
        or len(slots) != player_count
    ):
        raise ValueError("Invalid character slots.")
    for character in slots:
        if character is not None:
            validate_character(character)

    archive = document["archive"]
    if not isinstance(archive, list):
        raise ValueError("Invalid character archive.")
    ids = set()
    for entry in archive:
        if not isinstance(entry, dict) or set(entry) != {"id", "deletedAt", "character"}:
            raise ValueError("Invalid archive entry.")
        entry_id = entry["id"]
        if not isinstance(entry_id, str) or not entry_id.strip() or entry_id in ids:
            raise ValueError("Invalid archive entry ID.")
        ids.add(entry_id)
        timestamp = entry["deletedAt"]
        if not isinstance(timestamp, str) or not ARCHIVE_TIMESTAMP.fullmatch(timestamp):
            raise ValueError("Invalid archive timestamp.")
        time_format = "%Y-%m-%dT%H:%M:%S.%f%z" if "." in timestamp else "%Y-%m-%dT%H:%M:%S%z"
        datetime.strptime(timestamp, time_format)
        validate_character(entry["character"])
    if "keep" in document:
        validate_keep(document["keep"])
    if "adventure" in document:
        validate_adventure(document["adventure"])
    if "combat" in document:
        validate_combat(document["combat"])
    if "session" in document:
        validate_session(document["session"])


def validate_combat_effect(effect):
    if not isinstance(effect, dict):
        raise ValueError("Invalid combat effect.")
    if "rollDisadvantage" in effect and (not isinstance(effect["rollDisadvantage"], list) or any(value not in ("all", "attack", "save", "check", "initiative") for value in effect["rollDisadvantage"])):
        raise ValueError("Invalid effect roll modifiers.")
    for field in ("ac", "acBase", "maxHp", "speed", "attackBonus", "saveBonus", "abilityBonus"):
        if field in effect and not integer_between(effect[field], -999, 999):
            raise ValueError("Invalid temporary statistic modifier.")
    for field in ("durationSeconds", "expiresAtSeconds"):
        if field in effect and not integer_between(effect[field], 0, MAX_SAFE_INTEGER):
            raise ValueError("Invalid effect duration.")
    if effect.get("key") == "exhaustion":
        for field in ("level", "levels"):
            if field in effect and not integer_between(effect[field], 0, 6):
                raise ValueError("Invalid Exhaustion level.")
    for field in ("abilities", "saves"):
        if field in effect and (
            not isinstance(effect[field], dict)
            or not effect[field].keys() <= ABILITY_FIELDS
            or any(not integer_between(value, -999, 999) for value in effect[field].values())
        ):
            raise ValueError("Invalid temporary ability modifier.")
    expiry = effect.get("expires")
    if expiry is None:
        return
    if not isinstance(expiry, dict):
        raise ValueError("Invalid combat effect expiry.")
    if expiry.get("phase") == "round-start":
        if not integer_between(expiry.get("round"), 1, MAX_SAFE_INTEGER):
            raise ValueError("Invalid round expiry.")
    elif (
        expiry.get("phase") not in ("start", "end")
        or not valid_card_id(expiry.get("actorId"))
        or not integer_between(expiry.get("turn"), 0, MAX_SAFE_INTEGER)
    ):
        raise ValueError("Invalid turn expiry.")


def validate_combat(battle):
    if not isinstance(battle, dict):
        raise ValueError("Invalid combat state.")
    if (
        battle.get("phase") not in ("setup", "initiative", "fight", "ended")
        or battle.get("source") not in ("ambush", "manual", "encounter")
        or battle.get("initiativeMode") not in ("group", "individual")
        or not integer_between(battle.get("scalePlayers"), 4, 8)
        or not integer_between(battle.get("round"), 0, MAX_SAFE_INTEGER)
        or not isinstance(battle.get("title"), str)
        or not isinstance(battle.get("actors"), list)
        or len(battle["actors"]) > 96
        or not isinstance(battle.get("order"), list)
        or not isinstance(battle.get("log"), list)
        or any(not isinstance(entry, dict) or not isinstance(entry.get("summary"), str) for entry in battle["log"])
    ):
        raise ValueError("Invalid combat state.")
    ids = set()
    for actor in battle["actors"]:
        if (
            not isinstance(actor, dict) or not valid_card_id(actor.get("id")) or actor["id"] in ids
            or actor.get("side") not in ("party", "enemy") or not isinstance(actor.get("name"), str)
            or not integer_between(actor.get("maxHp"), 1, 9999)
            or not integer_between(actor.get("hp"), 0, actor["maxHp"])
            or not integer_between(actor.get("tempHp"), 0, 9999)
            or not integer_between(actor.get("ac"), 0, 999)
            or not integer_between(actor.get("initiative"), -99, 99)
            or not isinstance(actor.get("conditions"), list)
            or any(not isinstance(effect, dict) for effect in actor["conditions"])
            or not isinstance(actor.get("saves"), dict)
            or not isinstance(actor.get("recharge"), dict)
        ):
            raise ValueError("Invalid combatant.")
        if "speed" in actor and not integer_between(actor["speed"], 0, 999):
            raise ValueError("Invalid combat speed.")
        if "movement" in actor:
            movement = actor["movement"]
            if (
                not isinstance(movement, dict)
                or not movement.keys() <= {"walk", "climb", "fly", "swim", "burrow", "hover"}
                or any(type(value) is not bool if mode == "hover" else not integer_between(value, 0, 999)
                       for mode, value in movement.items())
            ):
                raise ValueError("Invalid combat movement.")
        for effect in actor["conditions"]:
            validate_combat_effect(effect)
        if actor["side"] == "party" and not actor.get("npc") and not actor.get("object"):
            if not integer_between(actor.get("slot"), 0, 7) or not isinstance(actor.get("binding"), str):
                raise ValueError("Invalid combat character.")
        elif (not valid_card_id(actor.get("monster")) or not (ROOT / "database/records/monsters" / f'{actor["monster"]}.md').is_file()) and not (
            actor.get("object") is True and actor.get("monster") == "web"
        ):
            raise ValueError("Invalid combat enemy.")
        ids.add(actor["id"])
    order = battle["order"]
    if (
        any(not isinstance(actor_id, str) or actor_id not in ids for actor_id in order)
        or len(set(order)) != len(order)
        or battle.get("active") is not None and battle["active"] not in order
    ):
        raise ValueError("Invalid initiative order.")


def validate_adventure(state):
    if not isinstance(state, dict) or state.keys() != {"rooms", "uses", "log"}:
        raise ValueError("Invalid adventure map state.")
    validate_keep_map(state["rooms"], lambda value: value in ("visited", "completed", "rewarded"))
    validate_keep_map(state["uses"], lambda value: integer_between(value, 0, MAX_SAFE_INTEGER))
    if not isinstance(state["log"], list) or not all(isinstance(entry, str) for entry in state["log"]):
        raise ValueError("Invalid adventure map log.")


@lru_cache(maxsize=1)
def creature_cards():
    profiles_path = ROOT / "encounter_scaling/data/monster_profiles.json"
    profiles = json.loads(profiles_path.read_text(encoding="utf-8"))["profiles"]
    cards = {}
    for profile in profiles:
        slug = profile["monster_id"].split(":")[1]
        record = ROOT / "database/records/monsters" / f"{slug}.md"
        text = record.read_text(encoding="utf-8")
        line = next(line for line in text.splitlines() if line.startswith("mechanics: "))
        printed = json.loads(line.removeprefix("mechanics: "))
        reviewed = text.partition("\n## Reviewed record")[2].split("\n## ", 1)[0]
        skill_names = "Acrobatics|Animal Handling|Arcana|Athletics|Deception|History|Insight|Intimidation|Investigation|Medicine|Nature|Perception|Performance|Persuasion|Religion|Sleight of Hand|Stealth|Survival"
        skills = {skill: int(bonus.replace("−", "-")) for skill, bonus in re.findall(r"\b(" + skill_names + r")\s*([+−-][0-9]+)", reviewed)}
        cards[slug] = {
            "name": profile["name"],
            "profile": profile["default_profile"],
            "hp": printed["hit_points"],
            "ac": printed["armor_class"],
            "initiative": printed["initiative_bonus"],
            "saves": printed["saving_throw_bonuses"],
            "abilities": printed["ability_modifiers"],
            "skills": skills,
            "speed": printed["speed"],
            "challengeRating": printed["challenge_rating"],
            "kind": printed.get("size_and_type", ""),
            "printedDetails": reviewed.strip(),
            "source": f"/database/records/monsters/{slug}.md",
            "actions": [line[2:].replace("**", "") for line in reviewed.splitlines() if line.startswith("- ")],
        }
    return encode(cards)


def keep_scaling(players):
    document = json.loads((ROOT / "database/keep-scaling.json").read_text(encoding="utf-8"))
    if document.get("version") != 1 or not isinstance(document.get("encounters"), dict):
        raise ValueError("Invalid local Keep scaling configuration.")

    def prepare(node):
        if not isinstance(node, dict):
            raise ValueError("Encounter groups must be objects.")
        if "profile" not in node:
            return {key: prepare(value) for key, value in node.items()}
        profile, hp, count = node["profile"], node.get("hp"), node.get("count")
        if not integer_between(hp, 1, 9999) or not integer_between(count, 1, 96):
            raise ValueError("Invalid local encounter values.")
        if profile == "weaker":
            group = scale_weaker_group(hp, players, creature_count=count)
            return {"count": group.adjusted_count, "hp": group.adjusted_hp}
        if profile == "fixed":
            group = scale_fixed_count_hp(hp, players, creature_count=count)
            return {"count": count, "hp": group.adjusted_hp}
        if profile == "printed":
            return {"count": count, "hp": hp}
        raise ValueError("Unknown local encounter profile.")

    return prepare(document["encounters"])


def read_snapshot(path):
    try:
        with path.open("rb") as stream:
            data = stream.read(MAX_SAVE_BYTES + 1)
    except FileNotFoundError:
        return encode(empty_roster()), UNSAVED_TAG
    if len(data) > MAX_SAVE_BYTES:
        raise ValueError("Character save is too large.")
    document = json.loads(data.decode("utf-8-sig"))
    if (
        isinstance(document, dict)
        and set(document) == {"version", "character"}
        and type(document["version"]) is int
        and document["version"] == 1
    ):
        legacy_character = document["character"]
        if legacy_character is not None:
            validate_character(legacy_character)
        document = empty_roster()
        document["slots"][0] = legacy_character
    validate_save(document)
    encoded = encode(document)
    return encoded, etag(encoded)


def write_save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with NamedTemporaryFile(dir=path.parent, suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def etag(data):
    return f'"{sha256(data).hexdigest()}"'


class DashboardHistory:
    """Bounded undo and redo for the save shared by all open pages."""

    def __init__(self):
        self.undo = deque(maxlen=HISTORY_LIMIT)
        self.redo = deque(maxlen=HISTORY_LIMIT)
        self.revision = None

    def sync(self, revision):
        if revision != self.revision:
            self.undo.clear()
            self.redo.clear()
            self.revision = revision

    def record(self, previous, revision):
        self.undo.append(previous)
        self.redo.clear()
        self.revision = revision


class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = os.name != "nt"

    def __init__(self, port, save_path=SAVE, *, lorekeeper=None):
        super().__init__((HOST, port), Handler)
        self.authority = f"{HOST}:{self.server_port}"
        self.origin = f"http://{self.authority}"
        self.save_path = save_path
        self.save_lock = Lock()
        self.history = DashboardHistory()
        self.lorekeeper = lorekeeper

    @property
    def library(self):
        return library_index()


@lru_cache(maxsize=1)
def library_index():
    return LibraryIndex(ROOT)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, _format, *_args):
        pass

    def end_headers(self):
        if urlsplit(self.path).path.startswith(PAGES):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def api_response(self, status, data, tag=None):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Borderlands-Instance", APP_INSTANCE)
        self.send_header("X-Borderlands-Version", APP_VERSION)
        if tag is not None:
            self.send_header("ETag", tag)
        if hasattr(self, "history_availability"):
            self.send_header("X-Borderlands-History", self.history_availability)
        self.end_headers()
        self.wfile.write(data)

    def api_error(self, status, message):
        self.api_response(status, encode({"error": message}))

    def roster_response(self, data, tag):
        history = self.server.history
        self.history_availability = f"{int(bool(history.undo))},{int(bool(history.redo))}"
        self.api_response(200, data, tag)

    def do_GET(self):
        requested = urlsplit(self.path)
        if requested.path == LEVEL_DATA_JS:
            if self.headers.get("Host") != self.server.authority:
                self.api_error(403, "Open the app from its local address.")
                return
            try:
                body = ("globalThis.borderlandsLevelData = " + json.dumps(level_data(), ensure_ascii=True) + ";\n").encode("utf-8")
            except (OSError, ValueError):
                self.api_error(503, "Install the local level-data content adapter first.")
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if requested.path not in (API, KEEP_SCALING_API, CREATURES_API, LIBRARY_API, RECORD_API):
            super().do_GET()
            return
        if self.headers.get("Host") != self.server.authority:
            self.api_error(403, "Open the app from its local address.")
            return
        if requested.path in (LIBRARY_API, RECORD_API):
            self.get_library(requested)
            return
        if requested.path == CREATURES_API:
            try:
                data = creature_cards()
            except (OSError, ValueError, KeyError, StopIteration):
                self.api_error(500, "Could not read the monster cards.")
                return
            self.api_response(200, data)
            return
        if requested.path == KEEP_SCALING_API:
            try:
                query = parse_qs(requested.query, strict_parsing=True, max_num_fields=1)
                players, = query["players"]
                if players not in ("4", "5", "6", "7", "8"):
                    raise ValueError("Invalid player count.")
            except (KeyError, ValueError):
                self.api_error(400, "Enter a player count from 4 through 8.")
                return
            self.api_response(200, encode(keep_scaling(int(players))))
            return
        try:
            with self.server.save_lock:
                data, tag = read_snapshot(self.server.save_path)
                self.server.history.sync(tag)
                self.roster_response(data, tag)
        except (OSError, RecursionError, ValueError):
            self.api_error(500, "Could not read local_data/character.json. The save was left in place.")

    def accepts_roster_write(self):
        return self.headers.get("Host") == self.server.authority and self.headers.get("Origin") == self.server.origin

    def get_library(self, requested):
        try:
            query = parse_qs(requested.query, max_num_fields=4)
            if any(len(values) != 1 for values in query.values()):
                raise ValueError
            if requested.path == LIBRARY_API:
                if query.keys() - {"q", "category"}:
                    raise ValueError
                phrase = query.get("q", [""])[0]
                category = query.get("category", [""])[0]
                if len(phrase) > 180 or len(category) > 60:
                    raise ValueError
                result = self.server.library.browse(phrase, category)
            else:
                if query.keys() != {"id"} or len(query["id"][0]) > 180:
                    raise ValueError
                result = self.server.library.record(query["id"][0])
        except ValueError:
            self.api_error(400, "Invalid library query.")
            return
        except OSError:
            self.api_error(500, "Could not load the local library.")
            return
        if result is None:
            self.api_error(404, "Library record not found.")
            return
        self.api_response(200, encode(result))

    def ask_lorekeeper(self):
        if not self.accepts_roster_write():
            self.api_error(403, "Open Lorekeeper from the dashboard.")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if self.headers.get_content_type() != "application/json" or not 0 < length <= 48 * 1024:
                raise ValueError("问题请求格式不正确。")
            data = json.loads(self.rfile.read(length))
        except (ValueError, RecursionError):
            self.api_error(400, "问题请求格式不正确。")
            return
        try:
            keeper = self.server.lorekeeper or Lorekeeper(self.server.library, ROOT / "lorekeeper.txt")
            answer = keeper.ask(data)
        except (ValueError, RecursionError):
            self.api_error(400, "请检查问题和对话格式。")
            return
        except OSError:
            self.api_error(500, "暂时无法读取本地图书馆。")
            return
        self.api_response(200, encode(answer))

    def do_PUT(self):
        if urlsplit(self.path).path != API:
            self.send_error(404)
            return
        if not self.accepts_roster_write():
            self.api_error(403, "Save changes from the app window.")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if self.headers.get_content_type() != "application/json" or not 0 < length <= MAX_SAVE_BYTES:
                raise ValueError("Expected a character save in JSON format.")
            document = json.loads(self.rfile.read(length))
            validate_save(document)
            data = encode(document)
            if len(data) > MAX_SAVE_BYTES:
                raise ValueError("Character save is too large.")
        except (RecursionError, ValueError):
            self.api_error(400, "Invalid character save.")
            return

        try:
            with self.server.save_lock:
                previous, previous_tag = read_snapshot(self.server.save_path)
                history = self.server.history
                history.sync(previous_tag)
                if self.headers.get("If-Match") != previous_tag:
                    self.api_error(409, "The roster changed in another window. Reload before saving again.")
                    return
                previous_document = json.loads(previous)
                retained = {
                    field: previous_document[field]
                    for field in ("keep", "adventure", "combat", "session")
                    if field not in document and field in previous_document
                }
                if retained:
                    document.update(retained)
                    data = encode(document)
                    if len(data) > MAX_SAVE_BYTES:
                        self.api_error(400, "The roster and its adventure progress exceed the save limit.")
                        return
                if document == previous_document and previous_tag != UNSAVED_TAG:
                    self.roster_response(previous, previous_tag)
                    return
                write_save(self.server.save_path, data)
                revision = etag(data)
                if document != previous_document:
                    history.record(previous, revision)
                else:
                    history.revision = revision
                self.roster_response(data, revision)
        except (OSError, RecursionError, ValueError):
            self.api_error(500, "Could not write local_data/character.json. The previous save was left in place.")

    def do_POST(self):
        requested = urlsplit(self.path)
        if requested.path == LOREKEEPER_API:
            self.ask_lorekeeper()
            return
        if requested.path != API:
            self.send_error(404)
            return
        if not self.accepts_roster_write():
            self.api_error(403, "Save changes from the app window.")
            return
        actions = {
            "action=undo", "action=redo", "action=cancel-combat", "action=reset-adventure", "action=reset-everything",
        }
        if requested.query not in actions:
            self.api_error(400, "Unknown dashboard action.")
            return
        action = requested.query.removeprefix("action=")
        try:
            with self.server.save_lock:
                previous, previous_tag = read_snapshot(self.server.save_path)
                history = self.server.history
                history.sync(previous_tag)
                if self.headers.get("If-Match") != previous_tag:
                    self.api_error(409, "The roster changed in another window. Reload before saving again.")
                    return
                if action in ("undo", "redo"):
                    source, destination = (history.undo, history.redo) if action == "undo" else (history.redo, history.undo)
                    if not source:
                        self.roster_response(previous, previous_tag)
                        return
                    data = source[-1]
                    write_save(self.server.save_path, data)
                    source.pop()
                    destination.append(previous)
                    history.revision = etag(data)
                    self.roster_response(data, history.revision)
                    return

                current = json.loads(previous)
                if action == "cancel-combat":
                    if "combat" not in current:
                        self.roster_response(previous, previous_tag)
                        return
                    next_document = {key: value for key, value in current.items() if key != "combat"}
                elif action == "reset-adventure":
                    next_document = {key: value for key, value in current.items() if key not in {"keep", "adventure", "combat"}}
                else:
                    next_document = empty_roster()
                if next_document == current and previous_tag != UNSAVED_TAG:
                    self.roster_response(previous, previous_tag)
                    return
                data = encode(next_document)
                write_save(self.server.save_path, data)
                revision = etag(data)
                if next_document != current:
                    history.record(previous, revision)
                else:
                    history.revision = revision
                self.roster_response(data, revision)
        except (OSError, RecursionError, ValueError):
            self.api_error(500, "Could not update local_data/character.json.")

    def send_head(self):
        if self.headers.get("Host") != self.server.authority:
            self.send_error(403)
            return None

        requested = urlsplit(self.path).path
        pages = {page.rstrip("/"): page for page in PAGES}
        pages["/"] = PAGE
        if requested in pages:
            self.send_response(302)
            self.send_header("Location", pages[requested])
            self.end_headers()
            return None
        if requested in PAGES:
            self.path = requested + "index.html"

        absolute = Path(self.translate_path(self.path)).resolve()
        if not absolute.is_relative_to(ROOT):
            self.send_error(404)
            return None
        relative = absolute.relative_to(ROOT)
        is_page_asset = (
            relative.parent in PAGE_FOLDERS
            and relative.suffix in {".html", ".css", ".js"}
        )
        is_card = (
            len(relative.parts) == 4
            and relative.parts[:2] == ("database", "records")
            and relative.parts[2] in RECORD_FOLDERS
            and relative.suffix == ".md"
        )
        is_keep_source = (
            len(relative.parts) == 4
            and relative.parts[:2] == ("database", "sources")
            and relative.parts[2] in KEEP_SOURCE_FOLDERS
            and relative.suffix == ".md"
        )
        is_adventure_source = (
            relative.parent in {
                Path("database/sources/wilderness-adventure-booklet"),
                Path("database/sources/caves-of-chaos-adventure-booklet"),
            }
            and re.fullmatch(r"0[0-9]{2}\.md", relative.name) is not None
        )
        is_location = (
            relative.parent == Path("database/records/locations")
            and relative.suffix == ".md"
            and (
                relative.stem in ADVENTURE_MAPS | {"wilderness-random"}
                or re.fullmatch(r"keep-(?:0[1-9]|1[0-4])", relative.stem) is not None
            )
        )
        is_adventure_map = (
            len(relative.parts) == 4
            and relative.parts[:2] == ("database", "maps")
            and (
                relative.parts[2] == "originals" and relative.stem in ADVENTURE_MAPS and relative.suffix == ".png"
                or relative.parts[2] in ADVENTURE_MAPS
                and relative.name == f"{relative.parts[2]}-redraw-v{2 if relative.parts[2] == 'caves-of-chaos' else 1}.png"
            )
        )
        if not (
            is_page_asset or is_card or is_keep_source or is_adventure_source or is_location
            or is_adventure_map or relative in (MAP, KEEP_MAP_ORIGINAL)
        ) or not absolute.is_file():
            self.send_error(404)
            return None
        return super().send_head()


def is_running_here(port):
    connection = HTTPConnection(HOST, port, timeout=2)
    try:
        connection.request("GET", API)
        response = connection.getresponse()
        if response.getheader("X-Borderlands-Instance") == APP_INSTANCE:
            return "current" if response.getheader("X-Borderlands-Version") == APP_VERSION else "outdated"
    except (OSError, HTTPException):
        return False
    finally:
        connection.close()
    return False


def open_window(url):
    if os.name == "nt":
        edge = shutil.which("msedge")
        if not edge:
            for key in ("ProgramFiles(x86)", "ProgramFiles", "LocalAppData"):
                if key in os.environ:
                    candidate = Path(os.environ[key]) / "Microsoft/Edge/Application/msedge.exe"
                    if candidate.is_file():
                        edge = str(candidate)
                        break
        if edge:
            try:
                subprocess.Popen([edge, f"--app={url}"])
                return True
            except OSError:
                pass
    return webbrowser.open(url)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-browser", action="store_true", help="Start without opening a window.")
    parser.add_argument("--check-content", action="store_true", help="Check the required local content pack without starting the server.")
    args = parser.parse_args()
    missing = missing_content(ROOT)
    if missing:
        print("This public source release requires a separately supplied private content pack.")
        print("See database/README.md and docs/private-content-interface.md.")
        print("Missing required files:")
        for path in missing:
            print("  " + path)
        return 2
    if args.check_content:
        print("Required local content files are present. No content licence is inferred by this check.")
        return 0
    url = f"http://{HOST}:{PORT}{PAGE}?v={APP_VERSION}"
    try:
        server = LocalServer(PORT)
    except OSError:
        running = is_running_here(PORT)
        if running == "outdated":
            print("The older Borderlands server is still running. Press Ctrl+C in its terminal, then run this launcher again.")
            return 1
        if running == "current":
            if not args.no_browser:
                open_window(url)
            print(f"Borderlands is already running at {url}.")
            return 0
        print(f"Could not start Borderlands on port {PORT}. Close the program using that port and try again.")
        return 1

    with server:
        print(f"Borderlands is running at {url}", flush=True)
        print("Keep this window open while you play. Press Ctrl+C here to stop the app.", flush=True)
        if not args.no_browser:
            open_window(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nBorderlands stopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
