import ast
import importlib.util
import os
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('synthetic_schema_smoke', ROOT / 'scripts/release/smoke-synthetic-schema-restore-native.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SyntheticSchemaTests(unittest.TestCase):
    def test_embedded_program_compiles_and_reads_only_its_tool_path_from_environment(self):
        tree = ast.parse(module.PROGRAM)
        keys = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Attribute):
                if isinstance(node.value.value, ast.Name) and node.value.value.id == 'os' and node.value.attr == 'environ':
                    self.assertIsInstance(node.slice, ast.Constant)
                    keys.append(node.slice.value)
        self.assertEqual(keys, ['PATH'])

    def test_generated_fixture_has_no_external_archive_or_protected_phrase(self):
        self.assertNotIn('KOVA_PRODUCTION_', module.PROGRAM)
        self.assertNotIn('engine.restore(', module.PROGRAM)
        self.assertNotIn('engine.capture(', module.PROGRAM)
        self.assertIn('generated-fixture.dump', module.PROGRAM)
        self.assertIn('KOVA_SYNTHETIC_ONLY', module.PROGRAM)

    def test_original_pull_request_context_guard_is_preserved(self):
        with self.assertRaises(module.harness.Stopped):
            module.harness.synthetic_context({'GITHUB_EVENT_NAME': 'workflow_dispatch'})
        self.assertTrue(issubclass(module.SchemaRestoreProbe, module.harness.operator.OperatorProbe))


if __name__ == '__main__':
    unittest.main()
