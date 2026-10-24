#!/bin/sh

cd /usr/src/app || exit

# s6 clears the container environment; with-contenv restores it so settings
# can be overridden with environment variables. exec so node receives signals
# directly, without an extra process in between.
if [ -x /usr/bin/with-contenv ]; then
  exec /usr/bin/with-contenv node build/src/index.js
fi
exec node build/src/index.js
