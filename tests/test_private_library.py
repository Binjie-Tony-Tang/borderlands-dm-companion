"""Synthetic tests for the public index's optional private-content boundary."""

import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from library_index import LibraryIndex


class PrivateLibraryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="public-library-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def write(self, path, value):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")

    def rules(self, **extra):
        return {"version": 1, "records": [{"id": "rules:demo-clock", "title": "Demo bead counter",
            "body": "Move one bead when the bell rings.", "aliases": ["bead-tracker"],
            "sources": ["demo-handbook--001"]}], **extra}

    def test_no_data_means_empty_index_and_no_embedded_rule_entries(self):
        index = LibraryIndex(self.root)
        self.assertEqual(index.items, {})
        self.assertEqual(index.browse()["items"], [])
        self.assertEqual(index.retrieve("bead counter"), [])

    def test_private_rules_load_with_original_english_and_localized_reader(self):
        self.write("database/local-rules.json", self.rules(metadata={"books": {"demo-handbook": "Demo Handbook"}}))
        self.write("library_translations/private-rules.zh-Hans.json", {"version": 1, "entries": {
            "rules:demo-clock": {"title": "示例计数器", "body": "铃响时移动一颗珠子。", "status": "translated"}}})
        index = LibraryIndex(self.root)
        record = index.record("rules:demo-clock")
        self.assertEqual(record["body"], "Move one bead when the bell rings.")
        self.assertEqual(record["bodyZh"], "铃响时移动一颗珠子。")
        self.assertEqual(record["authority"], "user_supplied")
        self.assertEqual(record["source"], "Demo Handbook · PDF 1")
        self.assertEqual(index.retrieve("bead-tracker")[0]["id"], "rules:demo-clock")
        self.assertEqual(index.browse("珠子")["items"][0]["id"], "rules:demo-clock")

    def test_translation_bundle_does_not_create_missing_english_records(self):
        self.write("library_translations/private-rules.zh-Hans.json", {"version": 1, "entries": {
            "rules:missing": {"body": "示例。"}}})
        self.assertEqual(LibraryIndex(self.root).items, {})

    def test_bundled_rule_metadata_defaults_and_house_rule_category(self):
        data = self.rules()
        data["records"].append({"id": "house-rules:pause", "title": "Quiet minute", "category": "house-rules",
            "body": "Record a pause before the next activity.", "facts": {"sample": True}})
        self.write("database/local-rules.json", data)
        index = LibraryIndex(self.root)
        self.assertEqual(index.record("rules:demo-clock")["quality"], "local_reference")
        self.assertEqual(index.record("house-rules:pause")["category"], "house-rules")
        self.assertTrue(index.record("house-rules:pause")["facts"]["sample"])

    def test_documents_are_opt_in_and_confined_to_design_folder(self):
        path = self.root / "design" / "demo.md"
        path.parent.mkdir()
        path.write_text("# Sample note\nThis is synthetic project documentation.", encoding="utf-8")
        self.assertEqual(LibraryIndex(self.root).items, {})
        self.write("database/local-rules.json", {"version": 1, "records": [], "metadata": {
            "design_documents": [{"path": "design/demo.md", "id": "house-rules:demo-note"}]}})
        self.assertIn("house-rules:demo-note", LibraryIndex(self.root).items)
        self.write("database/local-rules.json", {"version": 1, "records": [], "metadata": {
            "design_documents": [{"path": "../outside.md"}]}})
        with self.assertRaisesRegex(ValueError, "inside design"):
            LibraryIndex(self.root)

    def test_invalid_private_records_and_translation_status_are_rejected(self):
        self.write("database/local-rules.json", {"version": 1, "records": [{"id": "incomplete"}]})
        with self.assertRaisesRegex(ValueError, "nonempty"):
            LibraryIndex(self.root)
        self.write("database/local-rules.json", self.rules())
        self.write("library_translations/private-rules.zh-Hans.json", {"version": 1, "entries": {
            "rules:demo-clock": {"body": "示例。", "status": "unrecognized"}}})
        with self.assertRaisesRegex(ValueError, "supported"):
            LibraryIndex(self.root)

    def test_database_source_guides_preserve_user_supplied_verification(self):
        target = self.root / "database" / "records.jsonl"
        target.parent.mkdir()
        target.write_text(json.dumps({"id": "demo-handbook--001", "kind": "source_page",
            "title": "Demo page", "text": "This is a synthetic sample fragment.", "quality": "unverified_sample",
            "authority": "user_supplied", "visibility": "dm_only"}) + "\n", encoding="utf-8")
        record = LibraryIndex(self.root).record("demo-handbook--001")
        self.assertEqual(record["quality"], "unverified_sample")
        self.assertEqual(record["translation"], "source-guide")
        self.assertIn("不是整页逐字翻译", record["bodyZh"])


if __name__ == "__main__":
    unittest.main()
