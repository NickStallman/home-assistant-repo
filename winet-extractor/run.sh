#!/bin/sh

cd /usr/src/app || exit

# Restore the container environment cleared by s6, then exec Node directly.
exec /usr/bin/with-contenv node build/src/index.js
