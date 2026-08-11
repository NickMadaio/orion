import json, os, sys, collections
p = os.path.expanduser('~/.openclaw/orion-controlled/health-log.json')
try:
    d = json.load(open(p))
except Exception as e:
    print(f"  !! FILE UNREADABLE — total loss: {e}")
    sys.exit(1)
names = d.get('supplements', [])
names = [s['name'] for s in names]
have = set(names)
total_lost = 0
for side, issued_file in (('swift', sys.argv[1]), ('ts', sys.argv[2])):
    issued = int(open(issued_file).read())
    want = {f"{side}-{i:05d}" for i in range(issued)}
    present = len(want & have)
    lost = issued - present
    total_lost += lost
    print(f"  {side:5s}  issued={issued:5d}  present={present:5d}  LOST={lost:5d}")
print(f"  TOTAL LOST UPDATES: {total_lost}")
dupes = [k for k, v in collections.Counter(names).items() if v > 1]
if dupes: print(f"  DUPLICATES: {len(dupes)}")
other = [x for x in names if not (x.startswith('swift-') or x.startswith('ts-'))]
print(f"  pre-existing rows surviving: {other}")
