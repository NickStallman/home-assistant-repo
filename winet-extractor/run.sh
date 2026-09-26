#!/bin/sh

cd /usr/src/app || exit

# exec so node receives signals directly, without an extra npm process
exec node build/src/index.js
