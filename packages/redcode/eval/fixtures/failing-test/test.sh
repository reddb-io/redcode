#!/bin/sh
# The project test: sum.sh must add.
out=$(sh src/sum.sh 2 3)
if [ "$out" = "5" ]; then
  echo "PASS sum 2 3 = 5"
else
  echo "FAIL sum 2 3: expected 5, got $out"
  exit 1
fi
