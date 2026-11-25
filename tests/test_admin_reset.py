import ast
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest import mock
import os

sys.path.insert(0, str(Path(__file__).parents[1] / 'deploy'))
spec = importlib.util.spec_from_file_location('admin_reset', Path(__file__).parents[1] / 'deploy' / 'admin_reset.py')
admin_reset = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admin_reset)


class AdminResetGuards(unittest.TestCase):
    def test_validates_email_and_password_length(self):
        self.assertEqual(admin_reset.validated(' Admin@Example.FR ', 'x' * 12), ('admin@example.fr', 'x' * 12))
        for email, password in [('not-an-email', 'x' * 12), ('a@b.fr', 'short'), ('a@b.fr', None), (None, 'x' * 12)]:
            with self.subTest(email=email, password=password), self.assertRaises(ValueError):
                admin_reset.validated(email, password)

    def test_credentials_are_a_json_literal_not_code(self):
        hostile = "x'); import os; os.system('id') #\"\n"
        program = admin_reset.remote_program('a@b.fr', hostile)
        tree = ast.parse(program)
        call = tree.body[-1].value
        self.assertEqual(call.func.id, 'reset')
        self.assertEqual(json.loads(ast.literal_eval(call.args[0])), {'email': 'a@b.fr', 'password': hostile})

    def test_refuses_outside_main_ci(self):
        for env in [{'GITHUB_ACTIONS': 'false', 'GITHUB_REF': 'refs/heads/main'}, {'GITHUB_ACTIONS': 'true', 'GITHUB_REF': 'refs/heads/feature'}]:
            with self.subTest(env=env), mock.patch.dict(os.environ, env), self.assertRaises(RuntimeError):
                admin_reset.main()


if __name__ == '__main__':
    unittest.main()
