// Test voor de achtergrond van de KAAP-extensie (kaap-extensie/achtergrond.js), zonder browser:
// de chrome-API is nagebootst en de klok loopt virtueel, zodat wachten geen echte tijd kost.
// De echte-browsertest staat in test/e2e-extensie.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const hier = dirname(fileURLToPath(import.meta.url));
const map = resolve(hier, '..', 'kaap-extensie');
const bron = readFileSync(resolve(map, 'achtergrond.js'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(map, 'manifest.json'), 'utf8'));
const atxBron = readFileSync(resolve(map, 'autotelex.js'), 'utf8');
const fixture = (naam) => readFileSync(resolve(hier, 'fixtures', naam), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));   // objecten uit de vm hebben een eigen Object-prototype

// pagina(tab, klok) geeft terug wat executeScript in dat tabblad zou lezen, of gooit een fout.
function start(pagina) {
  const tabs = new Map(); const log = { gemaakt: [], gesloten: [], maxTegelijk: 0, verzonden: [] }; const sessie = {}; let appDicht = false;
  let volgnr = 1, klok = 1_000_000, luisteraar = null;
  const chrome = {
    runtime: { id: 'kaap-ext', getManifest: () => manifest, onMessage: { addListener: (f) => { luisteraar = f; } } },
    tabs: {
      create: async (opties) => { const id = volgnr++; tabs.set(id, { id, url: opties.url, lezingen: 0, sinds: klok }); log.gemaakt.push(opties); log.maxTegelijk = Math.max(log.maxTegelijk, tabs.size); return { id }; },
      update: async () => ({}),
      get: async (id) => { if (!tabs.has(id)) throw new Error('No tab with id ' + id); return { id, status: 'complete' }; },
      remove: async (id) => { log.gesloten.push(id); tabs.delete(id); },
      sendMessage: async (tabId, msg) => { if (appDicht) throw new Error('Could not establish connection. Receiving end does not exist.'); log.verzonden.push({ tabId, msg }); },
    },
    storage: { session: { get: async (k) => ({ [k]: sessie[k] }), set: async (o) => { Object.assign(sessie, o); } } },
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
  return { stuur, log, tabs, sessie, nu: () => klok, verder: (ms) => { klok += ms; }, appDicht: () => { appDicht = true; } };
}
const vol = (html, staat = 'interactive') => ({ html, url: 'https://suchen.mobile.de/x', titel: 'Titel', staat });

describe('KAAP-extensie: manifest', () => {
  test('alleen de rechten die nodig zijn', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ['scripting', 'storage'], 'storage: de lopende Autotelex-aanvraag overleeft een herstart van de service worker');
    assert.deepEqual(manifest.host_permissions, ['https://*.mobile.de/*', 'https://*.gaspedaal.nl/*'], 'op de achtergrond opent hij alleen mobile.de en Gaspedaal');
    assert.equal(manifest.content_scripts.length, 2);
    assert.deepEqual(manifest.content_scripts[0].matches, ['https://kelliank98.github.io/KAAP_Portal/*'], 'de brug draait alleen in de app op GitHub Pages, nergens anders');
    assert.deepEqual(manifest.content_scripts[1].matches, ['https://www.autotelexpro.nl/*']);
    assert.deepEqual(manifest.content_scripts[1].js, ['autotelex.js']);
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

describe('KAAP-extensie: BPM uit AutotelexPRO (1.1.0)', () => {
  const vanApp = { id: 'kaap-ext', tab: { id: 7 } };
  const vanAtx = { id: 'kaap-ext', url: 'https://www.autotelexpro.nl/Vehicle/Vehicle_Details.aspx', tab: { id: 9, url: 'https://www.autotelexpro.nl/Vehicle/Vehicle_Details.aspx' } };
  const g = { bedrag: 20291, basis: 'afschrijvingstabel', afschrijvingstabel: 20291, koerslijst: 22808, taxatierapport: null, uitvoering: 'BMW X6 - M50i High Executive', toelating: '13-06-2022' };

  test('de app vraagt erom: AutotelexPRO opent in een gewoon tabblad en de aanvraag wordt onthouden', async () => {
    const e = start(() => vol(''));
    const r = await e.stuur({ type: 'atx-start', id: 'a1' }, vanApp);
    assert.equal(r.ok, true);
    assert.deepEqual(plain(e.log.gemaakt.at(-1)), { url: 'https://www.autotelexpro.nl/Default.aspx', active: true });
    assert.equal(e.sessie.atx.id, 'a1'); assert.equal(e.sessie.atx.appTab, 7);
    assert.equal(await e.stuur({ type: 'atx-start', id: 'a2' }, { id: 'kaap-ext' }), undefined, 'zonder tabblad van de app: niets');
  });
  test('het bedrag gaat naar het tabblad van de app dat erom vroeg', async () => {
    const e = start(() => vol(''));
    await e.stuur({ type: 'atx-start', id: 'a1' }, vanApp);
    const r = await e.stuur({ type: 'atx-bpm', gegevens: g }, vanAtx);
    assert.equal(r.overgenomen, true);
    assert.deepEqual(plain(e.log.verzonden), [{ tabId: 7, msg: { type: 'atx-bpm', id: 'a1', gegevens: g } }]);
  });
  test('geen aanvraag, een aanvraag van meer dan een half uur oud, of de app is dicht: niets overgenomen', async () => {
    const e = start(() => vol(''));
    assert.equal((await e.stuur({ type: 'atx-bpm', gegevens: g }, vanAtx)).overgenomen, false, 'zonder aanvraag');
    await e.stuur({ type: 'atx-start', id: 'a1' }, vanApp);
    e.verder(31 * 60 * 1000);
    assert.equal((await e.stuur({ type: 'atx-bpm', gegevens: g }, vanAtx)).overgenomen, false, 'te oud');
    await e.stuur({ type: 'atx-start', id: 'a2' }, vanApp);
    e.appDicht();
    const r = await e.stuur({ type: 'atx-bpm', gegevens: g }, vanAtx);
    assert.equal(r.overgenomen, false); assert.match(r.fout, /tabblad van de app is dicht/);
    assert.equal(e.log.verzonden.length, 0);
  });
  test('alleen van AutotelexPRO en alleen met een geldig bedrag', async () => {
    const e = start(() => vol(''));
    await e.stuur({ type: 'atx-start', id: 'a1' }, vanApp);
    assert.equal(await e.stuur({ type: 'atx-bpm', gegevens: g }, { id: 'kaap-ext', url: 'https://example.com/Vehicle/Vehicle_Details.aspx' }), undefined);
    assert.equal(await e.stuur({ type: 'atx-bpm', gegevens: { bedrag: '20291' } }, vanAtx), undefined);
    assert.equal(await e.stuur({ type: 'atx-bpm', gegevens: g }, { id: 'andere-extensie', url: vanAtx.url }), undefined);
    assert.equal(e.log.verzonden.length, 0);
  });
});

describe('KAAP-extensie: lezen op de voertuigpagina van AutotelexPRO (autotelex.js)', () => {
  const tik = (ms = 15) => new Promise(r => setTimeout(r, ms));
  function draai(html, url = 'https://www.autotelexpro.nl/Vehicle/Vehicle_Details.aspx', antwoord = { ok: true, overgenomen: true }) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    const w = dom.window; const verzonden = [];
    w.chrome = { runtime: { sendMessage: (m) => { verzonden.push(m); return Promise.resolve(antwoord); } } };
    w.eval(atxBron);
    return { w, verzonden };
  }
  test('leest de Rest-BPM-bedragen, de uitvoering en de eerste toelating; het voordeligste volgens Autotelex gaat mee', async () => {
    const { w, verzonden } = draai(fixture('autotelex-bpm.html'));
    assert.equal(verzonden.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(verzonden[0])), { type: 'atx-bpm', gegevens: { bedrag: 20291, basis: 'afschrijvingstabel', afschrijvingstabel: 20291, koerslijst: 22808, taxatierapport: null, uitvoering: 'BMW X6 - M50i High Executive', toelating: '13-06-2022' } });
    await tik();
    assert.match(w.document.getElementById('kaap-atx-melding').textContent, /Overgenomen in de KAAP Inkoop Radar: € 20\.291 \(afschrijvingstabel\)/);
  });
  test('alleen op de voertuigpagina, en geen melding als de app er niet om vroeg', async () => {
    assert.equal(draai(fixture('autotelex-bpm.html'), 'https://www.autotelexpro.nl/Default.aspx').verzonden.length, 0);
    const { w } = draai(fixture('autotelex-bpm.html'), undefined, { ok: true, overgenomen: false });
    await tik();
    assert.equal(w.document.getElementById('kaap-atx-melding'), null);
  });
  test('onbekende code bij "voordeligste": het laagste bedrag', () => {
    const html = fixture('autotelex-bpm.html').replace('value="C"', 'value="?"').replace('€ 22808', '€ 18900');
    const { verzonden } = draai(html);
    assert.equal(verzonden[0].gegevens.bedrag, 18900); assert.equal(verzonden[0].gegevens.basis, 'koerslijst');
  });
  test('dezelfde berekening één keer doorgeven; een nieuwe berekening opnieuw', async () => {
    const { w, verzonden } = draai(fixture('autotelex-bpm.html'));
    w.document.body.appendChild(w.document.createElement('p'));
    await tik(500);
    assert.equal(verzonden.length, 1, 'zelfde bedragen: niet opnieuw');
    w.document.getElementById('ctl00_cp_ucVD_tcVehicleDetails_tpnlIE_ucVD_IE_lblBPMPartitionTable').textContent = '€ 19500';
    await tik(500);
    assert.equal(verzonden.length, 2); assert.equal(verzonden[1].gegevens.bedrag, 19500);
  });
  test('zonder bedragen op de pagina: niets', () => {
    const html = fixture('autotelex-bpm.html').replace('€ 20291', '-').replace('€ 22808', '-');
    assert.equal(draai(html).verzonden.length, 0);
  });
});

describe('KAAP-extensie: zoekvelden van AutotelexPRO invullen (1.2.0)', () => {
  const P = 'ctl00_cp_ucSearch_Manual_';
  const MERKEN = [['840', 'Aiways'], ['96', 'Audi'], ['98', 'BMW'], ['168', 'Land Rover'], ['122', 'Mercedes-Benz'], ['304', 'MINI'], ['211', 'Volkswagen']];
  const MODELLEN = {
    98: [['1756', '1-serie'], ['2615', '2-serie Active Tourer'], ['49', '3-serie'], ['1555', '3-serie Touring'], ['50', '5-serie'], ['1556', '5-serie Touring'], ['2232', 'X1'], ['1528', 'X3'], ['869', 'X5'], ['1976', 'X6'], ['3193', 'X7']],
    122: [['10', 'A-klasse'], ['11', 'C-klasse'], ['12', 'E-klasse'], ['13', 'GLC-klasse'], ['14', 'GLC Coupé'], ['15', 'GLE-klasse']],
  };
  const BRANDSTOF = [['0', 'Benzine'], ['2', 'Diesel'], ['8', 'Hybride Benzine'], ['52', 'Electrisch']];
  const tik = (ms) => new Promise(r => setTimeout(r, ms));
  // Doet zich voor als de site: na het bouwjaar komen de merken, na het merk brandstof, transmissie en modellen,
  // en zoals bij een gedeeltelijke postback worden de keuzelijsten daarbij vervangen door nieuwe elementen.
  function draaiStart(voertuig, { vertraging = 60, oudMerk = null } = {}) {
    const dom = new JSDOM(fixture('autotelex-start.html'), { url: 'https://www.autotelexpro.nl/Default.aspx', runScripts: 'outside-only' });
    const w = dom.window, doc = w.document, berichten = [];
    const vervang = (naam, lijst) => {
      const oud = doc.getElementById(P + naam), nieuw = doc.createElement('select');
      nieuw.id = P + naam;
      nieuw.innerHTML = oud.options[0].outerHTML + lijst.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
      oud.replaceWith(nieuw);
    };
    doc.addEventListener('change', (e) => {
      const id = e.target.id;
      if (id === P + 'ddlBouwjaar') setTimeout(() => vervang('ddlMerk', MERKEN), vertraging);
      if (id === P + 'ddlMerk') {
        const merk = e.target.value;
        setTimeout(() => { vervang('ddlMerk', MERKEN); doc.getElementById(P + 'ddlMerk').value = merk; vervang('ddlBrandstof', BRANDSTOF); vervang('ddlTransmissie', [['0', 'Handmatig'], ['1', 'Automaat']]); vervang('ddlModel', MODELLEN[merk] || []); }, vertraging);
      }
    });
    // Pagina die nog de lijsten van een eerder gekozen merk toont (bijvoorbeeld na terug in de browser).
    if (oudMerk) { vervang('ddlMerk', MERKEN); doc.getElementById(P + 'ddlMerk').value = oudMerk; vervang('ddlBrandstof', BRANDSTOF); vervang('ddlTransmissie', [['0', 'Handmatig'], ['1', 'Automaat']]); vervang('ddlModel', MODELLEN[oudMerk]); }
    w.chrome = { runtime: { sendMessage: (m) => { berichten.push(m); return Promise.resolve(m.type === 'atx-vraag' ? (voertuig ? { ok: true, voertuig } : { ok: true }) : { ok: true }); } } };
    w.eval(atxBron);
    const waarde = (naam) => doc.getElementById(P + naam).value;
    const melding = () => (doc.getElementById('kaap-atx-invul') || {}).textContent || '';
    return { w, doc, berichten, waarde, melding };
  }
  const klaar = async (r) => { for (let i = 0; i < 60 && !r.melding(); i++) await tik(100); };

  test('BMW X6 uit de omschrijving: datum, merk, brandstof, automaat en model ingevuld; zoeken doet de gebruiker', async () => {
    const r = draaiStart({ dag: 13, maand: 6, jaar: 2022, merk: '', model: '', oms: 'BMW X6 M50i High Executive', brandstof: 'benzine' });
    await klaar(r);
    assert.deepEqual(['ddlVoertuigType', 'ddlBouwdag', 'ddlBouwmaand', 'ddlBouwjaar', 'ddlMerk', 'ddlBrandstof', 'ddlTransmissie', 'ddlModel'].map(r.waarde), ['1', '13', '6', '2022', '98', '0', '1', '1976']);
    assert.deepEqual(r.berichten.map(b => b.type), ['atx-vraag', 'atx-ingevuld'], 'maar één keer invullen');
    assert.match(r.melding(), /KAAP: 13-06-2022, BMW, Benzine, Automaat, X6 ingevuld\. Klik op Zoeken en kies de uitvoering\./);
    assert.equal(r.doc.activeElement.id, 'btnHandmatigZoeken', 'de knop Zoeken heeft de focus; geklikt wordt er niet');
  });
  test('BMW 330 e Touring hybride: 3-serie Touring en Hybride Benzine', async () => {
    const r = draaiStart({ dag: 1, maand: 3, jaar: 2021, oms: 'BMW 330 e Touring M Sport', brandstof: 'hybride' });
    await klaar(r);
    assert.equal(r.waarde('ddlModel'), '1555'); assert.equal(r.waarde('ddlBrandstof'), '8');
  });
  test('Mercedes: GLC Coupé alleen als Coupé in de titel staat, en "Mercedes" zonder Benz wordt herkend', async () => {
    const coupe = draaiStart({ dag: 5, maand: 9, jaar: 2022, oms: 'Mercedes-Benz GLC 300 de 4MATIC Coupé AMG', brandstof: 'hybride_diesel' });
    await klaar(coupe);
    assert.equal(coupe.waarde('ddlMerk'), '122'); assert.equal(coupe.waarde('ddlModel'), '14');
    assert.match(coupe.melding(), /Niet gevonden: brandstof/, 'Hybride Diesel staat niet in de lijst: de gebruiker kiest zelf');
    const gewoon = draaiStart({ dag: 5, maand: 9, jaar: 2022, oms: 'Mercedes GLC 300 de 4MATIC', brandstof: 'diesel' });
    await klaar(gewoon);
    assert.equal(gewoon.waarde('ddlMerk'), '122'); assert.equal(gewoon.waarde('ddlModel'), '13'); assert.equal(gewoon.waarde('ddlBrandstof'), '2');
  });
  test('model en merk uit het zoekprofiel gaan voor de omschrijving', async () => {
    const r = draaiStart({ dag: 13, maand: 6, jaar: 2022, merk: 'BMW', model: 'X5', oms: 'Prachtige SUV, vol opties', brandstof: 'hybride' });
    await klaar(r);
    assert.equal(r.waarde('ddlMerk'), '98'); assert.equal(r.waarde('ddlModel'), '869');
  });
  test('model onbekend of geen eerste toelating: invullen wat kan en zeggen wat ontbreekt', async () => {
    const onbekend = draaiStart({ dag: 13, maand: 6, jaar: 2022, oms: 'BMW Z8 Roadster', brandstof: 'benzine' });
    await klaar(onbekend);
    assert.equal(onbekend.waarde('ddlModel'), '-1'); assert.match(onbekend.melding(), /Niet gevonden: model; kies dat zelf/);
    const zonderDatum = draaiStart({ dag: null, maand: null, jaar: null, oms: 'BMW X5', brandstof: 'diesel' });
    await klaar(zonderDatum);
    assert.match(zonderDatum.melding(), /geen eerste toelating/); assert.equal(zonderDatum.waarde('ddlBouwjaar'), '-1');
  });
  test('oude lijsten van een eerder merk op de pagina: wachten op de nieuwe lijsten van de site', async () => {
    const r = draaiStart({ dag: 13, maand: 6, jaar: 2022, oms: 'BMW X6 M50i', brandstof: 'benzine' }, { vertraging: 700, oudMerk: '122' });
    await klaar(r);
    assert.equal(r.waarde('ddlMerk'), '98'); assert.equal(r.waarde('ddlModel'), '1976');
    assert.doesNotMatch(r.melding(), /Niet gevonden/);
  });
  test('zonder aanvraag van de app: niets invullen', async () => {
    const r = draaiStart(null);
    await tik(300);
    assert.equal(r.waarde('ddlBouwjaar'), '-1'); assert.equal(r.melding(), '');
    assert.deepEqual(r.berichten.map(b => b.type), ['atx-vraag']);
  });
});

describe('KAAP-extensie: achtergrond geeft de zoekgegevens één keer en kort na de klik (1.2.0)', () => {
  const vanApp = { id: 'kaap-ext', tab: { id: 7 } };
  const vanAtx = { id: 'kaap-ext', url: 'https://www.autotelexpro.nl/Default.aspx', tab: { id: 9 } };
  const voertuig = { dag: 13, maand: 6, jaar: 2022, merk: '', model: '', oms: 'BMW X6 M50i', brandstof: 'benzine' };
  test('vraag na de klik: de gegevens; na "ingevuld" of na drie minuten niet meer', async () => {
    const e = start(() => vol(''));
    await e.stuur({ type: 'atx-start', id: 'a1', voertuig }, vanApp);
    assert.deepEqual(plain((await e.stuur({ type: 'atx-vraag' }, vanAtx)).voertuig), voertuig);
    await e.stuur({ type: 'atx-ingevuld' }, vanAtx);
    assert.equal((await e.stuur({ type: 'atx-vraag' }, vanAtx)).voertuig, undefined, 'één keer invullen');
    await e.stuur({ type: 'atx-start', id: 'a2', voertuig }, vanApp);
    e.verder(4 * 60 * 1000);
    assert.equal((await e.stuur({ type: 'atx-vraag' }, vanAtx)).voertuig, undefined, 'te lang na de klik');
    assert.equal(await e.stuur({ type: 'atx-vraag' }, { id: 'kaap-ext', url: 'https://example.com/' }), undefined, 'alleen van AutotelexPRO');
  });
  test('zonder voertuiggegevens (oude app): geen invullen, het bedrag komt wel door', async () => {
    const e = start(() => vol(''));
    await e.stuur({ type: 'atx-start', id: 'a1' }, vanApp);
    assert.equal((await e.stuur({ type: 'atx-vraag' }, vanAtx)).voertuig, undefined);
    assert.equal((await e.stuur({ type: 'atx-bpm', gegevens: { bedrag: 1 } }, { ...vanAtx, url: 'https://www.autotelexpro.nl/Vehicle/Vehicle_Details.aspx' })).overgenomen, true);
  });
});

