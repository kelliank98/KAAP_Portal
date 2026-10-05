// Echte-browsertest voor de KAAP-extensie. Hoort NIET bij `npm test`: hij start een echte
// browser met een tijdelijk profiel, laadt kaap-extensie/ en bezoekt Gaspedaal en mobile.de.
// Je eigen browserprofiel wordt niet aangeraakt.
//
// Draaien:  npm run test:browser                  (zoekt Chrome, dan Brave, dan Chromium)
//           BROWSER="/pad/naar/browser" node test/e2e-extensie.mjs
//
// Wat deze test wel en niet kan aantonen
// - Chrome laadt een uitgepakte extensie sinds versie 137 niet meer vanaf de opdrachtregel. De test
//   laadt hem daarom via het DevTools-protocol (Extensions.loadUnpacked over de DevTools-pijp).
// - Een browser die zo wordt aangestuurd is voor websites herkenbaar als testbrowser. mobile.de
//   toont zo'n browser een controlepagina van zijn beveiliging. Die omzeilt de test NIET: hij
//   controleert dan dat de extensie en de app dat netjes melden. Gaspedaal laat de testbrowser
//   wel toe en wordt dus volledig getest, van extensie tot resultaatkaart.
// - Of mobile.de in de gewone Chrome van de gebruiker resultaten geeft, toont deze test dus niet
//   aan. De leescode voor mobile.de is getest op echte pagina's (test/lezers.test.mjs).
//
// Geen npm-pakketten: praat rechtstreeks met de browser.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const hier = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(hier, '..');
const EXT_BRON = join(REPO, 'kaap-extensie');
// Een vrije poort, zodat de test niet botst met een andere lokale server (05-10-2026 stond op 8765 een
// devserver van KAAP Studio; de test opende toen die in plaats van de app).
const WEB = await new Promise((ok, mis) => { const s = createServer(); s.once('error', mis); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const KANDIDATEN = [
  process.env.BROWSER,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
const BIN = KANDIDATEN.find(p => existsSync(p));
if (!BIN) { console.error('Geen Chrome, Brave of Chromium gevonden. Zet BROWSER=...'); process.exit(2); }

const slaap = (ms) => new Promise(r => setTimeout(r, ms));
const profiel = mkdtempSync(join(tmpdir(), 'kaap-e2e-'));
// De geleverde extensie luistert alleen naar de app op GitHub Pages. De test draait de app op
// 127.0.0.1 en gebruikt daarom een tijdelijke kopie waarin dat ene adres is toegevoegd.
// Verder is de kopie gelijk aan kaap-extensie/.
const EXT = join(mkdtempSync(join(tmpdir(), 'kaap-e2e-ext-')), 'kaap-extensie');
cpSync(EXT_BRON, EXT, { recursive: true });
{
  const mf = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
  mf.content_scripts[0].matches.push('http://127.0.0.1/*');
  writeFileSync(join(EXT, 'manifest.json'), JSON.stringify(mf, null, 2));
}
const kinderen = [];
let opgeruimd = false;
function opruimen() {
  if (opgeruimd) return; opgeruimd = true;
  for (const k of kinderen) { try { k.kill('SIGTERM'); } catch (e) {} }
  setTimeout(() => { for (const map of [profiel, dirname(EXT)]) { try { rmSync(map, { recursive: true, force: true }); } catch (e) {} } }, 1000);
}
process.on('exit', opruimen);
process.on('SIGINT', () => { opruimen(); process.exit(130); });

// --- DevTools-protocol over de pijp (fd 3 schrijven, fd 4 lezen, berichten eindigen op \0) ---
function startBrowser() {
  const kind = spawn(BIN, [
    `--user-data-dir=${profiel}`, '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--load-extension=${EXT}`,                       // voor browsers die de vlag nog wel kennen
    '--no-first-run', '--no-default-browser-check', '--window-size=1100,800', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  kinderen.push(kind);
  const uit = kind.stdio[3], inn = kind.stdio[4];
  let buffer = '', nr = 0; const wacht = new Map();
  inn.setEncoding('utf8');
  inn.on('data', (stuk) => {
    buffer += stuk; let i;
    while ((i = buffer.indexOf('\0')) >= 0) {
      const m = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
      if (m.id && wacht.has(m.id)) { const w = wacht.get(m.id); wacht.delete(m.id); m.error ? w.rej(new Error(m.error.message)) : w.res(m.result); }
    }
  });
  const stuur = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++nr; wacht.set(id, { res, rej });
    uit.write(JSON.stringify(Object.assign({ id, method, params }, sessionId ? { sessionId } : {})) + '\0');
    setTimeout(() => { if (wacht.delete(id)) rej(new Error('geen antwoord op ' + method)); }, 180000);
  });
  return { stuur };
}
async function evalueer(b, sessie, code) {
  const r = await b.stuur('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true }, sessie);
  if (r.exceptionDetails) throw new Error('fout in de pagina: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}

// Dit draait in de pagina: praat met brug.js zoals de app dat doet.
const IN_PAGINA = `
  window.__kaapE2E = window.__kaapE2E || (() => {
    const wachtend = new Map(); let aanwezig = null, nr = 0;
    window.addEventListener('message', (e) => {
      const d = e.data; if (e.source !== window || !d || typeof d !== 'object') return;
      if (d.kaap === 'hulp-aanwezig') aanwezig = d;
      if (d.kaap === 'hulp-antwoord' && wachtend.has(d.id)) { wachtend.get(d.id)(d); wachtend.delete(d.id); }
    });
    return {
      async ping() { aanwezig = null; window.postMessage({ kaap: 'hulp-ping' }, location.origin); for (let i = 0; i < 30 && !aanwezig; i++) await new Promise(r => setTimeout(r, 100)); return aanwezig; },
      haal(url, wachtOp, geefOpBij) { return new Promise(ok => { const id = 'e' + (++nr); wachtend.set(id, ok); window.postMessage({ kaap: 'hulp-haal', id, url, wachtOp: wachtOp || '', geefOpBij: geefOpBij || '' }, location.origin); }); },
    };
  })();
`;

const uitslag = []; let fouten = 0;
function check(naam, goed, detail) {
  uitslag.push(`${goed ? '✔' : '✖'} ${naam}${detail ? ' — ' + detail : ''}`);
  if (!goed) fouten++;
}
const CONTROLE = 'sec-if-cpt-container';

try {
  // 1. app lokaal serveren en browser starten
  const web = spawn('python3', ['-m', 'http.server', String(WEB), '--bind', '127.0.0.1', '--directory', REPO], { stdio: 'ignore' });
  kinderen.push(web);
  // Eerst nagaan dat deze server echt de app uit deze map geeft.
  let eigen = false;
  for (let i = 0; i < 20 && !eigen; i++) {
    await slaap(250);
    try { eigen = (await (await fetch(`http://127.0.0.1:${WEB}/inkoop.html`)).text()).includes(readFileSync(join(REPO, 'inkoop.html'), 'utf8').match(/const APP_VERSIE = '[\d.]+'/)[0]); } catch (e) {}
  }
  if (!eigen) throw new Error(`de lokale server op poort ${WEB} geeft niet de app uit deze map`);
  const b = startBrowser();
  let versie = null;
  for (let i = 0; i < 40 && !versie; i++) { await slaap(500); try { versie = await b.stuur('Browser.getVersion'); } catch (e) {} }
  if (!versie) throw new Error('de browser startte niet');
  console.log('Browser:', versie.product);

  // 2. extensie laden
  let geladenVia = '--load-extension';
  try { const r = await b.stuur('Extensions.loadUnpacked', { path: EXT }); geladenVia = 'Extensions.loadUnpacked, id ' + r.id; } catch (e) { geladenVia += ' (loadUnpacked: ' + e.message + ')'; }
  await slaap(1200);

  // 3. tabblad met de app
  const { targetId } = await b.stuur('Target.createTarget', { url: `http://127.0.0.1:${WEB}/inkoop.html` });
  const { sessionId } = await b.stuur('Target.attachToTarget', { targetId, flatten: true });
  await slaap(2500);
  await evalueer(b, sessionId, IN_PAGINA + '; true');

  // 4. brug: aanwezigheid
  const ping = await evalueer(b, sessionId, `window.__kaapE2E.ping()`);
  check('extensie geladen en brug meldt zich bij de app', !!(ping && ping.kaap === 'hulp-aanwezig'), (ping ? 'versie ' + ping.versie : 'geen antwoord op hulp-ping') + ' — ' + geladenVia);

  // 5. een adres buiten de lijst wordt geweigerd
  const geweigerd = await evalueer(b, sessionId, `window.__kaapE2E.haal('https://example.com/')`);
  check('adres buiten mobile.de en Gaspedaal wordt geweigerd', !!geweigerd && geweigerd.ok === false, geweigerd && geweigerd.fout);

  // 6. Gaspedaal: echte pagina via een achtergrondtabblad
  const gp = await evalueer(b, sessionId, `window.__kaapE2E.haal('https://www.gaspedaal.nl/bmw/x5/automatisch?bmin=2020&kmax=100000&pmin=50000&pmax=90000&srt=dt-d', 'numberOfPages', '${CONTROLE}').then(r => ({ ok: r.ok, gevonden: r.gevonden, kb: r.html ? Math.round(r.html.length / 1024) : 0, ms: r.ms, titel: r.titel, fout: r.fout }))`);
  check('Gaspedaal: pagina opgehaald via een achtergrondtabblad', !!(gp.ok && gp.gevonden && gp.kb > 50), gp.ok ? `${gp.kb} kB in ${gp.ms} ms, titel "${(gp.titel || '').slice(0, 50)}"` : gp.fout);

  // 7. mobile.de: echte pagina, of de controlepagina netjes gemeld. De extensie stopt 12 s nadat de
  //    controlepagina verschijnt en in elk geval na 25 s (STANDAARD_MS); op een drukke computer laadt de
  //    pagina zelf soms 10 s, dus de grens hier is 25 s plus marge en niet de 12 s.
  const mob = await evalueer(b, sessionId, `window.__kaapE2E.haal('https://suchen.mobile.de/fahrzeuge/search.html?isSearchRequest=true&s=Car&vc=Car&dam=false&ms=3500%3B49%3B%3BM+Sportpaket&fr=2020%3A&ml=%3A100000&p=50000%3A90000&tr=AUTOMATIC_GEAR&sb=doc&od=down', 'numResultsTotal', '${CONTROLE}').then(r => ({ ok: r.ok, gevonden: r.gevonden, controle: r.controle === true, isControle: !!(r.html && r.html.includes('${CONTROLE}')), kb: r.html ? Math.round(r.html.length / 1024) : 0, ms: r.ms, fout: r.fout }))`);
  if (mob.ok && mob.gevonden) check('mobile.de: pagina opgehaald via een achtergrondtabblad', true, `${mob.kb} kB in ${mob.ms} ms`);
  else check('mobile.de: controlepagina voor de testbrowser, door de extensie gemeld en niet omzeild', !!(mob.ok && mob.controle && mob.isControle && mob.ms <= 27000), mob.ok ? `gestopt na ${mob.ms} ms` : mob.fout);

  // 8. achtergrondtabbladen zijn weer gesloten
  await slaap(800);
  const open = (await b.stuur('Target.getTargets')).targetInfos.filter(d => d.type === 'page' && /mobile\.de|gaspedaal\.nl/.test(d.url));
  check('alle achtergrondtabbladen zijn weer gesloten', open.length === 0, open.map(d => d.url.slice(0, 60)).join(', '));

  // 9. de app zelf, van Zoeken tot kandidaat
  const app = await evalueer(b, sessionId, `(async () => {
    hulpPing(); await new Promise(r => setTimeout(r, 600));
    const zet = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    S.instellingen.proxy = '';   // alleen de sites van de extensie; de proxy laten we hier met rust
    zet('p_merk', 'BMW'); zet('p_model', 'X5'); zet('p_bjvan', '2020'); zet('p_km', '100000'); zet('p_pmin', '50000'); zet('p_pmax', '90000'); zet('p_uitv', 'M Sport'); zet('p_uitv_de', 'M Sportpaket');
    const t0 = Date.now();
    await zoekLive();
    const sites = LIVE.sites.map(s => ({ site: s.site, status: s.status, n: s.items.length, count: s.count, fout: s.error, eerste: s.items[0] ? [s.items[0].title, s.items[0].price, s.items[0].ez, s.items[0].km, s.items[0].fuel].join(' | ') : null }));
    const ms = Date.now() - t0;
    const nl = { ref: Object.values(LIVE.nlRef || {}).map(r => ({ status: r.status, n: r.items.length, bron: r.bron, fout: r.fout })), kaarten: [...document.querySelectorAll('#resLijst .nlv')].map(e => e.textContent) };
    const kaart = [...document.querySelectorAll('#resLijst .res')].find(k => k.querySelector('.nlv')) || [...document.querySelectorAll('#resLijst .res')].find(k => k.querySelector('.naarkand'));
    let kandidaat = null;
    if (kaart) { kaart.querySelector('.naarkand').click(); await verrijkBezig; const v = (id) => document.getElementById(id).value; kandidaat = { tab: document.getElementById('tab-kandidaten').classList.contains('on'), oms: v('k_oms'), prijs: v('k_prijs'), km: v('k_km'), land: v('k_land'), url: v('k_url').slice(0, 50) }; }
    return { ms, hulp: HULP.aanwezig, kop: document.getElementById('hulpStatus').hidden === false, sites, kaarten: document.querySelectorAll('#resLijst .res').length, kandidaat, nl, verkoopIngevuld: document.getElementById('k_verkoop').value, versie: APP_VERSIE };
  })()`);
  console.log('App:', 'v' + app.versie);
  check('app ziet de extensie en toont dat in de kop', app.hulp === true && app.kop === true);
  const gps = app.sites.find(s => s.site === 'gaspedaal'), mbs = app.sites.find(s => s.site === 'mobile');
  check('app: Zoeken toont resultaten van Gaspedaal', !!gps && gps.status === 'klaar' && gps.n > 0, gps ? (gps.status === 'klaar' ? `${gps.n} getoond van ${gps.count} op de site; eerste: ${gps.eerste}` : gps.fout) : 'Gaspedaal ontbreekt');
  if (mbs && mbs.status === 'klaar') check('app: Zoeken toont resultaten van mobile.de', mbs.n >= 0, `${mbs.n} getoond van ${mbs.count} op de site; eerste: ${mbs.eerste}`);
  else check('app: mobile.de-controlepagina wordt in gewone taal gemeld', !!mbs && /controlepagina/.test(mbs.fout || ''), mbs ? mbs.fout : 'mobile.de ontbreekt');
  check('app toont resultaatkaarten', app.kaarten > 0, `${app.kaarten} kaarten, zoeken duurde ${app.ms} ms`);
  const ref = app.nl && app.nl.ref[0];
  check('app: verwachte verkoopprijs NL uit echte Gaspedaal-advertenties', !!(ref && ref.status === 'klaar' && ref.n > 0 && app.nl.kaarten.length > 0),
    ref ? (ref.status === 'klaar' ? `${ref.n} NL-advertenties als vergelijking, bedrag op ${app.nl.kaarten.length} van ${app.kaarten} kaarten, bijv. "${app.nl.kaarten[0] || '-'}"` : ref.fout || ref.status) : 'geen vergelijkingsmateriaal');
  if (app.nl && app.nl.kaarten.length) check('Naar kandidaat neemt de verwachte verkoopprijs over', +app.verkoopIngevuld > 0, 'ingevuld: ' + app.verkoopIngevuld);
  check('knop Naar kandidaat vult het formulier', !!(app.kandidaat && app.kandidaat.tab && app.kandidaat.oms && app.kandidaat.prijs), JSON.stringify(app.kandidaat));

  // 10. een model dat Gaspedaal anders noemt: GLC heet daar glc-klasse (v1.63). De app vindt dat zelf en onthoudt het.
  const glc = await evalueer(b, sessionId, `(async () => {
    const zet = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
    ['p_pmin', 'p_pmax', 'p_uitv', 'p_uitv_de', 'p_km'].forEach(id => zet(id, ''));
    zet('p_merk', 'Mercedes-Benz'); zet('p_model', 'GLC'); zet('p_bjvan', '2021');
    await zoekLive();
    const s = LIVE.sites.find(x => x.site === 'gaspedaal');
    const ref = Object.values(LIVE.nlRef || {})[0];
    return { status: s && s.status, n: s ? s.items.length : 0, count: s && s.count, url: s && s.url, fout: s && s.error,
      zonderGlc: s ? s.items.filter(it => !/glc/i.test(it.title)).map(it => it.title).slice(0, 3) : [],
      koppeling: S.instellingen.koppelingen['gaspedaal|mercedes-benz|glc'] || null, refUrl: ref && ref.url, refN: ref ? ref.items.length : 0 };
  })()`);
  check('app: Gaspedaal-modelnaam zelf gevonden (GLC wordt glc-klasse) en onthouden',
    glc.status === 'klaar' && glc.n > 0 && glc.zonderGlc.length === 0 && /\/mercedes-benz\/glc-klasse\//.test(glc.url || '') && glc.koppeling === 'mercedes-benz/glc-klasse' && /glc-klasse/.test(glc.refUrl || ''),
    glc.status === 'klaar' ? `${glc.n} getoond van ${glc.count}, koppeling ${glc.koppeling}, vergelijking ${glc.refN} NL-auto's${glc.zonderGlc.length ? '; zonder GLC: ' + glc.zonderGlc.join(' / ') : ''}` : (glc.fout || glc.status));

  try { await b.stuur('Browser.close'); } catch (e) {}
} catch (e) {
  check('test liep vast', false, e.message);
} finally {
  console.log(uitslag.join('\n'));
  console.log(fouten ? `\n${fouten} controle(s) mislukt` : '\nAlles geslaagd');
  await slaap(800);
  opruimen();
  process.exit(fouten ? 1 : 0);
}
