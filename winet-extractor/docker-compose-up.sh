#!/bin/bash

# The default base image covers 64-bit systems. Home Assistant no longer
# publishes 32-bit images, so those fall back to the last ones available.
ARCH=$(uname -m)
case $ARCH in
    aarch64|x86_64)
        ;;
    armv7l)
        export BUILD_FROM=ghcr.io/home-assistant/armv7-base:3.19
        ;;
    arm*)
        export BUILD_FROM=ghcr.io/home-assistant/armhf-base:3.19
        ;;
    i*86)
        export BUILD_FROM=ghcr.io/home-assistant/i386-base:3.19
        ;;
    *)
        echo "Unsupported architecture $ARCH"
        exit 1
        ;;
esac

docker compose up "$@"
