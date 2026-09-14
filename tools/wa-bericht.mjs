#!/usr/bin/env node
/*
  Maakt van new_items.md een kort WhatsApp-bericht voor CallMeBot.
  Gebruik: node tools/wa-bericht.mjs new_items.md
  Schrijft de tekst naar de standaarduitvoer; leeg als er niets nieuws is.
*/
import fs from 'node:fs';

const pad = process.argv[2] || 'new_items.md';
const MAX_REGELS = 6;        // meer wordt onleesbaar op een telefoon
const MAX_TEKENS = 900;      // CallMeBot knipt lange berichten af

let md = '';
try { md = fs.readFileSync(pad, 'utf8'); } catch (e) { process.exit(0); }
if (!md.trim()) process.exit(0);

// Regels zien eruit als:
// - **Profiel** · Site: [Titel](url) – € 30.750, 34.101 km, EZ 2021-07
const regels = md.split('\n').filter(r => r.trim().startsWith('- **'));
if (!regels.length) process.exit(0);

const nieuw = (md.match(/##\s+(\d+)\s+nieuwe advertentie/) || [])[1];
const prijs = (md.match(/##\s+(\d+)\s+prijsverlaging/) || [])[1];

const kop = [
  nieuw ? `${nieuw} nieuw` : null,
  prijs ? `${prijs} prijsverlaging${prijs === '1' ? '' : 'en'}` : null,
].filter(Boolean).join(', ');

const items = regels.slice(0, MAX_REGELS).map(r => {
  const titel = (r.match(/\[([^\]]+)\]/) || [, ''])[1].slice(0, 60);
  const url = (r.match(/\]\(([^)]+)\)/) || [, ''])[1];
  const site = (r.match(/·\s*([^:]+):/) || [, ''])[1].trim();
  const staart = r.split('–').slice(1).join('–').trim().slice(0, 70);
  return `*${titel}*\n${site} · ${staart}\n${url}`;
});

let tekst = `*KAAP Inkoop-radar* — ${kop}\n\n` + items.join('\n\n');
if (regels.length > MAX_REGELS) tekst += `\n\n+ ${regels.length - MAX_REGELS} meer in de app.`;
if (tekst.length > MAX_TEKENS) tekst = tekst.slice(0, MAX_TEKENS - 3) + '...';

process.stdout.write(tekst);
