"""Public-source contracts, using invented records and temporary directories only."""
import io
import json
from email.message import Message
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import subprocess
import sys
import unittest
from unittest.mock import patch

import launch_borderlands as app
from public_content import REQUIRED_CONTENT, missing_content


class PublicReleaseTests(unittest.TestCase):
    def test_preflight_checks_content_without_credentials_or_save(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.assertEqual(set(missing_content(root)), set(REQUIRED_CONTENT))
            self.assertFalse(any('lorekeeper.txt' in name or 'local_data' in name for name in REQUIRED_CONTENT))
            for name in REQUIRED_CONTENT:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('synthetic preflight fixture')
            self.assertEqual(missing_content(root), [])

    def test_unconfigured_clone_exits_with_actionable_message(self):
        result = subprocess.run([sys.executable, str(Path(app.__file__)), '--check-content'],
                                text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn('private content pack', result.stdout)
        self.assertNotIn('Traceback', result.stderr)

    def handler(self, host='127.0.0.1:9999'):
        handler = app.Handler.__new__(app.Handler)
        handler.path = app.LEVEL_DATA_JS
        handler.server = SimpleNamespace(authority='127.0.0.1:9999')
        handler.headers = Message()
        handler.headers['Host'] = host
        handler.wfile = io.BytesIO()
        handler.statuses = []
        handler.recorded_headers = {}
        handler.send_response = handler.statuses.append
        handler.send_header = handler.recorded_headers.__setitem__
        handler.end_headers = lambda: None
        handler.api_error = lambda status, message: handler.statuses.append(status)
        return handler

    def test_private_level_json_is_served_as_javascript(self):
        handler = self.handler()
        data = {'boards': {'navigator-1': {'hp': 17}}, 'subclasses': {}, 'preparedCounts': {}}
        with patch.object(app, 'level_data', return_value=data):
            handler.do_GET()
        self.assertEqual(handler.statuses, [200])
        self.assertIn('application/javascript', handler.recorded_headers['Content-Type'])
        output = handler.wfile.getvalue().decode()
        self.assertTrue(output.startswith('globalThis.borderlandsLevelData = '))
        self.assertEqual(json.loads(output.split(' = ', 1)[1].rstrip(';\n')), data)

    def test_level_adapter_rejects_other_host(self):
        handler = self.handler(host='example.invalid')
        with patch.object(app, 'level_data') as loader:
            handler.do_GET()
        loader.assert_not_called()
        self.assertEqual(handler.statuses, [403])

    def test_missing_level_adapter_has_clear_status(self):
        handler = self.handler()
        with patch.object(app, 'level_data', side_effect=FileNotFoundError):
            handler.do_GET()
        self.assertEqual(handler.statuses, [503])

    def test_keep_groups_use_local_profiles(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'database').mkdir()
            data = {'version': 1, 'encounters': {'demo': {
                'patrol': {'profile': 'weaker', 'hp': 9, 'count': 3},
                'leader': {'profile': 'fixed', 'hp': 20, 'count': 1},
                'bystander': {'profile': 'printed', 'hp': 7, 'count': 1},
            }}}
            (root / 'database/keep-scaling.json').write_text(json.dumps(data))
            with patch.object(app, 'ROOT', root):
                result = app.keep_scaling(8)
            self.assertEqual(result, {'demo': {'patrol': {'hp': 9, 'count': 6},
                                             'leader': {'hp': 40, 'count': 1},
                                             'bystander': {'hp': 7, 'count': 1}}})

    def test_missing_local_save_does_not_create_one(self):
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / 'character.json'
            data, tag = app.read_snapshot(path)
            self.assertEqual(json.loads(data), app.empty_roster())
            self.assertEqual(tag, app.UNSAVED_TAG)
            self.assertFalse(path.exists())


if __name__ == '__main__':
    unittest.main()
