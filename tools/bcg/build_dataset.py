"""Builds the compact ReadyNode dataset from raw BCG API responses (list.json + details/<id>.json).

Usage: python3 -I build_dataset.py <workDir> <outFile> <releaseLabel>
Input files are untrusted data; this script only parses JSON and strips HTML tags.
"""
import collections
import datetime
import json
import os
import re
import sys

work, out, release = sys.argv[1], sys.argv[2], sys.argv[3]
VENDORS = {
    'Dell': 'Dell',
    'Hewlett Packard Enterprise': 'HPE',
    'Lenovo': 'Lenovo',
    'Cisco': 'Cisco',
    'Supermicro Computer, Inc': 'Supermicro',
}


def strip(s):
    return re.sub(r'\s+', ' ', re.sub('<[^>]+>', ' ', s)).strip()


listing = json.load(open(os.path.join(work, 'list.json')))['data']['fieldValues']
by_id = {x['uuid']: x for x in listing}
nodes = []
for fn in sorted(os.listdir(os.path.join(work, 'details'))):
    pid = int(fn[:-5])
    x = by_id[pid]
    details = json.load(open(os.path.join(work, 'details', fn)))['data']['details']
    r = {
        'productId': pid,
        'vendor': VENDORS[x['vendor']],
        'model': x['model'][0]['name'],
        'cpuGeneration': x['cpuGeneration'],
        'supportedReleases': [s.strip() for s in x['supportedReleases'].split(',')],
        'bcgUrl': f'https://compatibilityguide.broadcom.com/detail?program=vsanesa&productId={pid}&persona=live',
    }
    for sec in details:
        for sub in sec['subsections']:
            title = strip(sub['title'])
            for f in sub['fields']:
                vals = f.get('fieldValues') or []
                names = [e['name'] if isinstance(e, dict) else strip(str(e)) for e in vals]
                if title.startswith('ReadyNode'):
                    r['profiles'] = sorted(set(re.findall(r'vSAN-[A-Z]+-[A-Z]+', ' '.join(map(str, vals)))))
                elif title.startswith('Maximum CPU Cores'):
                    r['maxCoresPerSocket'] = vals[0] if vals else None
                elif title.startswith('Max CPU Sockets'):
                    r['maxSockets'] = vals[0] if vals else None
                elif title.startswith('Maximum Total Memory'):
                    r['maxMemoryGB'] = vals[0] if vals else None
                elif title.startswith('Storage Devices (ESA'):
                    r['esaDrives'] = names
                elif title.startswith('Storage Devices (Cyber'):
                    r['cyberRecoveryDrives'] = [n for n in names if n != 'N/A']
                elif title.startswith('Maximum Drives'):
                    r['maxDrives'] = int(names[0]) if names and names[0].isdigit() else names
                elif title.startswith('NIC'):
                    r['nics'] = names
                elif title.startswith('Boot Device'):
                    r['bootDevice'] = names[0] if names else None
                elif title.startswith('PCIe Switch'):
                    r['pcieSwitch'] = names[0] if names else None
                elif title.startswith('Notes'):
                    r['notes'] = ' '.join(names)
    for key in ('esaDrives', 'cyberRecoveryDrives', 'nics', 'supportedReleases'):
        if isinstance(r.get(key), list):
            r[key] = sorted(r[key])  # BCG returns these in unstable order
    nodes.append(r)

meta = {
    'source': 'Broadcom Compatibility Guide – vSAN ESA ReadyNode (program vsanesa)',
    'release': release,
    'listQuery': 'POST https://compatibilityguide.broadcom.com/compguide/programs/viewResults',
    'detailQuery': 'POST https://compatibilityguide.broadcom.com/compguide/programs/viewDetails?programId=vsanesa&id=<productId>',
    'fetchedAt': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'),
    'totalReadyNodesAllVendors': len(listing),
    'vendors': dict(collections.Counter(n['vendor'] for n in nodes)),
}
json.dump({'meta': meta, 'readyNodes': nodes}, open(out, 'w'), indent=1, ensure_ascii=False)
print(json.dumps(meta, ensure_ascii=False))
