"""Local catalogue and evidence retrieval for the Borderlands reference tools."""

import json
import math
import re
import unicodedata
from collections import Counter
from pathlib import Path
from urllib.parse import quote

from library_chinese import populate as chinese_reader_text


CATEGORIES = (
    ("monsters", "Monsters", "怪物"),
    ("spells", "Spells", "法术"),
    ("equipment", "Equipment", "装备"),
    ("magic-items", "Magic items", "魔法物品"),
    ("classes", "Classes", "职业"),
    ("backgrounds", "Backgrounds", "背景"),
    ("species", "Species", "种族"),
    ("npcs", "NPCs", "非玩家角色"),
    ("shops", "Shops and services", "商店与服务"),
    ("locations", "Locations", "地点"),
    ("quests", "Quests", "任务"),
    ("encounters", "Encounters", "遭遇"),
    ("maps", "Maps", "地图"),
    ("rules", "Local rules", "本地规则"),
    ("house-rules", "Table rules and design", "房规与设计"),
    ("sources", "Sources and scans", "原始资料与扫描"),
)
SOURCE_KINDS = {"source_page": "sources", "source_photo": "sources", "map": "maps"}
KEEP = "keep-on-the-borderlands-adventure-booklet"
WILD = "wilderness-adventure-booklet"
CAVES = "caves-of-chaos-adventure-booklet"
GUIDE = "play-guide-reference-booklet"
CONCEPTS = {
    "advantage": ("优势",),
    "disadvantage": ("劣势",),
    "armor class": ("护甲等级", "护甲值", "ac"),
    "attack roll": ("攻击检定", "命中检定", "命中骰"),
    "bonus action": ("附赠动作", "奖励动作", "附加动作"),
    "concentration": ("专注", "集中"),
    "condition": ("状态", "异常状态"),
    "critical hit": ("重击", "暴击"),
    "damage": ("伤害",),
    "death saving throw": ("死亡豁免", "死亡检定", "death save"),
    "drops": ("掉落", "掉什么", "掉装备", "战利品", "loot", "drop"),
    "equipment": ("装备", "道具"),
    "exhaustion": ("力竭",),
    "grappled": ("grapple", "grappling", "擒抱", "被擒抱"),
    "healing": ("治疗", "回血", "恢复"),
    "heavily obscured": ("重度遮蔽", "严重遮蔽"),
    "incapacitated": ("失能", "无法行动"),
    "hit points": ("生命值", "血量", "血上限", "hp", "hit point"),
    "initiative": ("先攻",),
    "long rest": ("长休",),
    "short rest": ("短休",),
    "stabilization": ("stable", "stabilize", "stabilise", "stabilized", "stabilised", "稳定", "稳住"),
    "unconscious": ("unconsciousness", "昏迷", "失去意识"),
    "power token": ("力量标记", "能力标记", "能力石", "能量石", "能量标记", "powerstone", "powerstones", "power stone", "power stones", "power tokens"),
    "quest": ("委托", "任务", "mission", "job"),
    "reaction": ("反应", "反应动作"),
    "reward": ("报酬", "奖励", "赏金", "给多少钱", "rewards", "pay", "pays"),
    "saving throw": ("豁免", "豁免检定", "save"),
    "spell": ("法术", "施法"),
    "treasure": ("宝藏", "宝物", "财宝", "藏宝"),
    "scaling": ("缩放", "扩容", "人数调整", "scaled", "scale"),
    "rule": ("规则", "机制", "rulebook"),
    "stats": ("属性", "面板", "数据", "数值", "stat", "statblock"),
}
STOP = set("a an and are as at be can could did do does explain for from give has have how i in is it its me of on or please s tell that the their them then they this to use was what when where which who will with would you".split())


RULE_SEARCH_NAMES = {
    "advantage-disadvantage": ("advantage", "disadvantage", "优势", "劣势", "优势劣势", "优势和劣势", "优势和劣势抵消"),
    "actions-and-reactions": ("action", "bonus action", "reaction", "附赠动作", "奖励动作", "反应"),
    "initiative-and-rounds": ("initiative", "先攻", "轮次"),
    "spellcasting-and-power-tokens": ("power token", "power tokens", "powerstone", "powerstones", "power stone", "power stones", "spell slots", "力量标记", "能力标记", "能量石", "能力石", "法术位"),
    "short-and-long-rest": ("short rest", "long rest", "短休", "长休"),
    "critical-hits": ("critical hit", "critical hits", "natural 20", "重击", "暴击"),
    "death-saves-and-stabilization": ("death save", "death saves", "death saving throw", "zero hp", "0 hp", "hp zero", "0血", "零血", "死亡豁免", "稳定状态"),
    "unconscious": ("unconscious", "unconsciousness", "昏迷", "失去意识"),
    "incapacitated": ("incapacitated", "失能"),
    "healing": ("healing", "治疗", "回血"),
    "damage-defenses": ("resistance", "vulnerability", "immunity", "抗性", "易伤", "免疫"),
    "recharge": ("recharge", "充能"),
    "heroic-inspiration": ("英雄灵感", "英雄启发", "英雄激励"),
    "prone": ("prone", "倒地"),
    "poisoned": ("poisoned", "中毒"),
    "restrained": ("restrained", "束缚"),
}

# Rules are topics, not named creatures/locations. A generic word such as
# "combat" must never hide a more specific Play Guide rule during retrieval.
RULE_TOPICS = {
    "advantage": ("advantage-disadvantage",),
    "disadvantage": ("advantage-disadvantage",),
    "attack roll": ("attack-roll-notation",),
    "bonus action": ("actions-and-reactions",),
    "reaction": ("actions-and-reactions",),
    "concentration": ("concentration",),
    "critical hit": ("critical-hits",),
    "cover": ("cover",),
    "initiative": ("initiative-and-rounds",),
    "long rest": ("short-and-long-rest",),
    "short rest": ("short-and-long-rest",),
    "power token": ("spellcasting-and-power-tokens",),
    "death saving throw": ("death-saves-and-stabilization",),
    "stabilization": ("death-saves-and-stabilization", "unconscious", "incapacitated", "healing"),
    "unconscious": ("unconscious", "incapacitated"),
    "incapacitated": ("incapacitated",),
    "healing": ("healing",),
}


def _normalized(value):
    value = unicodedata.normalize("NFKC", value).casefold().replace("’", "'")
    value = re.sub(r"(?<=[a-z])'s\b", "", value)
    return " ".join(re.findall(r"[a-z0-9\u3400-\u9fff]+", value.replace("'", "")))


def _phrase(haystack, needle):
    if not needle:
        return False
    if re.search(r"[\u3400-\u9fff]", needle):
        return needle in haystack
    return f" {needle} " in f" {haystack} "


def _source_id(book, page):
    return f"{book}--{int(page):03}"


def _reader_url(record_id):
    return f"/library_page/?record={quote(record_id, safe='')}"


def _bilingual(label, value):
    if isinstance(value, str):
        return f"## {label}\n\n{value}" if value else ""
    if isinstance(value, list) and value and isinstance(value[0], str) and value[0]:
        return f"## {label}\n\n" + "\n\n".join(x for x in value[:2] if isinstance(x, str) and x)
    return ""


def _join(*sections):
    return "\n\n".join(section for section in sections if section)


def _card_sources(record):
    references = []
    for source in [record, *record.get("source_refs", []), *record.get("occurrences", []), *record.get("adventure_refs", [])]:
        book = source.get("source_id")
        pages = source.get("pdf_pages", [source.get("pdf_page")])
        if book:
            references.extend(_source_id(book, page) for page in pages if isinstance(page, int))
    return list(dict.fromkeys(references))


def _context_link(map_id, point="", *, random=False):
    if map_id in {"keep", "keep-on-the-borderlands"}:
        return "/keep_page/"
    route = f"/adventure_page/?map={quote(map_id)}"
    if point:
        route += f"&{'draw' if random else 'point'}={quote(point)}"
    return route


# Read the literal records already used by the dashboard without executing JavaScript
# or requiring Node on machines that run the Python launcher.
_TOKEN = re.compile(
    r"""\s+|//[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|-?\d+(?:\.\d+)?|[\w$-]+|[^\s]"""
)


class _Call:
    def __init__(self, name, args):
        self.name = name
        self.args = args


class _Literals:
    def __init__(self, source):
        self.tokens = (m.group() for m in _TOKEN.finditer(source)
                       if not m.group().isspace() and not m.group().startswith("//"))
        self.current = next(self.tokens, None)

    def peek(self):
        return self.current

    def take(self, expected=None):
        token = self.peek()
        if token is None or (expected is not None and token != expected):
            raise ValueError(f"Expected {expected}, found {token}")
        self.current = next(self.tokens, None)
        return token

    def many(self, end, read):
        values = []
        while self.peek() != end:
            values.append(read())
            if self.peek() == end:
                break
            self.take(",")
        self.take(end)
        return values

    def field(self):
        key = self.take()
        self.take(":")
        return key.strip("\"'"), self.read()

    def read(self):
        token = self.take()
        if token == "[":
            return self.many("]", self.read)
        if token == "{":
            return dict(self.many("}", self.field))
        if token.startswith('"'):
            return json.loads(token)
        if token.startswith(("'", "`")):
            return token[1:-1].replace(r"\n", "\n")
        if re.fullmatch(r"-?\d+(?:\.\d+)?", token):
            return float(token) if "." in token else int(token)
        if token in {"true", "false", "null"}:
            return {"true": True, "false": False, "null": None}[token]
        if self.peek() == "(":
            self.take("(")
            args = self.many(")", self.read)
            return args if token == "pair" else _Call(token, args)
        return token


def _calls(source, names):
    pattern = rf"(?m)^[ \t]*(?:const \w+ = |\.\.\.)?((?:{'|'.join(names)})\()"
    # Each match is an independent data row. Stop at the end of its enclosing
    # call so malformed source cannot make a later row disappear.
    for match in re.finditer(pattern, source):
        try:
            value = _Literals(source[match.start(1):]).read()
        except (ValueError, IndexError):
            continue
        yield value


class LibraryIndex:
    def __init__(self, root):
        self.root = Path(root)
        self.private_rules = self._load_private_rules()
        metadata = self.private_rules.get("metadata", {})
        self.books = metadata.get("books", {})
        self.map_names = metadata.get("map_names", {})
        self.entity_aliases = metadata.get("aliases", {})
        self.items = {}
        self.aliases = {}
        self.related = {}
        self.reference_paths = {}
        self._load_database()
        self._load_character_reference()
        self._load_keep_reference()
        self._load_adventure_reference()
        self._load_rules()
        self.chinese = chinese_reader_text(self, _calls)
        self.categories = [
            {"id": category, "label": label, "zh": zh,
             "count": sum(item["category"] == category for item in self.items.values())}
            for category, label, zh in CATEGORIES
        ]
        self.searchable = {}
        self.term_counts = Counter()
        for key, item in self.items.items():
            title = _normalized(item["title"])
            names = {title, *(_normalized(alias) for alias in self.aliases[key] if alias)}
            body = _normalized(_join(item["body"], self.chinese.get(key, {}).get("body", "")))
            terms = set(body.split())
            self.searchable[key] = (names - {""}, body, terms)
            self.term_counts.update(terms)
        self.ordered = sorted(self.items, key=lambda key: _normalized(self.items[key]["title"]))

    def _load_private_rules(self):
        """Load user-provided content only from the explicit optional JSON path.

        See database.md. Missing data is an empty index, never a request to
        discover arbitrary files or to read credentials/campaign saves.
        """
        raw = self._read("database/local-rules.json")
        if not raw:
            return {"version": 1, "records": [], "metadata": {}}
        try:
            bundle = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ValueError("Invalid JSON in database/local-rules.json.") from error
        if not isinstance(bundle, dict) or bundle.get("version") != 1 or not isinstance(bundle.get("records", []), list):
            raise ValueError("Local rules must be a version 1 object with a records array.")
        metadata = bundle.get("metadata", {})
        if not isinstance(metadata, dict):
            raise ValueError("Local-rule metadata must be an object.")
        for field in ("books", "map_names", "npc_sources"):
            values = metadata.get(field, {})
            if not isinstance(values, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in values.items()):
                raise ValueError(f"Local-rule metadata {field} must map text to text.")
        named_values = metadata.get("named_values", {})
        if not isinstance(named_values, dict) or any(not isinstance(k, str) or not (isinstance(v, str) or isinstance(v, list) and all(isinstance(part, str) for part in v)) for k, v in named_values.items()):
            raise ValueError("Named values must map names to text or bilingual text arrays.")
        aliases = metadata.get("aliases", {})
        if not isinstance(aliases, dict) or any(not isinstance(k, str) or not isinstance(v, list) or any(not isinstance(a, str) for a in v) for k, v in aliases.items()):
            raise ValueError("Local-rule metadata aliases must map record IDs to text arrays.")
        documents = metadata.get("design_documents", [])
        if not isinstance(documents, list):
            raise ValueError("Design documents must be an array.")
        for document in documents:
            if not isinstance(document, dict) or not isinstance(document.get("path"), str):
                raise ValueError("Each design document needs a relative path.")
            path = Path(document["path"])
            if path.is_absolute() or ".." in path.parts or path.parts[:1] != ("design",):
                raise ValueError("Design document paths must stay inside design/.")
            for field in ("id", "zh"):
                if field in document and not isinstance(document[field], str):
                    raise ValueError(f"Design document {field} must be text.")
        seen = set()
        for record in bundle.get("records", []):
            if not isinstance(record, dict) or any(not isinstance(record.get(field), str) or not record[field].strip() for field in ("id", "title", "body")):
                raise ValueError("Each local rule needs nonempty id, title and body text.")
            if record["id"] in seen:
                raise ValueError("Local-rule IDs must be unique.")
            seen.add(record["id"])
            if record.get("category", "rules") not in {"rules", "house-rules"}:
                raise ValueError("Local-rule category must be rules or house-rules.")
            for field in ("sources", "aliases"):
                values = record.get(field, [])
                if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
                    raise ValueError(f"Local-rule {field} must be a text array.")
            for field in ("zh", "quality", "authority", "visibility"):
                if field in record and not isinstance(record[field], str):
                    raise ValueError(f"Local-rule {field} must be text.")
            if not isinstance(record.get("facts", {}), dict):
                raise ValueError("Local-rule facts must be an object.")
            links = record.get("links", [])
            if not isinstance(links, list) or any(not isinstance(link, dict) or not isinstance(link.get("title"), str) or not isinstance(link.get("url"), str) for link in links):
                raise ValueError("Local-rule links need title and url text.")
        return bundle

    def _read(self, path):
        try:
            return (self.root / path).read_text(encoding="utf-8-sig")
        except FileNotFoundError:
            return ""

    def _add(self, key, title, category, body, *, zh="", quality="local_summary",
             authority="user_supplied", visibility="dm_only", sources=(), links=(),
             aliases=(), facts=None, replaces=False):
        previous = self.items.get(key, {})
        refs = list(dict.fromkeys([*self.related.get(key, []), *sources]))
        body = body.strip() if replaces else _join(previous.get("body"), body.strip())
        if refs:
            first = refs[0]
            source_name = self.items.get(first, {}).get("title", "")
            if "--" in first:
                book, page = first.split("--", 1)
                source_name = f"{self.books.get(book, book.replace('-', ' ').title())} · PDF {int(page)}"
        else:
            source_name = previous.get("source", "")
        self.items[key] = {
            "id": key, "title": title, "zh": zh or previous.get("zh", ""),
            "category": category, "quality": quality, "authority": authority,
            "visibility": visibility, "source": source_name, "body": body,
            "facts": facts or previous.get("facts", {}),
            "links": [*previous.get("links", []), *links],
        }
        self.related[key] = refs
        self.aliases.setdefault(key, set()).update([zh, title, *aliases, *self.entity_aliases.get(key, ())])

    def _load_database(self):
        for line in self._read("database/records.jsonl").splitlines():
            record = json.loads(line)
            key = record["id"]
            category = SOURCE_KINDS.get(record["kind"], record["kind"])
            sources = [ref for ref in _card_sources(record) if ref != key]
            if category == "maps":
                self._add_map_record(record, sources)
            else:
                body = record.get("text", "")
                limits = record.get("limitations", [])
                body = _join(body, ("## Verification notes\n\n" + "\n".join(f"- {line}" for line in limits)) if limits else "")
                original_sources = sources if category != "sources" else _card_sources(record)
                zh = {"rules:attack-roll-notation": "攻击检定、触及范围与伤害骰", "locations:wilderness-random": "荒野随机遭遇"}.get(key, "")
                self._add(key, record["title"], category, body, zh=zh, quality=record["quality"],
                          authority=record["authority"], visibility=record["visibility"], sources=original_sources,
                          facts=record.get("mechanics"))
            if record.get("path"):
                self.reference_paths["/database/" + record["path"]] = key

    def _add_map_record(self, record, sources):
        key = record["id"]
        slug = key.split(":", 1)[1]
        links = []
        if slug in self.map_names or re.fullmatch(r"cave-[a-k]", slug):
            links.append({"title": "Open dashboard map", "url": _context_link(slug)})
        for field, label in (("source_image", "Original map scan"), ("redraw_image", "Redrawn map")):
            path = record.get(field, "")
            if isinstance(path, str) and path.startswith("maps/") and ".." not in path:
                links.append({"title": label, "url": "/database/" + quote(path, safe="/")})
        self._add(key, record["title"], "maps", record["text"], zh=self.map_names.get(slug, ""),
                  quality=record["quality"], authority=record["authority"], visibility=record["visibility"],
                  sources=sources, links=links)

    def _load_character_reference(self):
        for path, names in [
            ("character_page/items-spells.js", ("item", "spell")),
            ("character_page/adventure-catalog.js", ("equipment", "spell", "magicItem")),
        ]:
            for call in _calls(self._read(path), names):
                slug, title, zh, *content = call.args
                category = {"spell": "spells", "magicItem": "magic-items"}.get(call.name, "equipment")
                key = f"{category}:{slug}"
                en_text, zh_text = content[1:3] if call.name == "spell" else content[:2]
                original = self.items.get(key)
                if original:
                    self._add(key, original["title"], category, _bilingual("Dashboard card summary", [en_text, zh_text]),
                              zh=zh, quality=original["quality"], authority=original["authority"],
                              visibility=original["visibility"], aliases=(title,))
                else:
                    self._add(key, title, category, _bilingual("Dashboard card summary", [en_text, zh_text]),
                              zh=zh, visibility="player_reference")

        for category, path in [
            ("classes", "character_page/classes.js"),
            ("backgrounds", "character_page/origins.js"),
            ("species", "character_page/origins.js"),
        ]:
            labels = re.findall(r'(?m)^\s{2}([\w-]+): \{\s*en: "([^"]+)",\s*zh: "([^"]+)"', self._read(path))
            for slug, title, zh in labels:
                for key, record in self.items.items():
                    if key == f"{category}:{slug}" or key.startswith(f"{category}:{slug}-"):
                        if category == "classes":
                            level = re.search(r"\blevel (\d+)", record["title"], re.I)
                            record["zh"] = f"{level[1]} 级{zh}" if level else zh
                        else:
                            record["zh"] = zh
                        self.aliases[key].update((title, zh, record["zh"]))

        for path, global_name in [
            ("combat_page/monsters-fixed.js", "combatFixedNames"),
            ("combat_page/monsters-ordinary.js", "combatOrdinaryNames"),
        ]:
            match = re.search(rf"{global_name} = (\{{[^}}]+\}})", self._read(path))
            if match:
                for slug, zh in _Literals(match[1] + "\n").read().items():
                    self._translate(f"monsters:{slug}", zh)
        for key, variants in self.entity_aliases.items():
            if key.startswith(("monsters:", "shops:")) and variants:
                if key in self.items and not self.items[key]["zh"]:
                    self._translate(key, variants[0])

    def _translate(self, key, zh):
        if key in self.items:
            if not self.items[key]["zh"]:
                self.items[key]["zh"] = zh
            self.aliases[key].add(zh)

    def _load_keep_reference(self):
        source = self._read("keep_page/content.js")
        places, npc_names = {}, {}
        for call in _calls(source, ("location",)):
            number, title, zh, _x, _y, intro, npcs, notes = call.args
            key = f"locations:keep-{number:02}"
            url = f"/keep_page/?place={number}"
            places[number] = (title, zh, key, url)
            inhabitants = []
            for npc in npcs:
                slug, name, cn, role, description, card = npc.args
                npc_key = f"npcs:{slug}"
                npc_names[slug] = (name, cn, npc_key)
                inhabitants.append(npc_key)
                original = self.items.get(npc_key)
                body = _join(f"{name} ({cn}) · {title} ({zh})",
                             _bilingual("Role", role), _bilingual("Portrayal", description))
                if original and original["quality"] == "ocr_unverified":
                    body = _join(body, "## Card OCR · unverified", original["body"])
                self._add(npc_key, name, "npcs", body, zh=cn, sources=(key, f"monsters:{card}"),
                          replaces=bool(original and original["quality"] == "ocr_unverified"),
                          links=({"title": "Find on the Keep map", "url": url},))
                if original and original["quality"] != "ocr_unverified":
                    self.items[npc_key]["quality"] = original["quality"]
            self._add(key, title, "locations", _join(_bilingual("Read aloud", intro), _bilingual("DM notes", notes)),
                      zh=zh, sources=inhabitants, links=({"title": "Open this location", "url": url},), replaces=True)
        for call in _calls(source, ("scene", "trailEncounter")):
            if call.name == "trailEncounter":
                slug, title, zh, intro, notes, loot, page, creatures = call.args
                for creature in creatures:
                    creature.setdefault("count", 1)
                self._scene(f"encounters:trail:{slug}", title, zh, intro,
                            {"notes": notes, "treasure": loot, "creatures": creatures},
                            book=WILD, page=page, location="Trail", location_zh="小径",
                            url=_context_link("trail", slug, random=True))
                continue
            slug, number, title, zh, intro, notes, loot, page, *extras = call.args
            details = extras[0] if extras else {}
            place, place_zh, place_key, url = places[number]
            giver = npc_names.get(details.get("giver"))
            category = "quests" if giver else "encounters"
            key = f"{category}:keep:{slug}"
            self._scene(key, title, zh, intro, {**details, "notes": notes, "treasure": loot},
                        book=KEEP, page=page, location=place, location_zh=place_zh,
                        url=f"{url}&event={quote(slug)}", giver=giver)
            self.related[place_key].append(key)
            if giver:
                self.related[giver[2]].append(key)

        for call in _calls(source, ("offer", "shopRows")):
            if call.name == "offer":
                self._keep_offer(places, call.args)
            else:
                number, shop, rows = call.args
                for slug, title, zh, gp, *extra in rows:
                    options = extra[2] if len(extra) > 2 else {}
                    kind = extra[0] if extra else "item"
                    item_id = extra[1] if len(extra) > 1 else slug
                    self._keep_offer(places, [slug, number, title, zh, gp, kind, options.get("notes"), {"item": item_id}],
                                     shop=shop, unavailable=options.get("unavailable", False))

    def _keep_offer(self, places, args, *, shop=None, unavailable=False):
        slug, number, title, zh, gp, kind, *extras = args
        notes = extras[0] if extras else None
        item_id = extras[1].get("item") if len(extras) > 1 else None
        place, place_zh, place_key, url = places[number]
        status = " (crossed out on the printed handout)" if unavailable else ""
        price = "" if kind == "sale" else f"Listed price: {gp} GP{status}."
        references = [f"shops:{shop}"] if shop else []
        references.extend([place_key, f"equipment:{item_id}", f"magic-items:{item_id}"])
        key = f"shops:keep:{slug}"
        if kind == "food" and not notes:
            notes = ["The listed food or drink is consumed when purchased. No separate mechanical benefit is listed for this item.",
                     "购买后当场食用或饮用。该食品或饮品未列出单独的机制效果。"]
        self._add(key, title, "shops", _join(f"Location: {place} ({place_zh}).", price, _bilingual("Offer details", notes)),
                  zh=zh, sources=references, links=({"title": "Open this location", "url": url},))
        self.related[place_key].append(key)
        if shop and f"shops:{shop}" in self.related:
            self.related[f"shops:{shop}"].append(key)

    def _scene(self, key, title, zh, intro, details, *, book, page, location, location_zh, url, giver=None):
        references = [_source_id(book, page)]
        context = f"Location: {location} ({location_zh})."
        if giver:
            context += f" Quest giver: {giver[0]} ({giver[1]}). Fixed NPC quest."
            references.append(giver[2])
        creatures = []
        for entry in details.get("creatures", []):
            if isinstance(entry, _Call):
                entry = self._creature(entry)
            slug = entry["id"]
            record_id = f"monsters:{slug}"
            monster = self.items.get(record_id, {})
            title_pair = entry.get("name", [monster.get("title", slug), monster.get("zh", "")])
            name = " / ".join(x for x in title_pair if x) if isinstance(title_pair, list) else title_pair
            count = f"{entry['count']} × " if entry.get("count") else ""
            note = entry.get("note")
            if isinstance(note, list):
                note = " / ".join(note)
            if entry.get("reinforcement"):
                note = f"Reinforcement. {note or ''}".strip()
            creatures.append(f"- {count}{name}" + (f". {note}" if note else ""))
            references.append(record_id)
            if isinstance(title_pair, list):
                self._translate(record_id, title_pair[1])
        for npc in details.get("npcs", []):
            if isinstance(npc, _Call) and npc.name == "npc":
                npc_slug, title_pair, card, notes, *_ = npc.args
                self._add_npc(npc_slug, title_pair, card, notes, references[0])
                references.append(f"npcs:{npc_slug}")
            elif isinstance(npc, str):
                npc_key = f"npcs:{npc}"
                references.append(npc_key)
                entry = self.items.get(npc_key)
                if entry:
                    if references[0] not in self.related[npc_key]:
                        self.related[npc_key].append(references[0])
                    context += f" NPC: {entry['title']} ({entry['zh']})."
        body = _join(context, _bilingual("DM notes", details.get("notes")),
                     _bilingual("Treasure and rewards", details.get("treasure")),
                     _bilingual("Enemy drops", details.get("drops")),
                     ("## Creatures and printed counts\n\n" + "\n".join(creatures)) if creatures else "",
                     _bilingual("Read aloud", intro))
        facts = {name: details[name] for name in ("drops", "treasure", "reward") if details.get(name)}
        if giver:
            facts["quest_giver"] = giver[0]
        room_names = ()
        if re.match(r"^[A-K]\d+ · ", title):
            label, _, name = title.partition(" · ")
            room_names = (label, name, zh.partition(" · ")[2])
        self._add(key, title, key.split(":", 1)[0], body, zh=zh, sources=references, aliases=room_names,
                  links=({"title": "Open on the adventure map", "url": url},),
                  facts=facts)

    def _add_npc(self, slug, title, card, notes, source_id):
        self._add(f"npcs:{slug}", title[0], "npcs", _bilingual("Portrayal", notes), zh=title[1],
                  sources=tuple(value for value in (source_id, f"monsters:{card}") if value))

    def _creature(self, call):
        named_groups = {
            "hobgoblins": "hobgoblin-warrior", "goblins": "goblin-warrior",
            "bugbears": "bugbear-warrior", "gnolls": "gnoll-warrior",
            "zombies": "zombie", "cube": "jelly-cube",
        }
        args = call.args
        if call.name == "monster":
            slug, count, *extras = args
            extra = dict(extras[0]) if extras else {}
            named_values = self.private_rules.get("metadata", {}).get("named_values", {})
            if isinstance(extra.get("name"), str) and extra["name"] in named_values:
                extra["name"] = named_values[extra["name"]]
            return {"id": slug, "count": count, **extra}
        if call.name == "creature":
            slug, count, name, *extra = args
            return {"id": slug, "count": count, "name": name, **(extra[0] if extra else {})}
        if call.name == "cube":
            return {"id": named_groups[call.name], "count": 1, **(args[0] if args else {})}
        count, *extras = args
        return {"id": named_groups.get(call.name, call.name), "count": count, **(extras[0] if extras else {})}

    def _load_adventure_reference(self):
        wild = self._read("adventure_page/wilderness.js")
        for call in _calls(wild, ("npc",)):
            slug, title, card, notes, *_ = call.args
            self._add_npc(slug, title, card, notes, self.private_rules.get("metadata", {}).get("npc_sources", {}).get(slug, ""))
        regions = {"trail": "trail", "woods": "woods", "fens": "fens", "tamarack": "tamarack-stand"}
        for match in re.finditer(r"(?m)^  const (trail|woods|fens|tamarack)(Random)? = \[([\s\S]*?)^  \];", wild):
            region, random, data = match.groups()
            slug = regions[region]
            location = slug.replace("-", " ").title()
            for call in _calls(data, ("scene",)):
                name, label, title, intro, page, *extras = call.args
                details = extras[0] if extras else {}
                self._scene(f"encounters:{slug}:{name}", title[0], title[1], intro, details,
                            book=WILD, page=page, location=location, location_zh=self.map_names.get(slug, ""),
                            url=_context_link(slug, name, random=bool(random)))
            map_pattern = rf'(?m)id: "{slug}", title: \["[^"]+", "[^"]+"\], parent: "[^"]+", source: source\((\d+)\),\s*intro: (\[[^\n]+\]),\s*notes: (\[[^\n]+\])'
            map_match = re.search(map_pattern, wild)
            if map_match and not random:
                page, intro_text, notes_text = map_match.groups()
                self._map_summary(slug, location, self.map_names.get(slug, ""), _Literals(intro_text).read(),
                                  _Literals(notes_text).read(), WILD, page)

        for early, path in [(True, "adventure_page/caves-early.js"), (False, "adventure_page/caves-late.js")]:
            data = self._read(path)
            barricade = re.search(r"const barricade = pair\(\s*\"([^\"]+)\"\s*,\s*\"([^\"]+)\"", data)
            if barricade:
                for index, value in enumerate(barricade.groups()):
                    data = data.replace("${barricade[" + str(index) + "]}", value)
            for call in _calls(data, ("cave",)):
                if early:
                    letter, (title, zh), page, intro, notes, points = call.args
                else:
                    letter, (en, cn), intro, page, points, notes = call.args
                    title, zh = f"Cave {letter} · {en}", f"{letter} 洞穴 · {cn}"
                slug = f"cave-{letter.lower()}"
                self._map_summary(slug, title, zh, intro, notes, CAVES, page)
                for point in points:
                    if early:
                        label, names, _x, _y, page, intro, *details = point.args
                    else:
                        label, _x, _y, names, intro, page, *details = point.args
                    en, cn = names
                    room = label.lower()
                    self._scene(f"encounters:{slug}:{room}", f"{label} · {en}", f"{label} · {cn}",
                                intro, details[0] if details else {}, book=CAVES, page=page,
                                location=title, location_zh=zh, url=_context_link(slug, room))
                    self.related[f"map:{slug}"].append(f"encounters:{slug}:{room}")

    def _map_summary(self, slug, title, zh, intro, notes, book, page):
        key = f"map:{slug}"
        prior = self.items.get(key)
        self._add(key, title, "maps", _join(_bilingual("Map introduction", intro), _bilingual("Exploration", notes)),
                  zh=zh, sources=(_source_id(book, page),),
                  links=() if prior else ({"title": "Open dashboard map", "url": _context_link(slug)},))
        self._translate(f"locations:{slug}", zh)

    def _load_rules(self):
        """Index optional private records; the public source contains no rule prose."""
        for record in self.private_rules.get("records", []):
            self._add(record["id"], record["title"], record.get("category", "rules"), record["body"],
                      zh=record.get("zh", ""), quality=record.get("quality", "local_reference"),
                      authority=record.get("authority", "user_supplied"),
                      visibility=record.get("visibility", "dm_only"), sources=record.get("sources", ()),
                      aliases=record.get("aliases", ()), links=record.get("links", ()), facts=record.get("facts"))
        for document in self.private_rules.get("metadata", {}).get("design_documents", []):
            title, _, body = self._read(document["path"]).partition("\n")
            if title:
                self._add(document.get("id", f"house-rules:{Path(document['path']).stem}"),
                          title.lstrip("# "), "house-rules", body, zh=document.get("zh", ""),
                          quality="project_design", authority="local_design")

    def _excerpt(self, item, limit=260):
        body = re.sub(r"```[^\n]*\n[\s\S]*?```", "", item["body"])
        body = re.sub(r"(?m)^#{1,6} +[^\n]+\n*", "", body)
        facts = item["facts"]
        if item["category"] == "monsters" and {"armor_class", "hit_points", "initiative_bonus"} <= facts.keys():
            body = (f"AC {facts['armor_class']} · {facts['hit_points']} HP · Initiative {facts['initiative_bonus']:+d}. "
                    + body.lstrip())
        return self._clip(body, limit)

    @staticmethod
    def _clip(value, limit):
        value = value.strip()
        if len(value) <= limit:
            return value
        pos = max(value.rfind(" ", limit - 60, limit), value.rfind("\n", limit - 60, limit))
        return value[:pos if pos > 0 else limit].rstrip() + "…"

    def _display(self, item, excerpt=None):
        result = {name: item[name] for name in ("id", "title", "zh", "category", "quality", "authority", "visibility", "source")}
        result["excerpt"] = self._excerpt(item) if excerpt is None else excerpt
        localized = self.chinese.get(item["id"], {})
        chinese = re.sub(r"```[^\n]*\n[\s\S]*?```", "", localized.get("body", ""))
        chinese = re.sub(r"(?m)^#{1,6} +[^\n]+\n*", "", chinese)
        result["excerptZh"] = self._clip(chinese, 180)
        result["translation"] = localized.get("status", "unavailable")
        if item["facts"]:
            result["facts"] = item["facts"]
        return result

    def browse(self, query="", category=""):
        query = _normalized(query[:250])
        if query:
            ranked = self._rank(query, category=category)
            keys = [key for _, key in ranked]
        else:
            keys = [key for key in self.ordered if not category or self.items[key]["category"] == category]
        return {"categories": self.categories, "items": [self._display(self.items[key]) for key in keys]}

    def record(self, record_id):
        item = self.items.get(record_id)
        if not item:
            return None
        references = [
            {"title": self.items[key]["title"], "zh": self.items[key].get("zh", ""), "url": _reader_url(key)}
            for key in dict.fromkeys(self.related[record_id]) if key in self.items and key != record_id
        ]
        references.extend(item["links"])
        return {**self._display(item), "body": self._link_markdown(item["body"]),
                "bodyZh": self._link_markdown(self.chinese.get(record_id, {}).get("body", "")), "references": references}

    def _link_markdown(self, body):
        def replace(match):
            label, target = match.groups()
            if target.startswith("https://"):
                return match[0]
            path_match = re.search(r"(?:^|/)(sources|records)/([^ ]+\.md)$", target)
            if path_match:
                key = self.reference_paths.get("/database/" + "/".join(path_match.groups()))
                if key:
                    return f"[{label}]({_reader_url(key)})"
            return label
        return re.sub(r"!?\[([^\]]+)\]\(([^()\s]+)\)", replace, body)

    @staticmethod
    def _query_terms(query):
        aliases = {name for name, variants in CONCEPTS.items() if any(_phrase(query, _normalized(term)) for term in (name, *variants))}
        words = set(re.findall(r"[a-z0-9]+", query)) - STOP
        han = re.findall(r"[\u3400-\u9fff]+", query)
        terms = words | aliases | {word[i:i + 2] for word in han for i in range(len(word) - 1)}
        return terms, aliases

    def _named_focus(self, query):
        matches = {
            key: max((len(name) for name in names if len(name) >= 2 and _phrase(query, name)), default=0)
            for key, (names, _, _) in self.searchable.items()
        }
        longest = max(matches.values(), default=0)
        return {key: length for key, length in matches.items() if length >= max(2, longest // 2)}

    @staticmethod
    def _rule_focus(query, concepts):
        topics = []
        zero_hp = re.search(
            r"\b(?:0|zero)\s*(?:hp|hit points?)\b|\bhp\s*(?:0|zero)\b"
            r"|(?:0|零)\s*(?:血|生命值)|生命值\s*(?:为|降到|降至)?\s*(?:0|零)"
            r"|\b(?:downed|dying)\b|\bfallen\s+(?:ally|character|player|friend|companion)\b|濒死|倒地不起",
            query,
        )
        if zero_hp:
            topics.extend(("death-saves-and-stabilization", "unconscious", "incapacitated", "healing"))
        if re.search(r"\b(?:my|your|each|per) turn\b|\bon (?:a|the) turn\b|我的回合|你的回合|每个回合|每回合", query):
            topics.extend(("actions-and-reactions", "initiative-and-rounds"))
        for concept in sorted(concepts):
            topics.extend(RULE_TOPICS.get(concept, ()))
        return {f"rules:{topic}": 100 - min(position, 8) * 4
                for position, topic in reversed(list(enumerate(topics)))}

    def _rank(self, query, *, category="", context="", evidence=False):
        terms, concepts = self._query_terms(query)
        focus = self._named_focus(query) if evidence else {}
        rule_focus = self._rule_focus(query, concepts) if evidence else {}
        # Ordinary mentions of "combat", "healing", "rules", etc. are not
        # named entities. Keep explicit table encounters such as Call the Watch.
        entity_focus = {key: length for key, length in focus.items()
                        if self.items[key]["category"] not in {"rules", "house-rules"}
                        or key == "house-rules:call-the-watch"}
        focus = {**entity_focus, **{key: length for key, length in focus.items()
                                  if self.items[key]["category"] == "rules"}}
        focus.update({key: 30 for key in rule_focus if key in self.items})
        if evidence and not any(self.items[key]["category"] != "rules" for key in focus):
            for previous in reversed(context.splitlines()[-2:]):
                previous_focus = self._named_focus(_normalized(previous[:600]))
                previous_entities = {
                    key: length for key, length in previous_focus.items()
                    if self.items[key]["category"] not in {"rules", "house-rules"}
                }
                if previous_entities and not rule_focus and (
                    re.search(r"\b(?:it|its|they|their|he|his|she|her|them|that|same)\b|它|他|她|那|呢", query)
                    or concepts & {"armor class", "hit points", "initiative", "stats", "drops", "treasure", "reward"}
                ):
                    focus.update(previous_entities)
                    break
        focus_keys = set(focus)
        focus_names = {
            name for key in focus
            for name in self.searchable[key][0]
            if len(name) >= 2
        }
        focus_refs = {reference for key in focus for reference in self.related[key] if "--" not in reference}
        weights = {term: 1 + math.log((len(self.items) + 1) / (self.term_counts[term] + 2)) for term in terms}
        output = []
        for key in self.ordered:
            item = self.items[key]
            if category and item["category"] != category:
                continue
            names, body, body_words = self.searchable[key]
            exact = query in names
            name_match = max((len(name) for name in names if len(name) > 1 and _phrase(query, name)), default=0)
            reverse_name_match = max((len(query) for name in names if _phrase(name, query)), default=0)
            title_words = set(_normalized(item["title"]).split())
            matching = [
                term for term in terms if term in body_words or (
                    (" " in term or re.search(r"[\u3400-\u9fff]", term)) and _phrase(body, term)
                )
            ]
            direct = key in focus_keys
            is_related = key in focus_refs or any(ref in focus_keys for ref in self.related[key])
            mentions_focus = evidence and any(_phrase(body, name) for name in focus_names)
            if not (exact or name_match or reverse_name_match or matching or terms & title_words or direct or is_related):
                continue
            if evidence and focus and not (direct or is_related or mentions_focus or exact
                                            or item["category"] == "rules"):
                continue
            score = 115 * exact + min(name_match, 40) * 2 + reverse_name_match * 2
            score += 9 * len(terms & title_words) + min(30, sum(weights[term] for term in matching))
            if evidence:
                score += (55 + min(focus[key], 35)) if direct else 26 * is_related + 11 * mentions_focus
                score += rule_focus.get(key, 0)
                if item["category"] == "sources":
                    # Book text must be reachable even if no hand-written rule
                    # summary exists yet. Exact glossary headings identify the
                    # definition rather than incidental mentions on other pages.
                    headings = {
                        _normalized(line.split("[", 1)[0]) for line in item["body"].splitlines()
                        if 3 <= len(line.strip()) <= 85 and line.strip().isupper()
                    }
                    if any(_phrase(query, heading) or heading in terms for heading in headings if heading):
                        score += 55 if key.startswith(GUIDE + "--") else 28
                    elif key.startswith(GUIDE + "--") and len(matching) >= 2:
                        score += min(18, 5 * len(matching))
                if concepts & {"quest", "reward"} and item["category"] == "quests":
                    score += 24 + 45 * is_related
                if concepts & {"drops", "treasure"} and item["category"] in {"encounters", "quests"}:
                    score += 15
                    if "drops" in concepts and item["facts"].get("drops"):
                        score += 38 * (is_related or direct) + 10
                    if item["facts"].get("treasure"):
                        score += 22 * (is_related or direct) + 5
                if concepts & {"hit points", "armor class", "initiative", "stats"} and item["category"] == "monsters":
                    score += 30 + 30 * direct
                if "spell" in concepts and item["category"] == "spells":
                    score += 25
                if "equipment" in concepts and item["category"] in {"equipment", "magic-items"}:
                    score += 25
                if item["category"] == "classes" and concepts & {"short rest", "long rest", "power token"}:
                    if "level-1" in key and not re.search(r"\b(?:level|lvl)\s*[23]\b|[23]\s*级", query):
                        score += 18
                if focus_keys and not (direct or is_related):
                    score -= 10
            elif concepts & {"quest", "reward"} and item["category"] == "quests":
                score += 11
            if item["category"] == "sources":
                score -= 7
            if item["quality"] == "ocr_unverified":
                score -= 4
            if evidence and item["authority"] == "local_design" and "scaling" not in concepts:
                score -= 6
            if score > 0:
                output.append((score, key))
        return sorted(output, key=lambda row: -row[0])

    def _evidence_excerpt(self, item, query):
        body = item["body"]
        if len(body) <= 1550:
            return body
        terms, concepts = self._query_terms(query)
        terms |= {_normalized(item["title"])}
        paragraphs = re.split(r"\n\s*\n", body)
        if len(paragraphs) < 3:
            lines = body.splitlines()
            paragraphs = ["\n".join(lines[start:start + 15]) for start in range(0, len(lines), 15)]
        matches = []
        for i, paragraph in enumerate(paragraphs):
            normalized = _normalized(paragraph)
            score = sum(1 for term in terms if _phrase(normalized, term))
            score += 3 * sum(1 for term in concepts if _phrase(normalized, term))
            if item["category"] == "monsters" and i < 3:
                score += 5
            matches.append((score, i, paragraph))
        relevant = sorted(matches, key=lambda row: (-row[0], row[1]))[:5]
        chosen = []
        remaining = 1550
        for _, i, paragraph in relevant:
            if remaining < 130:
                break
            clipped = self._clip(paragraph, min(remaining, 950))
            chosen.append((i, clipped))
            remaining -= len(clipped) + 2
        return "\n\n".join(paragraph for _, paragraph in sorted(chosen))

    def retrieve(self, question, context=""):
        query = _normalized(question[:2500])
        if not query:
            return []
        ranked = self._rank(query, context=context, evidence=True)
        if not ranked:
            return []
        cutoff = max(8, ranked[0][0] * 0.24)
        selected = [key for score, key in ranked[:8] if score >= cutoff]
        if not selected:
            return []
        return [self._display(self.items[key], self._evidence_excerpt(self.items[key], query)) for key in selected]
