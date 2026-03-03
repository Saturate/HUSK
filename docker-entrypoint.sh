#!/bin/sh
# Fix /data ownership for bind mounts (host creates dir as root)
chown -R husk:husk /data
exec su-exec husk "$@"
