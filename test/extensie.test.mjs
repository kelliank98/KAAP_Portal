// Test voor de achtergrond van de KAAP-extensie (kaap-extensie/achtergrond.js), zonder browser:
// de chrome-API is nagebootst en de klok loopt virtueel, zodat wachten geen echte tijd kost.
// De echte-browsertest staat in test/e2e-extensie.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const hier = dirname(fileURLToPath(import.meta.url));
const map = resolve(hier, '..', 'kaap-extensie');
const bron = readFileSync(resolve(map, 'achtergrond.js'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(map, 'manifest.json'), 'utf8'));

// pagina(tab, klok) geeft terug wat executeScript in dat tabblad zou lezen, of gooit een fout.
function start(pagina) {
  const tabs = new Map(); const log = { gemaakt: [], gesloten: [], maxTegelijk: 0 };
  let volgnr = 1, klok = 1_000_000, luisteraar = null;
  const chrome = {
    runtime: { id: 'kaap-ext', getManifest: () => manifest, onMessage: { addListener: (f) => { luisteraar = f; } } },
    tabs: {
      create: async (opties) => { const id = volgnr++; tabs.set(id, { id, url: opties.url, lezingen: 0, sinds: klok }); log.gemaakt.push(opties); log.maxTegelijk = Math.max(log.maxTegelijk, tabs.size); return { id }; },
      update: async () => ({}),
      get: async (id) => { if (!tabs.has(id)) throw new Error('No tab with id ' + id); return { id, status: 'complete' }; },
      remove: async (id) => { log.gesloten.push(id); tabs.delete(id); },
    },
    scripting: {
      executeScript: async (opties) => {
        assert.equal(opties.injectImmediately, true, 'leest zonder op plaatjes en advertenties te wachten');
        const tab = tabs.get(opties.target.tabId); tab.lezingen++;
        return [{ result: pagina(tab, klok) }];
      },
    },
  };
  // Virtuele klok: slapen kost geen echte tijd, maar Date.now() schuift wel mee.
  const ctx = vm.createContext({ chrome, URL, console, setTimeout: (f, ms) => { klok += ms || 0; return setTimeout(f, 0); }, Date: { now: () => klok } });
  vm.runInContext(bron, ctx);
  const stuur = (bericht, afzender = { id: 'kaap-ext' }) => new Promise((ok) => {
    const later = luisteraar(bericht, afzender, ok);
    if (later !== true) setTimeout(() => ok(undefined), 20);   // geen antwoord beloofd
  });
  return { stuur, log, tabs, nu: () => klok };
}
const vol = (html, staat = 'interactive') => ({ html, url: 'https://suchen.mobile.de/x', titel: 'Titel', staat });

describe('KAAP-extensie: manifest', () => {
  test('alleen de rechten die nodig zijn', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ['scripting']);
    assert.deepEqual(manifest.host_permissions, ['https://*.mobile.de/*', 'https://*.gaspedaal.nl/*']);
    assert.deepEqual(manifest.content_scripts[0].matches, ['https://kelliank98.github.io/KAAP_Portal/*'], 'de brug draait alleen in de app op GitHub Pages, nergens anders');
    assert.ok(!JSON.stringify(manifest).includes('<all_urls>'));
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  });
});

describe('KAAP-extensie: welke adressen', () => {
  test('alleen https op mobile.de en gaspedaal.nl; de rest wordt geweigerd zonder een tabblad te openen', async () => {
    const e = start(() => vol('<html>numResultsTotal</html>'));
    for (const url of ['https://example.com/', 'http://suchen.mobile.de/fahrzeuge/search.html', 'https://mobile.de.voorbeeld.nl/x', 'https://nietmobile.de/x', 'https://www.autoscout24.de/lst', 'javascript:alert(1)', 'geen adres', '']) {
      const r = await e.stuur({ type: 'haal', url });
      assert.equal(r.ok, false, url); assert.match(r.fout, /niet toegestaan/);
    }
    assert.equal(e.log.gemaakt.length, 0);
    for (const url of ['https://suchen.mobile.de/fahrzeuge/search.html?ms=3500', 'https://www.mobile.de/', 'https://mobile.de/', 'https://www.gaspedaal.nl/bmw/x5', 'https://api.gaspedaal.nl/redirect/vehicle/1']) {
      const r = await e.stuur({ type: 'haal', url, wachtOp: 'numResultsTotal' });
      assert.equal(r.ok, true, url);
    }
    assert.equal(e.log.gemaakt.length, 5);
    assert.ok(e.log.gemaakt.every(t => t.active === false), 'altijd op de achtergrond');
  });
  test('berichten van iets anders dan de eigen brug worden genegeerd', async () => {
    const e = start(() => vol('<html>x</html>'));
    assert.equal(await e.stuur({ type: 'haal', url: 'https://www.gaspedaal.nl/bmw' }, { id: 'andere-extensie' }), undefined);
    assert.equal(await e.stuur(null), undefined);
    assert.equal(await e.stuur({ type: 'iets-anders' }), undefined);
    assert.equal(e.log.gemaakt.length, 0);
  });
  test('ping geeft de versie terug', async () => {
    const e = start(() => vol(''));
    const r = await e.stuur({ type: 'ping' });
    assert.equal(r.ok, true); assert.equal(r.versie, manifest.version);
  });
});

describe('KAAP-extensie: pagina ophalen', () => {
  test('klaar zodra de HTML binnen is en het kenmerk erin staat; tabblad daarna gesloten', async () => {
    const e = start(() => vol('<html><script>numResultsTotal</script></html>'));
    const r = await e.stuur({ type: 'haal', url: 'https://suchen.mobile.de/fahrzeuge/search.html', wachtOp: 'numResultsTotal' });
    assert.equal(r.ok, true); assert.equal(r.gevonden, true); assert.equal(r.titel, 'Titel');
    assert.match(r.html, /numResultsTotal/);
    assert.ok(r.ms < 1000, 'geen onnodig wachten: ' + r.ms + ' ms');
    assert.deepEqual(e.log.gesloten, [1]); assert.equal(e.tabs.size, 0);
  });
  test('wacht terwijl de HTML nog binnenkomt of het kenmerk nog ontbreekt', async () => {
    const e = start((tab) => tab.lezingen <= 2 ? vol('<html>numResultsTotal half', 'loading') : tab.lezingen <= 4 ? vol('<html>tussenpagina</html>') : vol('<html>numResultsTotal</html>'));
    const r = await e.stuur({ type: 'haal', url: 'https://suchen.mobile.de/x', wachtOp: 'numResultsTotal' });
    assert.equal(r.ok, true); assert.equal(r.gevonden, true);
    assert.equal(r.html, '<html>numResultsTotal</html>', 'niet de half ingelezen pagina');
    assert.equal(e.tabs.size, 0);
  });
  test('pagina die nog niet bereikbaar is (fout bij lezen) wordt opnieuw geprobeerd', async () => {
    const e = start((tab) => { if (tab.lezingen <= 3) throw new Error('Cannot access contents of url ""'); return vol('<html>numberOfPages</html>'); });
    const r = await e.stuur({ type: 'haal', url: 'https://www.gaspedaal.nl/bmw/x5', wachtOp: 'numberOfPages' });
    assert.equal(r.ok, true); assert.equal(r.gevonden, true);
  });
  test('controlepagina die blijft staan: na ongeveer 12 seconden stoppen en eerlijk melden, niets omzeilen', async () => {
    const e = start(() => vol('<html><div id="sec-if-cpt-container"></div></html>', 'complete'));
    const r = await e.stuur({ type: 'haal', url: 'https://suchen.mobile.de/x', wachtOp: 'numResultsTotal', geefOpBij: 'sec-if-cpt-container' });
    assert.equal(r.ok, true); assert.equal(r.gevonden, false); assert.equal(r.controle, true);
    assert.ok(r.ms >= 12000 && r.ms < 14000, 'gestopt na ' + r.ms + ' ms');
    assert.equal(e.tabs.size, 0, 'tabblad gesloten');
  });
  test('controlepagina die vanzelf verdwijnt: gewoon de echte pagina', async () => {
    const e = start((tab) => tab.lezingen <= 6 ? vol('<div id="sec-if-cpt-container"></div>', 'complete') : vol('<html>numResultsTotal</html>', 'complete'));
    const r = await e.stuur({ type: 'haal', url: 'https://suchen.mobile.de/x', wachtOp: 'numResultsTotal', geefOpBij: 'sec-if-cpt-container' });
    assert.equal(r.gevonden, true); assert.equal(r.controle, undefined);
  });
  test('kenmerk komt nooit: na de wachttijd teruggeven wat er is, met gevonden:false', async () => {
    const e = start(() => vol('<html>iets anders</html>', 'complete'));
    const r = await e.stuur({ type: 'haal', url: 'https://suchen.mobile.de/x', wachtOp: 'numResultsTotal', maxMs: 6000 });
    assert.equal(r.ok, true); assert.equal(r.gevonden, false); assert.equal(r.html, '<html>iets anders</html>');
    assert.ok(r.ms >= 6000 && r.ms < 7000);
    assert.equal(e.tabs.size, 0);
  });
  test('pagina laadt helemaal niet: fout, en het tabblad is toch gesloten', async () => {
    const e = start(() => { throw new Error('Frame with ID 0 is showing error page'); });
    const r = await e.stuur({ type: 'haal', url: 'https://suchen.mobile.de/x', wachtOp: 'x', maxMs: 5000 });
    assert.equal(r.ok, false); assert.match(r.fout, /error page/);
    assert.equal(e.tabs.size, 0);
  });
  test('zonder kenmerk: klaar als de pagina volledig geladen is', async () => {
    const e = start((tab) => vol('<html>pagina</html>', tab.lezingen <= 2 ? 'interactive' : 'complete'));
    const r = await e.stuur({ type: 'haal', url: 'https://www.gaspedaal.nl/bmw' });
    assert.equal(r.ok, true); assert.equal(r.gevonden, true);
  });
  test('de wachttijd is begrensd, wat de app ook vraagt', async () => {
    const e = start(() => vol('<html>x</html>', 'complete'));
    const r = await e.stuur({ type: 'haal', url: 'https://suchen.mobile.de/x', wachtOp: 'komt-nooit', maxMs: 999999 });
    assert.ok(r.ms <= 46000, 'hoogstens 45 seconden: ' + r.ms);
  });
  test('nooit meer dan drie achtergrondtabbladen tegelijk', async () => {
    const e = start((tab) => tab.lezingen <= 3 ? vol('', 'loading') : vol('<html>numberOfPages</html>'));
    const antwoorden = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(n => e.stuur({ type: 'haal', url: 'https://www.gaspedaal.nl/bmw/' + n, wachtOp: 'numberOfPages' })));
    assert.ok(antwoorden.every(r => r.ok && r.gevonden));
    assert.equal(e.log.gemaakt.length, 7);
    assert.ok(e.log.maxTegelijk <= 3, 'maximaal tegelijk open: ' + e.log.maxTegelijk);
    assert.equal(e.tabs.size, 0);
  });
});
