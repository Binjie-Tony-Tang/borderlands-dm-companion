# Private reference database: format overview

This directory contains **documentation only** in the public source release. The reference corpus used by the owner's personal installation is not distributed. Its absence is intentional, not an incomplete download.

The private integration connects searchable reference records, scene descriptors, checked mechanical inputs and local image files. A compatible personal content pack must also supply the JavaScript and other data described in [the private-content interface](../docs/private-content-interface.md). Adding one Markdown file or JSON record does not configure the whole dashboard.

This public split introduces new adapters, including Keep scaling data, optional Library bundles, adventure configuration and combat hooks. The original private v1.0 directory does not supply all of those contracts. It has not been converted or changed by this release, and copying it alone is not a verified installation procedure for the new public core. The public tests use synthetic data; full new-core/private-pack integration remains unverified.

No official text, card data, maps, scans, translations or personal campaign state appears in the examples below. The observatory and example values are invented solely to explain the file structure.

## Directory layout

The existing private file layout is relative to the application root:

```text
database/
  README.md                         # this public format description
  records.jsonl                     # private: complete reference records
  local-rules.json                   # optional private rule/reference bundle
  records/
    <kind>/<record-slug>.md          # private: a readable view of one entity
  sources/
    <source-id>/<page-number>.md     # private: source-page text and provenance
  sources.json                      # private: inventory of source documents
  pages.json                        # private: page inventory
  maps/
    catalog.json                    # private: map paths, review and scale metadata
    originals/<map-id>.png           # private: original local reference images
    <map-id>/<map-id>-redraw-v1.png   # private: optional prepared display images
  reviewed-overrides.json            # private: checked corrections/extractions
  user-corrections.json              # private: separately recorded corrections
  photo-requests.json                # private: unresolved source questions
  keep-scaling.json                 # private: named encounter groups/profiles
  raw-ocr/                          # private: optional extraction/audit evidence
  evidence/                         # private: optional source-review evidence
```

Some personal packs may retain a derived SQLite search index or further audit files. The current dashboard's Python reference loader reads the JSONL/Markdown/content inputs; a SQLite server is not required. OCR output, images and audit evidence belong to the personal collection and are not public application dependencies supplied here.

Mutable game state belongs outside this reference tree. The private installation uses `local_data/character.json` for the roster and adventure. A campaign event changing an inventory, revealing a secret or injuring a creature must not rewrite a reference record into a supposed source rule.

## JSONL records

`records.jsonl` is UTF-8 JSON Lines: one complete JSON object per line. Stable IDs connect records, sources, mechanical descriptors and UI references. The private index expects these central fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable, namespaced identity such as `locations:demo-observatory` |
| `kind` | Category used by the reference UI |
| `title` | Human-readable English title |
| `path` | Optional readable-record path relative to `database/` |
| `text` | The record's main reference text, separate from raw extraction |
| `authority` | Where the assertion comes from: a published source, local design or another explicitly identified layer |
| `quality` | What has actually been checked, independently of authority |
| `visibility` | Intended disclosure level, such as player reference or DM-only |
| `source_id` / `source_refs` | Source identities associated with the record |
| `occurrences` | Individual source appearances, with page/location and optional raw extraction |
| `mechanics` | Optional structured facts; category-specific rather than one universal stat block |
| `limitations` | Known gaps or constraints on using the record |

This illustrative object would occupy **one line** in a JSONL file. It is formatted across lines here for readability:

```json
{
  "id": "locations:demo-observatory",
  "kind": "locations",
  "title": "Lantern Observatory",
  "path": "records/locations/demo-observatory.md",
  "text": "An original demonstration location. A blue lantern marks the unlocked entrance.",
  "authority": "local_design",
  "quality": "project_design",
  "visibility": "dm_review_before_reveal",
  "source_id": "demo-author-notes",
  "source_refs": [
    { "source_id": "demo-author-notes", "pdf_page": 1, "printed_page": 1 }
  ],
  "occurrences": [],
  "mechanics": { "entrance_locked": false, "lantern_color": "blue" },
  "limitations": ["Synthetic documentation example; no campaign or rule data."]
}
```

The example demonstrates shape and provenance. It is not a drop-in content pack, a rules implementation or a promise that arbitrary `mechanics` keys will drive the combat engine.

The optional `local-rules.json` adapter uses a separate version-1 bundle with `records` and optional `metadata`; those entries use `body` rather than the JSONL record's `text`. Localized bodies can be supplied separately in `library_translations/private-rules.zh-Hans.json`. See [the exact optional-bundle examples](../docs/private-content-interface.md#optional-local-rules-and-translations). Neither adapter discovers or imports a source book automatically.

For source citations, PDF pages are one-based. Printed page numbers are separate because a document's page labels may differ from its file-page positions. A record may cite several source occurrences without treating their raw extraction as equally reliable.

## Markdown records

The readable form combines a small metadata block with the main body and optional review/source sections. A synthetic example:

```markdown
---
id: locations:demo-observatory
kind: locations
title: Lantern Observatory
authority: local_design
quality: project_design
visibility: dm_review_before_reveal
---

# Lantern Observatory

An original demonstration location. A blue lantern marks the unlocked entrance.

## Review notes

This is authored demonstration content, with no imported rule text or stat values.

## Sources

Demo author notes, page 1. No real source document is included with this example.
```

The JSONL record and its readable view should retain the same ID, source layer and limitations. A copied Markdown heading alone is not enough to establish that an extracted mechanical value was reviewed.

## Keep authority, quality and visibility separate

These describe different questions:

- **Authority:** Is this a statement from a named published reference, an approved local house rule, an open proposal or original demonstration material?
- **Quality:** Was the text visually checked, were only certain numerical fields checked, or is it still unverified OCR?
- **Visibility:** Is this suitable as player reference, does the DM need to select what to reveal, or is it private DM information?

The private integration has used authority labels such as `official_box_scan` for its identified published sources and `local_design` for project decisions. A source label records provenance; it is not a license grant or a verification result. Keep the document identity and edition/context explicit rather than silently importing another ruleset.

Quality labels used by the integration include:

| Label | What it records |
| --- | --- |
| `reviewed_transcription` | The stated text was checked against its identified source |
| `reviewed_rules_extraction` | A checked extraction or paraphrase of particular rules, not necessarily a full transcription |
| `partially_reviewed` | Only the explicitly described fields are checked; limitations still apply |
| `ocr_unverified` | Automatic extraction that can contain wrong numbers, signs, wording or order |
| `source_route` | A pointer to evidence, without certifying the rule content |
| `needs_rescan` / `missing_reverse_face` | A stated source gap remains unresolved |
| `project_design` | Local authored design material, which also needs its adoption status recorded |

An approved house rule and a provisional idea should not become interchangeable merely because both are local design. Record whether a local decision is adopted, proposed or superseded. Keep raw OCR in its occurrence/evidence layer; do not replace checked text with conflicting raw extraction. Unknown values should be absent or `null`, with an explanation, rather than invented zeros or familiar values from another edition.

Visibility is enforced when choosing a response or display. A source page can mix narration and secrets; identifying a record as searchable does not make its whole body appropriate for a player-facing screen.

## Maps and mechanical adapters

Map metadata can record local image paths, source page, orientation, stated scale and calibration status. A visually reviewed image does not automatically provide reliable pixel-to-distance conversion, collision geometry or an obstacle graph. This application leaves movement and positioning with the physical table.

The complete private application also needs mechanical descriptors and UI content adapters. Reference prose alone does not populate the character decks, select enemy profiles, create spell actions or supply scene coordinates. Those boundaries are described in [the interface document](../docs/private-content-interface.md).

Source-specific Keep encounter groups live in private `keep-scaling.json`; the public route applies the declared count-first, fixed-count or printed profile recursively. Level progression uses private `character_page/level-data.json`, delivered locally through `/api/level-data.js` to the public resolver. These data files remain private even though the code that reads and calculates them is public.

## Import and maintenance status

This release does **not** distribute the personal OCR/import/rebuild pipeline, its extraction evidence or a content-pack installer. There is no supported public command that takes an arbitrary PDF and produces a complete compatible dashboard pack.

For a personal integration, preserve source identities and quality labels, check any value before automating it, and keep local changes distinct from the published baseline. Use only content you can supply for that installation. Do not commit the personal pack, raw sources, translations, campaign save or API key to the public repository.
