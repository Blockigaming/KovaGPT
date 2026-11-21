import importlib.util
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('command_failure_engine', ROOT / 'scripts/release/managed-auth-recovery.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


class CommandFailureTests(unittest.TestCase):
    def observed(self, argv, *, code=1, error=None):
        engine.mark_stage('restore-schema')
        with patch.object(engine.subprocess, 'run', side_effect=error, return_value=SimpleNamespace(returncode=code)) as child:
            with self.assertRaises(engine.Stopped) as stopped:
                engine.run(argv, {})
            self.assertIs(child.call_args.kwargs['stderr'], subprocess.DEVNULL)
        return engine.public_failure(stopped.exception)

    def test_nonzero_reports_fixed_command_and_stage_without_argv_or_output(self):
        secret = 'PRIVATE_CUSTOMER_VALUE_NEVER_PUBLIC'
        result = self.observed(['/private/' + secret + '/pg_restore', '--dbname', secret])
        self.assertEqual(result['command'], 'pg_restore')
        self.assertEqual(result['commandStatus'], 'nonzero')
        self.assertEqual(result['stage'], 'restore-schema')
        self.assertEqual(result['code'], 'private_command_unconfirmed')
        self.assertNotIn(secret, json.dumps(result))

    def test_unknown_executable_is_not_disclosed(self):
        result = self.observed(['/private/customer-specific-command'])
        self.assertEqual(result['command'], 'other')
        self.assertNotIn('customer-specific', json.dumps(result))

    def test_timeout_and_launch_errors_do_not_disclose_exception_fields(self):
        secret = 'PRIVATE_DATABASE_URL_AND_PASSWORD'
        for error, status in [(subprocess.TimeoutExpired(['gpg', secret], 3, stderr=secret), 'timeout'),
                              (OSError(secret), 'launch')]:
            with self.subTest(status=status):
                result = self.observed(['gpg', secret], error=error)
                self.assertEqual(result['commandStatus'], status)
                self.assertNotIn(secret, json.dumps(result))

    def test_signal_is_a_fixed_enum_without_arbitrary_numeric_payload(self):
        result = self.observed(['pg_dump'], code=-9)
        self.assertEqual(result['commandStatus'], 'signal')
        self.assertNotIn('returncode', result)

    def test_exception_attributes_cannot_expand_the_public_vocabulary(self):
        error = engine.Stopped('private_command_unconfirmed')
        error.command = 'PRIVATE_ROW_CONTENT'
        error.command_status = 'PRIVATE_ROW_CONTENT'
        error.sqlstate = 'PRIVATE_ROW_CONTENT'
        self.assertNotIn('PRIVATE_ROW_CONTENT', json.dumps(engine.public_failure(error)))


if __name__ == '__main__':
    unittest.main()
