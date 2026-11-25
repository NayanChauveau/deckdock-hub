import ast
import importlib.util
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'deploy'))
spec = importlib.util.spec_from_file_location('purge_test_data', Path(__file__).parents[1] / 'deploy' / 'purge_test_data.py')
purge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(purge)


class PurgeGuards(unittest.TestCase):
    def test_requires_the_exact_confirmation_word(self):
        purge.validated(' PURGER ')
        for value in [None, '', 'purger', 'oui', 'PURGE']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                purge.validated(value)

    def test_backs_up_before_purging_and_takes_no_input(self):
        program = purge.remote_program()
        self.assertEqual(ast.parse(program).body[-1].value.func.id, 'purge')
        self.assertLess(program.index('pg_dump'), program.index('purge-test-data-ci.ts'))
        for destructive in ['volume', 'down', 'rm', '-v']:
            self.assertNotIn(f"'{destructive}'", program)


if __name__ == '__main__':
    unittest.main()
