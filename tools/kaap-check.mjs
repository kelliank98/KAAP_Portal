#!/usr/bin/env node
/*  KAAP weekcontrole  v1.00
    Kijkt of elke site nog te bereiken is, of de parsers nog kloppen en of de
    proxy nog werkt. Schrijft STATUS.md en zet exitcode 1 bij een storing,
    zodat de workflow de mail/WhatsApp kan sturen.
    Gebruik: node tools/kaap-check.mjs [proxy-url]
*/

const PROXY = process.argv[2] || 'https://kaap-proxy.kelliankaap.workers.dev/';
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const UA_MOBIEL = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const haal = async (url, ua = UA_DESKTOP) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 25000);
  try {
    const r = await fetch(url, {headers: {'User-Agent': ua, 'Accept-Language': 'nl,de;q=0.8'}, signal: c.signal});
    return {status: r.status, tekst: await r.text()};
  } catch (e) {
    return {status: 0, tekst: '', fout: String(e.name === 'AbortError' ? 'time-out' : e).slice(0, 60)};
  } finally { clearTimeout(t); }
};

// Per site: een vaste zoekopdracht plus de controle of het antwoord bruikbaar is.
const TESTEN = [
  {naam: 'AutoScout24 DE', url: 'https://www.autoscout24.de/lst/bmw/x5?atype=C&cy=D&custtype=D',
   check: t => (t.match(/"numberOfResults":(\d+)/) || [])[1]},
  {naam: 'AutoScout24 NL', url: 'https://www.autoscout24.nl/lst/bmw/x5?atype=C&cy=NL&custtype=D',
   check: t => (t.match(/"numberOfResults":(\d+)/) || [])[1]},
  {naam: 'AutoScout24 BE', url: 'https://www.autoscout24.be/nl/lst/bmw/x5?atype=C&cy=B&custtype=D',
   check: t => (t.match(/"numberOfResults":(\d+)/) || [])[1]},
  {naam: 'Marktplaats', url: 'https://www.marktplaats.nl/lrp/api/search?l1CategoryId=91&l2CategoryId=96&query=x5&limit=3',
   check: t => { try { return String(JSON.parse(t).totalResultCount); } catch (e) { return null; } }},
  {naam: '2dehands', url: 'https://www.2dehands.be/lrp/api/search?l1CategoryId=91&l2CategoryId=96&query=x5&limit=3',
   check: t => { try { return String(JSON.parse(t).totalResultCount); } catch (e) { return null; } }},
  {naam: 'Kleinanzeigen', url: 'https://www.kleinanzeigen.de/s-autos/anbieter:gewerblich/x5/k0c216+autos.marke_s:bmw',
   ua: UA_MOBIEL, check: t => (t.match(/([\d.]+)\s*Ergebnisse/) || [])[1]},
];

const regels = [];
let storingen = 0;

for (const test of TESTEN) {
  const direct = await haal(test.url, test.ua || UA_DESKTOP);
  const aantalDirect = direct.status === 200 ? test.check(direct.tekst) : null;

  const viaProxy = await haal(PROXY + '?url=' + encodeURIComponent(test.url), test.ua || UA_DESKTOP);
  const aantalProxy = viaProxy.status === 200 ? test.check(viaProxy.tekst) : null;

  const okDirect = !!aantalDirect;
  const okProxy = !!aantalProxy;
  if (!okDirect || !okProxy) storingen++;

  regels.push({
    naam: test.naam,
    ophaler: okDirect ? `ok (${aantalDirect})` : `MISLUKT (${direct.fout || 'HTTP ' + direct.status})`,
    app: okProxy ? `ok (${aantalProxy})` : `MISLUKT (${viaProxy.fout || 'HTTP ' + viaProxy.status})`,
  });
  console.log(`${test.naam.padEnd(16)} ophaler: ${regels.at(-1).ophaler.padEnd(20)} app: ${regels.at(-1).app}`);
  await new Promise(r => setTimeout(r, 1500));
}

// De app zelf
const app = await haal('https://kelliank98.github.io/KAAP_Portal/inkoop.html');
const appVersie = (app.tekst.match(/APP_VERSIE = '([\d.]+)'/) || [])[1];
if (!appVersie) storingen++;
console.log(`App              ${appVersie ? 'ok (v' + appVersie + ')' : 'MISLUKT (HTTP ' + app.status + ')'}`);

// Alleen een link, dus we controleren of de pagina nog bestaat
const linkSites = [
  {naam: 'mobile.de', url: 'https://suchen.mobile.de/fahrzeuge/search.html?isSearchRequest=true&s=Car&vc=Car&ms=3500'},
  {naam: 'Gaspedaal', url: 'https://www.gaspedaal.nl/bmw/x5'},
];
const linkRegels = [];
for (const s of linkSites) {
  const r = await haal(s.url);
  linkRegels.push({naam: s.naam, status: r.status === 200 ? 'bereikbaar' : (r.status === 403 ? 'blokkeert ophalen (verwacht)' : 'HTTP ' + r.status)});
  console.log(`${s.naam.padEnd(16)} ${linkRegels.at(-1).status}`);
}

const nu = new Date().toLocaleString('nl-NL', {timeZone: 'Europe/Amsterdam'});
const md = `# Weekcontrole KAAP Inkoop Radar

Laatste controle: **${nu}** — ${storingen ? `**${storingen} storing${storingen === 1 ? '' : 'en'}**` : 'alles werkt'}

| Site | Ophaler (GitHub) | App (via proxy) |
| --- | --- | --- |
${regels.map(r => `| ${r.naam} | ${r.ophaler} | ${r.app} |`).join('\n')}

App: ${appVersie ? 'v' + appVersie + ' bereikbaar' : 'NIET bereikbaar'}

Alleen-link-sites: ${linkRegels.map(r => `${r.naam}: ${r.status}`).join(' · ')}

*Ophaler = zoals de radar in GitHub ophaalt. App = zoals Zoeken in de app het doet, via je Cloudflare-proxy.
MISLUKT betekent geblokkeerd of veranderd; dan moet de parser of de proxy nagekeken worden.*
`;

const fs = await import('node:fs');
fs.writeFileSync('STATUS.md', md);
console.log(`\nKlaar: ${storingen} storing(en). STATUS.md geschreven.`);
process.exit(storingen ? 1 : 0);
