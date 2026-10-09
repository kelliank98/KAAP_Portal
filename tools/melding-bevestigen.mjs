#!/usr/bin/env node
/*
  KAAP Inkoop-radar – melding bevestigen  v1.0
  Draait in de workflow alleen ná een geslaagde WhatsApp (of mail): zet gemeld_voorstel uit results.json door naar
  gemeld. Zo telt een treffer pas als gemeld als het bericht echt is aangekomen (ophaler v1.17, melding.mjs v1.3).

  Gebruik:  node tools/melding-bevestigen.mjs [results.json]
*/
import fs from 'node:fs';
import { bevestigGemeld } from './melding.mjs';

const pad = process.argv[2] || 'results.json';
const res = JSON.parse(fs.readFileSync(pad, 'utf8'));
const uit = bevestigGemeld(res);
if (uit === res) { console.log('Niets te bevestigen.'); process.exit(0); }
fs.writeFileSync(pad, JSON.stringify(uit, null, 1));
console.log(`Bevestigd: ${Object.keys(uit.gemeld || {}).length} auto('s) staan als gemeld in ${pad}.`);
