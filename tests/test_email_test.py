import ast
import importlib.util
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / 'deploy'))
spec = importlib.util.spec_from_file_location('email_test', Path(__file__).parents[1] / 'deploy' / 'email_test.py')
email_test = importlib.util.module_from_spec(spec)
spec.loader.exec_module(email_test)


class EmailTestGuards(unittest.TestCase):
    def test_validates_the_recipient(self):
        self.assertEqual(email_test.validated(' moi@example.fr '), 'moi@example.fr')
        for value in [None, '', 'pas-une-adresse', 'a@b', 'Nom <a@b.fr>', 'a@b.fr; id']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                email_test.validated(value)

    def test_recipient_is_a_json_literal_and_runs_in_the_email_test_service(self):
        hostile = "x'); import os; os.system('id') #\"@b.fr"
        program = email_test.remote_program(hostile)
        call = ast.parse(program).body[-1].value
        self.assertEqual(call.func.id, 'send')
        self.assertEqual(json.loads(ast.literal_eval(call.args[0])), {'to': hostile, 'previews': False})
        previews = ast.parse(email_test.remote_program('a@b.fr', True)).body[-1].value
        self.assertEqual(json.loads(ast.literal_eval(previews.args[0])), {'to': 'a@b.fr', 'previews': True})
        self.assertIn("'run', '--rm', '-T', '--no-deps', 'email-test'", program)


if __name__ == '__main__':
    unittest.main()
