#!/bin/bash
# Suppress MaxListenersExceededWarning by setting environment variables
export NODE_OPTIONS="--max-listeners=1000"
export NODE_NO_WARNINGS=1

# Start the server
cd /home/maximorus/Documents/projects/syncthing-dash
node src/server.js
