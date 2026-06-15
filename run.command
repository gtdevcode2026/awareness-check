#!/usr/bin/env bash
# macOS: double-click this file (first time: right-click -> Open).
# Linux: run  ./run.command  in a terminal.
cd "$(dirname "$0")/awareness" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install the LTS from https://nodejs.org and try again."
  read -r -p "Press Enter to close..." _
  exit 1
fi

if [ ! -d node_modules/serve ]; then
  echo "Installing dependencies the first time, please wait..."
  npm install
fi

echo "Starting the app... it will open in your browser."
echo "Keep this window open while using the app. Close it to stop."

( sleep 2
  URL="http://127.0.0.1:4173"
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  fi
) &

npm run serve:static
