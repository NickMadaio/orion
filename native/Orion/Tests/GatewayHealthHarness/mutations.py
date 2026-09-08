"""Optional mutation proof; only generated scratch copies are modified."""
import os
from pathlib import Path
import subprocess
repo=Path(__file__).resolve().parents[4]
work=repo/'native/Orion/Tests/.build/gateway-mutants'
work.mkdir(parents=True, exist_ok=True)
source=(repo/'native/Orion/Sources/Orion/GatewayHealth.swift').read_text()
env=dict(os.environ,DEVELOPER_DIR='/Applications/Xcode.app/Contents/Developer')
mutants=[
('expiry', 'age <= 20', 'age <= 200000', 'old green expires'),
('event-loop', 'readiness.eventLoop?.degraded == true ? .degraded : .ready', '.ready', 'event loop degradation is visible'),
('redirect', 'completionHandler(nil)', 'completionHandler(request)', 'transport'),
('body-cap', '64 * 1024', '1024 * 1024', 'transport'),
]
for name,old,new,expected in mutants:
    assert old in source
    path=work/(name+'.swift');path.write_text(source.replace(old,new))
    binary=work/name
    build=subprocess.run(['xcrun','swiftc','-O',str(path),str(repo/'native/Orion/Tests/GatewayHealthHarness/main.swift'),'-o',str(binary)],env=env,capture_output=True,text=True)
    assert build.returncode==0,build.stderr
    cmd=['python3',str(repo/'native/Orion/Tests/GatewayHealthHarness/transport.py'),str(binary)] if name in ('redirect','body-cap') else [str(binary)]
    run=subprocess.run(cmd,capture_output=True,text=True,timeout=10)
    assert run.returncode!=0, f'{name} mutant survived'
    if name not in ('redirect','body-cap'): assert expected in run.stdout,run.stdout
    else: assert ("('redirect'," if name=='redirect' else "('oversized',") in run.stderr,run.stderr
    print('KILLED',name)

menu=(repo/'native/Orion/Sources/Orion/MenuBarController.swift').read_text()
assert 'Timer(timeInterval: 1,' in menu
path=work/'menu.swift';path.write_text(menu.replace('Timer(timeInterval: 1,','Timer(timeInterval: 1000,'))
binary=work/'menu-mutant'
build=subprocess.run(['xcrun','swiftc','-O',str(repo/'native/Orion/Sources/Orion/GatewayHealth.swift'),str(path),str(repo/'native/Orion/Tests/GatewayMenuHarness/main.swift'),'-o',str(binary)],env=env,capture_output=True,text=True)
assert build.returncode==0,build.stderr
run=subprocess.run([str(binary)],capture_output=True,text=True,timeout=10)
assert run.returncode!=0 and 'open menu expires green' in run.stdout,run.stdout
print('KILLED menu-refresh')
