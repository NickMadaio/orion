"""Exercise the deployment script's actual packaging/fingerprint fragments in isolation."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'scripts/orion-deploy').read_text()

class CopyPackagingTests(unittest.TestCase):
    def test_helper_is_shipped_and_fingerprinted_while_tests_are_excluded(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder); plugin=base/'plugin'; installed=base/'installed'
            (plugin/'dist').mkdir(parents=True); (installed/'dist').mkdir(parents=True)
            for name in ['catalog.js','catalog.d.ts','file-copy-helper.py','copy.test.js','copy.test.d.ts']:
                (plugin/'dist'/name).write_text('initial')
            start=SOURCE.index('for file in "$PLUGIN"/dist/')
            loop=SOURCE[start:SOURCE.index('\ndone',start)+5]
            subprocess.run(['bash','-c',loop],env=dict(os.environ,PLUGIN=str(plugin),INSTALLED=str(installed)),check=True)
            self.assertEqual({p.name for p in (installed/'dist').iterdir()}, {'catalog.js','catalog.d.ts','file-copy-helper.py'})
            start=SOURCE.index('fingerprint() {')
            definition=SOURCE[start:SOURCE.index('\n}\n',start)+3]
            def digest():
                return subprocess.check_output(['bash','-c',definition+'\nfingerprint "$1"','fixture',str(plugin/'dist')],text=True).strip()
            initial=digest()
            (plugin/'dist/copy.test.js').write_text('not shipped')
            self.assertEqual(digest(),initial)
            (plugin/'dist/file-copy-helper.py').write_text('changed helper')
            self.assertNotEqual(digest(),initial)
