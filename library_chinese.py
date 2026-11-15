"""Offline Chinese reader text; English records remain the rules authority.

Card text is reused from the dashboard's authored bilingual catalog. Long design
documents and unverified source OCR have explicitly labelled Chinese guides,
with their complete English originals retained by the Library reader.
"""

import json
import re


# Content is supplied through private JSON; no book or adventure translations
# ship in the public source. Labels below are generic reader UI vocabulary.
TERMS = {
    "Acid": "强酸", "Bludgeoning": "钝击", "Cold": "冷冻", "Fire": "火焰", "Force": "力场",
    "Lightning": "闪电", "Necrotic": "黯蚀", "Piercing": "穿刺", "Poison": "毒素", "Psychic": "心灵",
    "Radiant": "光耀", "Slashing": "挥砍", "Thunder": "雷鸣", "Healing": "治疗",
    "STR": "力量（STR）", "DEX": "敏捷（DEX）", "CON": "体质（CON）", "INT": "智力（INT）", "WIS": "感知（WIS）", "CHA": "魅力（CHA）",
    "action": "动作（Action）", "bonus": "附赠动作（Bonus Action）", "reaction": "反应（Reaction）", "free": "无需动作",
}


def _section(title, text):
    return f"## {title}\n\n{text}" if text else ""


def _join(*parts):
    return "\n\n".join(part for part in parts if part)


def _pair(value):
    if isinstance(value, list) and len(value) > 1 and isinstance(value[1], str):
        return value[1]
    if isinstance(value, str) and re.search(r"[\u3400-\u9fff]", value):
        return value
    return ""


def _facts(item):
    return "```json\n" + json.dumps(item["facts"], ensure_ascii=False, indent=2) + "\n```" if item.get("facts") else ""


def _features(card):
    return _join(*(_section(f"{row.get('zh', row.get('en', ''))}（{row.get('en', '')}）", row.get("textZh", ""))
                   for row in card.get("features", []) if isinstance(row, dict)))


def _actions(monster):
    rows, seen = [], set()

    def add(action):
        key = action.get("id")
        if key in seen or str(key).startswith("opportunity-"):
            return
        seen.add(key)
        details = []
        if action.get("timing"):
            details.append(TERMS.get(action["timing"], action["timing"]))
        if "bonus" in action:
            details.append(f"攻击加值 {action['bonus']:+d}")
        if action.get("save"):
            save = action["save"]
            details.append(f"DC {save['dc']} {TERMS.get(save['ability'], save['ability'])}豁免")
            if save.get("onSuccess") == "half":
                details.append("豁免成功伤害减半")
        for die in action.get("dice", []):
            formula = f"{die['count']}d{die['sides']}" if die.get("count") else ""
            flat = die.get("flat", 0)
            formula += (f"{flat:+d}" if formula else str(flat)) if flat else ""
            if formula:
                details.append(f"{formula} {TERMS.get(die['type'], die['type'])}")
        if action.get("recharge"):
            details.append("充能（Recharge）" + "/".join(str(x) for x in action["recharge"]))
        if action.get("uses"):
            details.append(f"可用 {action['uses']} 次；恢复条件按原卡")
        text = _join(" · ".join(details), action.get("descriptionZh", ""))
        rows.append(_section(f"{action.get('zh', action.get('name', ''))}（{action.get('name', '')}）", text))
        for slot in action.get("slots", []):
            for option in slot if isinstance(slot, list) else [slot]:
                if isinstance(option, dict):
                    add(option)

    for action in monster.get("actions", []):
        add(action)
    for trait in monster.get("traits", []):
        rows.append(_section(f"{trait.get('zh', trait.get('name', ''))}（{trait.get('name', '')}）", trait.get("descriptionZh", "")))
    return _join(*rows)


def _private_translations(index):
    """Read the one optional private translation bundle; absent means empty."""
    raw = index._read("library_translations/private-rules.zh-Hans.json")
    if not raw:
        return {}
    try:
        bundle = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError("Invalid JSON in the private Chinese translation bundle.") from error
    if not isinstance(bundle, dict) or bundle.get("version") != 1 or not isinstance(bundle.get("entries"), dict):
        raise ValueError("Private translations must be a version 1 object with an entries object.")
    for key, entry in bundle["entries"].items():
        if not isinstance(key, str) or not isinstance(entry, dict) or not isinstance(entry.get("body"), str):
            raise ValueError("Each private translation needs a record ID and body text.")
        if "title" in entry and not isinstance(entry["title"], str):
            raise ValueError("Private translation titles must be text.")
        if entry.get("status", "translated") not in {"translated", "summary", "source-guide"}:
            raise ValueError("Choose a supported private translation status.")
    return bundle["entries"]


def populate(index, calls):
    """Return per-ID localized reader bodies without altering English evidence."""
    translated = {}

    def put(key, body, status="translated", title=None):
        if key not in index.items or not body:
            return
        translated[key] = {"body": body, "status": status}
        if title:
            index.items[key]["zh"] = title
            index.aliases[key].add(title)

    catalog = json.loads(index._read("library_translations/catalog.zh-Hans.json") or "{}")
    for group, category in (("items", "equipment"), ("spells", "spells")):
        for slug, card in catalog.get(group, {}).items():
            category = card.get("source", "").split("/")[-2] if group == "items" else "spells"
            key = f"{category}:{slug}"
            put(key, card.get("textZh", ""), title=card.get("zh"))
    for group in ("backgrounds", "species"):
        for slug, card in catalog.get(group, {}).items():
            put(f"{group}:{slug}", _features(card), title=card.get("zh"))
    for slug, card in catalog.get("classes", {}).items():
        key = f"classes:{slug}-level-1"
        item = index.items.get(key, {})
        stats = {"hit_point_maximum": card["hp"], "printed_unarmored_ac": card["unarmoredAC"],
                 "initiative": card["initiative"], "speed_feet": card["speed"], "starting_gold_gp": card["gold"],
                 "ability_modifiers": card["abilities"], "saving_throws": card["saves"]}
        if "spellDC" in card:
            stats["spell_save_dc"] = card["spellDC"]
        put(key, _join("以下为种族与背景调整前的职业板数值。", _facts({"facts": stats}), _features(card)), title="1 级" + card["zh"])
        for other_key, item in index.items.items():
            if other_key.startswith(f"classes:{slug}-") and other_key != key:
                level = re.search(r"level-(\d)", other_key)[1]
                put(other_key, f"这是{card['zh']}（{card['en']}）{level} 级职业板。该板仍有未核对的 OCR，数值与能力标记位置应查原扫描。下方来源可打开完整英文转录；不要把 1 级能力或其他版本数值套用到此板。", "source-guide")
    for key, entry in json.loads(index._read("library_translations/classes.zh-Hans.json") or "{}").items():
        put(key, entry["body"], title=entry.get("title"))
    for slug, monster in catalog.get("monsters", {}).items():
        key = "monsters:" + slug
        item = index.items.get(key, {})
        facts = item.get("facts", {})
        brief = f"印刷生命值（HP）{facts.get('hit_points', '—')} · 护甲等级（AC）{facts.get('armor_class', '—')} · 先攻 {facts.get('initiative_bonus', 0):+d}"
        put(key, _join(brief, _facts(item), _actions(monster)), "summary", monster.get("zh"))
    # The scene data already contains hand-authored English/Chinese pairs.
    def scene(key, intro, details, location="", giver=""):
        for npc in details.get("npcs", []):
            if hasattr(npc, "name") and npc.name == "npc":
                npc_slug, title, card, notes, *_ = npc.args
            elif isinstance(npc, dict):
                npc_slug, title, notes = npc["id"], npc["name"], npc.get("notes")
            else:
                continue
            put("npcs:" + npc_slug, _section("扮演提示", _pair(notes)), title=_pair(title))
        creatures = []
        for entry in details.get("creatures", []):
            if hasattr(entry, "name"):
                entry = index._creature(entry)
            monster = index.items.get("monsters:" + entry["id"], {})
            name = _pair(entry.get("name")) or monster.get("zh") or monster.get("title", entry["id"])
            count = f"{entry['count']} × " if entry.get("count") else ""
            note = _pair(entry.get("note"))
            if entry.get("reinforcement") or entry.get("reserve"):
                note = "增援。" + note
            creatures.append("- " + count + name + ("。" + note if note else ""))
        put(key, _join(f"地点：{location}。" if location else "", f"任务给予者：{giver}。这是固定 NPC 任务。" if giver else "",
                       _section("DM 笔记", _pair(details.get("notes"))), _section("宝藏与报酬", _pair(details.get("treasure"))),
                       _section("敌人掉落", _pair(details.get("drops"))), _section("生物与印刷数量", "\n".join(creatures)),
                       _section("可朗读内容", _pair(intro))))

    keep = index._read("keep_page/content.js")
    places, npcs = {}, {}
    for call in calls(keep, ("location",)):
        number, title, zh, _x, _y, intro, residents, notes = call.args
        places[number] = zh
        put(f"locations:keep-{number:02}", _join(_section("可朗读内容", _pair(intro)), _section("DM 笔记", _pair(notes))))
        for npc in residents:
            slug, en, cn, role, description, card = npc.args
            npcs[slug] = cn
            put("npcs:" + slug, _join(f"{cn}（{en}） · {zh}", _section("身份", _pair(role)), _section("扮演提示", _pair(description))), "summary")
    for call in calls(keep, ("scene", "trailEncounter")):
        if call.name == "trailEncounter":
            slug, title, zh, intro, notes, loot, page, creatures = call.args
            scene("encounters:trail:" + slug, intro, {"notes": notes, "treasure": loot, "creatures": creatures}, "小径")
        else:
            slug, number, title, zh, intro, notes, loot, page, *extras = call.args
            details = extras[0] if extras else {}
            giver = npcs.get(details.get("giver"), "")
            key = f"{'quests' if giver else 'encounters'}:keep:{slug}"
            scene(key, intro, {**details, "notes": notes, "treasure": loot}, places[number], giver)
    for call in calls(keep, ("offer", "shopRows")):
        rows = []
        if call.name == "offer":
            slug, number, en, zh, gp, kind, *extras = call.args
            rows.append((slug, number, gp, kind, extras[0] if extras else None, False))
        else:
            number, shop, entries = call.args
            for slug, en, zh, gp, *extra in entries:
                options = extra[2] if len(extra) > 2 else {}
                rows.append((slug, number, gp, extra[0] if extra else "item", options.get("notes"), options.get("unavailable", False)))
        for slug, number, gp, kind, notes, unavailable in rows:
            body = _join(f"地点：{places[number]}。", f"标价：{gp} GP。" if kind != "sale" else "这是收购物品的交易，按所列条件执行。",
                         "印刷商店单上已划去，当前不可购买。" if unavailable else "", _pair(notes),
                         "购买后当场食用或饮用；未另列机制收益。" if kind == "food" and not notes else "")
            put("shops:keep:" + slug, body)

    wild = index._read("adventure_page/wilderness.js")
    for call in calls(wild, ("npc",)):
        slug, title, card, notes, *_ = call.args
        put("npcs:" + slug, _section("扮演提示", _pair(notes)), title=_pair(title))
    region_names = {"trail": "小径", "woods": "森林", "fens": "沼泽", "tamarack": "落叶松林"}
    for match in re.finditer(r"(?m)^  const (trail|woods|fens|tamarack)(Random)? = \[([\s\S]*?)^  \];", wild):
        region, random, data = match.groups()
        slug = "tamarack-stand" if region == "tamarack" else region
        for call in calls(data, ("scene",)):
            name, label, title, intro, page, *extras = call.args
            scene(f"encounters:{slug}:{name}", intro, extras[0] if extras else {}, region_names[region])

    for early, path in ((True, "adventure_page/caves-early.js"), (False, "adventure_page/caves-late.js")):
        data = index._read(path)
        barricade = re.search(r'const barricade = pair\(\s*"([^"]+)"\s*,\s*"([^"]+)"', data)
        if barricade:
            for number, value in enumerate(barricade.groups()):
                data = data.replace("${barricade[" + str(number) + "]}", value)
        for call in calls(data, ("cave",)):
            if early:
                letter, title, page, intro, notes, points = call.args
                name = title[1]
            else:
                letter, title, intro, page, points, notes = call.args
                name = f"{letter} 洞穴 · {title[1]}"
            slug = "cave-" + letter.lower()
            body = _join(_section("地图导读", _pair(intro)), _section("探索与 DM 笔记", _pair(notes)))
            put("map:" + slug, body)
            put("locations:" + slug, body)
            for point in points:
                if early:
                    label, names, _x, _y, page, intro, *details = point.args
                else:
                    label, _x, _y, names, intro, page, *details = point.args
                scene(f"encounters:{slug}:{label.lower()}", intro, details[0] if details else {}, name)

    for mapping in catalog.get("maps", []):
        slug = mapping["id"]
        name = _pair(mapping["title"])
        guide = _join(_section("可朗读内容", _pair(mapping.get("intro"))), _section("探索与 DM 笔记", _pair(mapping.get("notes"))))
        put("map:" + slug, guide, title=name)
        put("locations:" + slug, guide, title=name)
        for point in mapping.get("points", []):
            scene(f"encounters:{slug}:{point['id']}", point.get("read"), point, name)

    name_lookup = {value["title"].casefold(): value.get("zh") for value in index.items.values() if value.get("zh")}
    name_lookup.update({"flask of holy water": "一瓶圣水", "healing": "治疗", "revival": "复活"})
    for key, item in index.items.items():
        if item["category"] != "shops":
            continue
        rows = []
        for en, price, status in re.findall(r"(?m)^\| ([^|]+) \| (\d+) \| ([^|]+) \|$", item["body"]):
            zh = name_lookup.get(en.casefold()) or en
            rows.append(f"| {zh}（{en}） | {price} | {'来源中已划去' if 'crossed' in status else '列于来源'} |")
        if rows:
            put(key, _join("以下价格来自本地数据；请另行核对库存。", "| 商品／服务 | GP | 来源状态 |\n|---|---:|---|\n" + "\n".join(rows)), title=item.get("zh") or item["title"])

    # Source records stay source records: Chinese navigation is not a new
    # certification or a fabricated full translation of uncertain OCR.
    for key, item in index.items.items():
        if item["category"] != "sources":
            continue
        if "--" in key:
            book, page = key.rsplit("--", 1)
            title = f"{index.books.get(book, book)} · PDF 第 {int(page)} 页"
        else:
            title = item.get("zh") or "补充来源照片"
        related = [(other, index.items[other]) for other, refs in index.related.items() if key in refs and other in translated and index.items[other]["category"] != "sources"]
        entries = "\n".join(f"- [{record.get('zh') or record['title']}](/library_page/?record={other.replace(':', '%3A')})" for other, record in related)
        body = _join(f"{title}的中文导读。完整英文 OCR／原始转录保留在“英文原文”中。此处不是整页逐字翻译，也不会提高原来源的核对等级。数字、版面关系或 OCR 有疑问时，应查看扫描。", _section("本页相关中文条目", entries) if entries else "此来源页尚未整理出独立中文条目；请查看英文原文，并保留其未核对 OCR 标记。")
        put(key, body, "source-guide", title)
    for key, entry in _private_translations(index).items():
        put(key, entry["body"], entry.get("status", "translated"), entry.get("title"))
    return translated
