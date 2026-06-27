#!/bin/bash
# Script to start the backend server on port 3001
# If something is already running on port 3001, kill it

# Find the process using port 3001
PID=$(lsof -ti:3001)

if [ ! -z "$PID" ]; then
    echo "Found process(es) using port 3001: $PID"
    echo "Killing process..."
    kill -9 $PID
    echo "Process killed."
fi

# Start the Node server
cd "$(dirname "$0")/backend"
echo "Starting backend server..."
node server.js