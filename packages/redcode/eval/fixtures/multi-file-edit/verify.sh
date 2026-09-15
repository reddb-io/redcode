#!/bin/sh
# Verifies the rename: no greet left, and main prints the welcome message.
if grep -rn "greet()" src; then echo "FAIL greet() still defined"; exit 1; fi
out=$(sh src/main.sh world)
[ "$out" = "welcome world" ] || { echo "FAIL expected welcome world, got $out"; exit 1; }
echo "VERIFY OK"
