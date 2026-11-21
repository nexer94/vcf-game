#!/usr/bin/env bash
# Refreshes docs/spec/data/bcg-vsan-esa-readynodes-esxi91.json from the Broadcom Compatibility Guide (BCG).
# Uses the same JSON API the BCG web app calls (viewResults + viewDetails), politely (1 request / s).
# Usage: tools/bcg/fetch-readynodes.sh [release-label]   (default: "ESXi 9.1 (vSAN 9.1)")
set -euo pipefail
RELEASE="${1:-ESXi 9.1 (vSAN 9.1)}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
API="https://compatibilityguide.broadcom.com/compguide/programs"

body=$(python3 -I -c 'import json,sys; print(json.dumps({"programId":"vsanesa","filters":[{"displayKey":"vsanReadynodeSupportedReleases","filterValues":[sys.argv[1]]}],"keyword":[],"date":{"startDate":"","endDate":""}}))' "$RELEASE")
curl -sS --fail --max-time 120 -X POST -H 'Content-Type: application/json' -d "$body" \
  "$API/viewResults?limit=1000&page=1&sortBy=&sortType=ASC" -o "$WORK/list.json"

python3 -I -c '
import json,sys
v=json.load(open(sys.argv[1]))["data"]["fieldValues"]
V={"Dell","Hewlett Packard Enterprise","Lenovo","Cisco","Supermicro Computer, Inc"}
print("\n".join(str(x["uuid"]) for x in v if x["vendor"] in V))' "$WORK/list.json" > "$WORK/ids.txt"

mkdir -p "$WORK/details"
while read -r id; do
  curl -sS --fail --max-time 60 -X POST -H 'Content-Type: application/json' \
    "$API/viewDetails?programId=vsanesa&id=$id&filterBy=" -o "$WORK/details/$id.json"
  sleep 1
done < "$WORK/ids.txt"

python3 -I "$ROOT/tools/bcg/build_dataset.py" "$WORK" "$ROOT/docs/spec/data/bcg-vsan-esa-readynodes-esxi91.json" "$RELEASE"
