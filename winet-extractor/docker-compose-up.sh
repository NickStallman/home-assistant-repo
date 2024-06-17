#!/bin/bash

ARCH=$(uname -m)
case $ARCH in
    aarch64)
        export BUILD_FROM=ghcr.io/home-assistant/aarch64-base:3.19
        ;;
    armv7l)
        export BUILD_FROM=ghcr.io/home-assistant/armv7-base:3.19
        ;;
    arm*)
        export BUILD_FROM=ghcr.io/home-assistant/armhf-base:3.19
        ;;
    x86_64)
        export BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.19
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