#!/bin/bash

# Load environment variables from .env file
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | grep REDIS | xargs)
else
    echo "Error: .env file not found"
    exit 1
fi

# Check if redli is installed
if ! command -v redli &> /dev/null; then
    echo "redli is not installed. Trying redis-cli instead..."
    if ! command -v redis-cli &> /dev/null; then
        echo "Error: Neither redli nor redis-cli is installed"
        echo "Install redli: brew install redli (macOS) or download from https://github.com/IBM-Cloud/redli/releases"
        echo "Or install redis-cli: brew install redis (macOS) or apt-get install redis-tools (Ubuntu)"
        exit 1
    fi
    # Use redis-cli as fallback
    redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASSWORD" "$@"
else
    # Use redli (preferred)
    redli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASSWORD" "$@"
fi
