#!/usr/bin/env bash
# Read-only Linux process/terminal capture. Deliberately excludes argv and environment.
set -euo pipefail

redcode_pid=${1:-}
if [[ ! "$redcode_pid" =~ ^[1-9][0-9]*$ ]] || [[ ! -r "/proc/$redcode_pid/status" ]]; then
  echo "Usage: bash script/diagnose-terminal.sh <live PID>" >&2
  exit 1
fi

printf 'Captured at: '
date -u '+%Y-%m-%dT%H:%M:%SZ'
printf 'Executable: '
readlink "/proc/$redcode_pid/exe" || true
printf '\nSystem memory (MiB):\n'
free -m
for pressure in cpu memory io; do
  if [[ -r "/proc/pressure/$pressure" ]]; then
    printf '\n%s pressure:\n' "$pressure"
    cat "/proc/pressure/$pressure"
  fi
done

redcode_tty=$(ps -p "$redcode_pid" -o tty= | tr -d ' ')
if [[ "$redcode_tty" =~ ^pts/[0-9]+$ ]] || [[ "$redcode_tty" =~ ^tty[0-9]+$ ]]; then
  printf '\nTerminal modes for /dev/%s (read only):\n' "$redcode_tty"
  stty -a -F "/dev/$redcode_tty" || true
fi

for sample in 1 2 3; do
  printf '\nSample %s:\n' "$sample"
  if [[ ! -r "/proc/$redcode_pid/status" ]]; then
    echo 'The target process has exited.'
    break
  fi
  ps -p "$redcode_pid" -o pid,ppid,pgid,tpgid,tty,stat,pcpu,rss,nlwp,etime,time,comm || true
  rg '^(Name|State|VmPeak|VmSize|VmRSS|VmSwap|Threads|voluntary_ctxt_switches|nonvoluntary_ctxt_switches):' "/proc/$redcode_pid/status" || true
  printf 'Kernel wait channel: '
  cat "/proc/$redcode_pid/wchan" 2>/dev/null || true
  printf '\nDirect children:\n'
  ps --ppid "$redcode_pid" -o pid,ppid,pgid,tty,stat,pcpu,rss,etime,comm || true
  if [[ "$sample" != 3 ]]; then sleep 1; fi
done
