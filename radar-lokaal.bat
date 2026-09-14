@echo off
rem KAAP Inkoop-radar: lokaal ophalen (alleen nodig als GitHub door een site wordt geblokkeerd).
rem Vereist Node.js LTS (nodejs.org). Plan dit bestand in Windows Taakplanner, bijv. elke 2 uur.
cd /d %~dp0
node tools\inkoop-fetch.mjs profiles.json results.json
rem Daarna in de app: Gevonden resultaten > "Laad results.json van schijf".
