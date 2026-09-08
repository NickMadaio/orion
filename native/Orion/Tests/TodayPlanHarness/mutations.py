"""Optional mutation proof on copied sources; never alters the working app."""
import os
import re
from pathlib import Path
import shutil
import subprocess

repo = Path(__file__).resolve().parents[4]
work = repo / 'native/Orion/Tests/.build/today-plan-mutants'
work.mkdir(parents=True, exist_ok=True)
(work / 'Package.swift').write_text('''// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "TodayMutationCheck", platforms: [.macOS(.v14)], targets: [
.target(name: "MobileCore", swiftSettings: [.swiftLanguageMode(.v5)]),
.target(name: "SessionService", dependencies: ["MobileCore"], swiftSettings: [.swiftLanguageMode(.v5)]),
.testTarget(name: "TodayPlanTests", dependencies: ["MobileCore", "SessionService"], swiftSettings: [.swiftLanguageMode(.v5)])])
''')
shutil.copytree(repo / 'native/OrionMobile/Sources/MobileCore', work / 'Sources/MobileCore', dirs_exist_ok=True)
(work / 'Sources/SessionService').mkdir(parents=True, exist_ok=True)
(work / 'Tests/TodayPlanTests').mkdir(parents=True, exist_ok=True)
shutil.copy2(repo / 'native/Orion/Sources/SessionService/TodayPlanStore.swift', work / 'Sources/SessionService/TodayPlanStore.swift')
shutil.copy2(repo / 'native/Orion/Tests/SessionServiceTests/TodayPlanTests.swift', work / 'Tests/TodayPlanTests/TodayPlanTests.swift')
env = dict(os.environ, DEVELOPER_DIR='/Applications/Xcode.app/Contents/Developer')

def run(name, expected_failure=None):
    result = subprocess.run(['swift', 'test', '--package-path', str(work)], env=env, capture_output=True, text=True, timeout=180)
    output = result.stdout + result.stderr
    (work / (name + '.log')).write_text(output)
    if expected_failure is None:
        assert result.returncode == 0, output[-5000:]
    else:
        assert result.returncode != 0 and "Test Suite" in output and re.search(r"Test Case .*" + re.escape(expected_failure) + r".* failed", output), output[-5000:]
    print(('PASS baseline' if expected_failure is None else 'KILLED ' + name), flush=True)

run('baseline')
store = work / 'Sources/SessionService/TodayPlanStore.swift'
scheduler = work / 'Sources/MobileCore/TodayPlanScheduler.swift'
mutations = [
    ('stale-writer', store, 'document.revision == expectedRevision,', 'true,', 'testStaleWriterCannotOverwriteAcceptedRevision'),
    ('duplicate-accept', store, 'if let receipt = document.receipts.first', 'if false, let receipt = document.receipts.first', 'testDuplicateOperationIsIdempotentIncludingAfterUndo'),
    ('wrong-replay', store, 'receipt.fingerprint == fingerprint', 'true', 'testReplayIdentifierCannotAuthorizeDifferentContent'),
    ('lost-undo', store, 'document.undo = document.current', 'document.undo = nil', 'testAtomicRevisionSurvivesReopenAndUndo'),
    ('free-time', scheduler, 'available - preferences.freeMinutes', 'available', 'testFreeTimeIsReservedBeforeSelectingWork'),
    ('deadline-order', scheduler, '($0.priority, $0.due ?? .distantFuture, $0.id) < ($1.priority, $1.due ?? .distantFuture, $1.id)', '($0.priority, $0.id) < ($1.priority, $1.id)', 'testEqualPriorityTasksUseDeadlinesBeforeSourceIdentifiers'),
]
for name, path, old, new, expected in mutations:
    original = path.read_text()
    assert old in original, name
    path.write_text(original.replace(old, new))
    try:
        run(name, expected)
    finally:
        path.write_text(original)
