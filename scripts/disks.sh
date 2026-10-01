#!/bin/sh
# Show every external physical disk with its model and serial number, so you
# know exactly which /dev/diskN is which drive before you erase anything.
# Disk numbers change every time you plug something in — always run this first.
set -eu

disks=$(diskutil list external physical | awk '/^\/dev\/disk/ {print $1}')
if [ -z "$disks" ]; then
  echo "no external disks attached"
  exit 0
fi

for d in $disks; do
  echo "=== $d ==="
  diskutil info "$d" | awk -F': *' '/Disk Size/ {print "  size:   " $2}'
  if command -v smartctl >/dev/null 2>&1; then
    sudo smartctl -i "$d" | awk -F': *' '/Device Model/ {print "  model:  " $2} /Serial Number/ {print "  serial: " $2}'
  fi
  diskutil list "$d" | awk 'NR > 2 && NF > 0 {print "  " $0}'
done
