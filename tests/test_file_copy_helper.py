import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('copy_helper', ROOT/'plugin/orion-control/src/file-copy-helper.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

class FileCopyHelperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        (self.root/'source').write_bytes(b'private source')

    def test_cleanup_failure_preserves_committed_result(self):
        original = helper.os.unlink
        def failed(name, **kwargs):
            if name.startswith('.orion-copy-'):
                raise OSError('injected cleanup failure')
            return original(name, **kwargs)
        with patch.object(helper.os, 'unlink', side_effect=failed):
            result = helper.operate('copy', str(self.root), 'source', 'copy')
        self.assertIn('temporaryCleanupPending', result)
        self.assertEqual((self.root/'copy').read_bytes(), b'private source')
        self.assertTrue(helper.operate('verify', str(self.root), 'source','copy',result['resultHash'])['destinationMatches'])

    def test_ancestor_swap_cannot_redirect_copy_to_outside_symlink(self):
        (self.root/'allowed').mkdir()
        (self.root/'allowed/inside').mkdir()
        (self.root/'outside').mkdir()
        (self.root/'allowed/inside/source').write_bytes(b'authorized')
        (self.root/'outside/source').write_bytes(b'not authorized')
        original = helper.read_bytes
        def swapped(fd, name):
            (self.root/'allowed/inside').rename(self.root/'allowed/original-inside')
            (self.root/'allowed/inside').symlink_to(self.root/'outside', target_is_directory=True)
            return original(fd, name)
        with patch.object(helper, 'read_bytes', side_effect=swapped):
            result = helper.operate('copy', str(self.root/'allowed'), 'inside/source','inside/copy')
        self.assertEqual((self.root/'allowed/original-inside/copy').read_bytes(), b'authorized')
        self.assertFalse((self.root/'outside/copy').exists())
        with self.assertRaises(OSError):
            helper.operate('verify',str(self.root/'allowed'),'inside/source','inside/copy',result['resultHash'])

    def test_collision_and_bad_path_do_not_touch_existing_files(self):
        (self.root/'copy').write_bytes(b'keep')
        with self.assertRaises(FileExistsError):
            helper.operate('copy',str(self.root),'source','copy')
        self.assertEqual((self.root/'copy').read_bytes(), b'keep')
        self.assertFalse(list(self.root.glob('.orion-copy-*')))
        with self.assertRaises(ValueError):
            helper.operate('copy',str(self.root),'../source','new')
