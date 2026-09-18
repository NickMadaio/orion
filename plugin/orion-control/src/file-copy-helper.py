"""Descriptor-relative, bounded copy. No path component is followed as a symlink."""
import hashlib
import json
import os
from pathlib import PurePosixPath
import stat
import sys
import uuid
from contextlib import ExitStack

LIMIT = 64 * 1024 * 1024
DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def directory_at(stack, parent, name):
    fd = os.open(name, DIRECTORY, dir_fd=parent)
    stack.callback(os.close, fd)
    return fd


def root_fd(stack, root):
    if not root.startswith('/'):
        raise ValueError('absolute root required')
    fd = directory_at(stack, None, '/')
    for part in PurePosixPath(root).parts[1:]:
        if part in {'.', '..'}:
            raise ValueError('invalid root')
        fd = directory_at(stack, fd, part)
    return fd


def parent_fd(stack, root, relative):
    parts = relative.split('/')
    if not parts or any(not part or part.startswith('.') for part in parts):
        raise ValueError('visible relative path required')
    fd = root
    for part in parts[:-1]:
        fd = directory_at(stack, fd, part)
    return fd, parts[-1]


def read_bytes(parent, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > LIMIT:
            raise ValueError('copy requires a regular file no larger than 64 MiB')
        chunks = []
        size = 0
        while size <= before.st_size:
            chunk = os.read(fd, min(65536, before.st_size + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
        after = os.fstat(fd)
        if (size, after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
                before.st_size, before.st_size, before.st_mtime_ns, before.st_ctime_ns):
            raise ValueError('copy source changed while reading')
        return b''.join(chunks)
    finally:
        os.close(fd)


def operate(mode, root, source, destination, expected=None):
    with ExitStack() as stack:
        anchor = root_fd(stack, root)
        src, source_name = parent_fd(stack, anchor, source)
        dst, destination_name = parent_fd(stack, anchor, destination)
        content = read_bytes(src, source_name)
        digest = hashlib.sha256(content).hexdigest()
        if mode == 'verify':
            target_hash = hashlib.sha256(read_bytes(dst, destination_name)).hexdigest()
            return {'sourceMatches': digest == expected, 'destinationMatches': target_hash == expected}
        if mode != 'copy':
            raise ValueError('unsupported operation')
        temporary = '.orion-copy-' + uuid.uuid4().hex + '.tmp'
        published = False
        cleanup = False
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=dst)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.link(temporary, destination_name, src_dir_fd=dst, dst_dir_fd=dst, follow_symlinks=False)
            published = True
        finally:
            try:
                os.unlink(temporary, dir_fd=dst)
            except OSError:
                if published:
                    cleanup = True
                else:
                    raise
        result = {'resultHash': digest, 'bytes': len(content)}
        if cleanup:
            result['temporaryCleanupPending'] = temporary
        return result


if __name__ == '__main__':
    try:
        print(json.dumps(operate(*sys.argv[1:])))
    except Exception as error:
        # No file contents, credentials or arbitrary exception details in output.
        print(json.dumps({'error': type(error).__name__}), file=sys.stderr)
        sys.exit(1)
