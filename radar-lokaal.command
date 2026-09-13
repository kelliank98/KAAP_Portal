#!/bin/bash
# KAAP Inkoop-radar: lokaal ophalen vanaf je eigen internetverbinding.
# Nodig als een site verzoeken uit datacenters weigert (mobile.de, Gaspedaal).
# Vereist Node.js LTS (nodejs.org). Dubbelklik dit bestand, of plan het via launchd.
cd "$(dirname "$0")"
node tools/inkoop-fetch.mjs profiles.json results.json
echo
echo "Klaar. Laad results.json in de app via: Gevonden resultaten > Laad results.json van schijf."
