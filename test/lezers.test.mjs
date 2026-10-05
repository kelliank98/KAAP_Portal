// Test voor de leescode van zoek- en advertentiepagina's, de brug naar de KAAP-extensie,
// de knop Naar kandidaat, de vervallen bladwijzers en het bijwerken tussen tabbladen.
//
// De testgevallen in test/fixtures/ zijn ingekorte kopieën van echte pagina's, opgehaald op
// 03-10-2026 (via de proxy, of via de extensie in een echte browser). Alleen mobile-zoek.html is
// met de hand opgebouwd naar de live gemeten opbouw, omdat één echte kaart daar al 55 kB is;
// die lezer is daarnaast op de live pagina zelf gecontroleerd.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const hier = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.INKOOP_HTML || resolve(hier, '..', 'inkoop.html'), 'utf8');
const fixture = (naam) => readFileSync(resolve(hier, 'fixtures', naam), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));
const tik = (ms = 15) => new Promise(r => setTimeout(r, ms));
// Wacht tot de nagebootste extensie zich bij de app heeft gemeld. Berichten tussen vensters zijn
// asynchroon; met een vaste wachttijd faalde dit af en toe als de hele testreeks tegelijk draaide.
async function wachtOpHulp(w, maxMs = 2000) {
  for (const begin = Date.now(); Date.now() - begin < maxMs; await tik(5)) if (w.eval('HULP.aanwezig')) return;
  throw new Error('de nagebootste extensie meldde zich niet bij de app');
}
const SLEUTEL = 'kaap_inkoop_v1';
const vensters = [];
after(() => vensters.forEach(w => { try { w.close(); } catch (e) {} }));

function laadApp(opties = {}) {
  const fouten = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => fouten.push(e));
  const dom = new JSDOM(html, {
    url: opties.url || 'https://kaap.test/inkoop.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.scrollTo = () => {}; win.HTMLElement.prototype.scrollIntoView = function () {};
      win.fetch = opties.fetch || (() => Promise.reject(new Error('geen netwerk in test')));
      if (opties.opslag) win.localStorage.setItem(SLEUTEL, opties.opslag);
    },
  });
  const w = dom.window; vensters.push(w);
  assert.equal(fouten.length, 0, 'script laadt zonder fouten: ' + fouten.map(e => e.message).join('; '));
  return { w, d: w.document, G: (naam) => w.eval(naam) };
}
const zet = (w, id, v, soort = 'input') => { const e = w.document.getElementById(id); e.value = v; e.dispatchEvent(new w.Event(soort, { bubbles: true })); };
const veld = (w, id) => w.document.getElementById(id).value;

// Doet zich voor als de extensie: beantwoordt hulp-ping en hulp-haal zoals brug.js dat doet.
function nepExtensie(w, pagina) {
  const verzoeken = [];
  w.addEventListener('message', (e) => {
    const d = e.data; if (!d || typeof d !== 'object') return;
    if (d.kaap === 'hulp-ping') w.postMessage({ kaap: 'hulp-aanwezig', versie: '1.0.0' }, '*');
    if (d.kaap === 'hulp-haal') {
      verzoeken.push(d);
      let antw;
      try { antw = { kaap: 'hulp-antwoord', id: d.id, ok: true, html: pagina(d.url), url: d.url, gevonden: true, ms: 3 }; }
      catch (err) { antw = { kaap: 'hulp-antwoord', id: d.id, ok: false, fout: err.message }; }
      w.postMessage(antw, '*');
    }
  });
  return verzoeken;
}
// Pagina's zoals de extensie ze zou teruggeven. Een zoekpagina op modelnummer 49 toont alleen X5's.
const alleenX5 = () => fixture('mobile-zoek.html').replaceAll('BMW 330', 'BMW X5').replaceAll('BMW X6', 'BMW X5');
function paginas(url) {
  if (/gaspedaal\.nl/.test(url)) return fixture('gaspedaal-zoek.html');
  if (/mobile\.de\/fahrzeuge\/search/.test(url)) return /ms=3500%3B49%3B/.test(url) ? alleenX5() : fixture('mobile-zoek.html');
  if (/mobile\.de\/fahrzeuge\/details/.test(url)) return fixture('mobile-advertentie.html');
  throw new Error('onbekend adres in de test: ' + url);
}
// Doet zich voor als de proxy: geeft per site het testgeval terug. De RDW is in de test onbereikbaar.
function nepProxy(aanvragen) {
  return (adres) => {
    const doel = new URL(String(adres)).searchParams.get('url');
    if (!doel) return Promise.reject(new Error('geen netwerk in test: ' + String(adres).slice(0, 60)));
    if (aanvragen) aanvragen.push(doel);
    const naam = /autoscout24\.de\/smyle/.test(doel) ? 'as24-smyle-advertentie.html'
      : /autoscout24\.de/.test(doel) ? 'as24-de-advertentie.html'
      : /autoscout24\.nl/.test(doel) ? 'as24-nl-advertentie.html'
      : /autoscout24\.be/.test(doel) ? 'as24-be-advertentie.html'
      : /marktplaats\.nl/.test(doel) ? 'marktplaats-advertentie.html'
      : /2dehands\.be|2ememain\.be/.test(doel) ? '2dehands-advertentie.html'
      : /kleinanzeigen\.de/.test(doel) ? 'kleinanzeigen-advertentie.html' : null;
    if (!naam) return Promise.resolve({ ok: false, status: 404, text: async () => '' });
    return Promise.resolve({ ok: true, status: 200, text: async () => fixture(naam) });
  };
}

// ---------------------------------------------------------------- opbouw
describe('Opbouw van het bestand', () => {
  test('het script wordt nergens voortijdig afgesloten (precies één afsluitende script-tag)', () => {
    assert.equal((html.match(/<\/script>/gi) || []).length, 1);
  });
});

// ---------------------------------------------------------------- zoekpagina's
describe('Leescode zoekpagina mobile.de', () => {
  const { w } = laadApp();
  const r = w.parseerMobileZoek(fixture('mobile-zoek.html'));

  test('aantal uit de paginadata, niet uit geraden tekst', () => {
    assert.equal(r.count, 1231);
    assert.equal(r.items.length, 4);
  });
  test('gesponsorde nieuwe auto: prijs, vermogen, CO2 en BTW, zonder eerste toelating', () => {
    assert.deepEqual(plain(r.items[0]), {
      id: '400000001', title: 'BMW 330 d xDrive Touring M Sportpaket Pro Head-Up Pan', price: 65100, km: 0, ez: null,
      fuel: 'diesel', co2: 159, kw: 210, transmission: 'Automatik',
      img: 'https://img.classistatic.de/api/v1/mo-prod/images/aa/aa000000-0000-0000-0000-000000000001?rule=mo-1600',
      seller: 'Autohaus Voorbeeld GmbH Vertragshändler der BMW Group', city: 'Hösbach', geplaatst: '8.1.2026', btw: true,
      url: 'https://suchen.mobile.de/fahrzeuge/details.html?id=400000001',
    });
  });
  test('gebruikte plug-in hybride: eerste toelating, kilometerstand en verkoper', () => {
    const it = r.items[1];
    assert.equal(it.title, 'BMW X5 xDrive50e M Sportpaket Pro*22 Zoll*Komfortsit');
    assert.equal(it.price, 83940); assert.equal(it.ez, '2026-02'); assert.equal(it.km, 16944);
    assert.equal(it.fuel, 'hybride'); assert.equal(it.kw, 360); assert.equal(it.co2, null);
    assert.equal(it.seller, 'BMW Autohaus Muster GmbH & Co. KG'); assert.equal(it.city, 'Bamberg');
    assert.equal(it.geplaatst, '3.10.2026'); assert.equal(it.btw, true);
  });
  test('particulier zonder voetnoot bij de prijs telt als marge', () => {
    const it = r.items[3];
    assert.equal(it.btw, false); assert.equal(it.seller, 'Privatanbieter'); assert.equal(it.transmission, 'Schaltgetriebe');
  });
  test('modelnummer uit de modellijst, niet uit een andere keuzelijst', () => {
    assert.equal(r.modelId('X5'), '49');
    assert.equal(r.modelId(' x5 m '), '53');
    assert.equal(r.modelId('m5'), '46', 'ook uit een andere reeks');
    assert.equal(r.modelId('X-Reihe (Alle)'), null, 'een hele reeks heeft geen modelnummer');
    assert.equal(r.modelId('500'), null, 'de prijsoptie "500 €" is geen model');
    assert.equal(r.modelId('Bestaat Niet'), null);
    assert.equal(r.modelId(''), null);
  });
  test('zonder kaarten leest hij de advertenties uit de paginadata', () => {
    const zonder = fixture('mobile-zoek.html').replace(/<main>[\s\S]*<\/main>/, '<main></main>');
    const r2 = w.parseerMobileZoek(zonder);
    assert.equal(r2.items.length, 4);
    assert.equal(r2.items[1].title, 'BMW X5'); assert.equal(r2.items[1].price, 83940); assert.equal(r2.items[1].btw, null);
  });
  test('zonder paginadata leest hij de kaarten en de teller uit de kop', () => {
    const zonder = fixture('mobile-zoek.html').replace(/<script>self\.__next_f[\s\S]*?<\/script>/g, '');
    const r2 = w.parseerMobileZoek(zonder);
    assert.equal(r2.count, 1231);
    assert.equal(r2.items[2].price, 61750); assert.equal(r2.items[2].km, 56900); assert.equal(r2.items[2].ez, '2023-05'); assert.equal(r2.items[2].fuel, 'diesel'); assert.equal(r2.items[2].kw, 210);
  });
  test('weinig treffers: de vergelijkbare auto\'s waarmee mobile.de de pagina aanvult tellen niet mee', () => {
    const r2 = w.parseerMobileZoek(fixture('mobile-zoek-weinig.html'));
    assert.equal(r2.count, 1);
    assert.deepEqual(plain(r2.items.map(i => i.id)), ['400000011'], 'de vier kaarten onder "Ähnliche Fahrzeuge" doen niet mee');
    assert.equal(r2.items[0].title, 'BMW X5 xDrive45e -SUV M Sport'); assert.equal(r2.items[0].price, 29900);
    assert.equal(r2.items[0].km, 148000); assert.equal(r2.items[0].ez, '2022-03'); assert.equal(r2.items[0].btw, true);
    // ook als de paginadata ontbreekt blijven die kaarten buiten beeld
    const zonder = fixture('mobile-zoek-weinig.html').replace(/<script>self\.__next_f[\s\S]*?<\/script>/g, '');
    assert.deepEqual(plain(w.parseerMobileZoek(zonder).items.map(i => i.id)), ['400000011']);
  });
  test('geen treffers: nul resultaten, ook al toont de pagina andere auto\'s', () => {
    const r2 = w.parseerMobileZoek(fixture('mobile-zoek-nul.html'));
    assert.equal(r2.count, 0); assert.equal(r2.items.length, 0);
    assert.equal(r2.modelId('X5'), '49');
  });
  test('controlepagina van de beveiliging: duidelijke melding in plaats van nul resultaten', () => {
    assert.throws(() => w.parseerMobileZoek(fixture('mobile-controle.html')), /controlepagina/);
  });
  test('onherkenbare pagina: melding dat de opbouw is gewijzigd', () => {
    assert.throws(() => w.parseerMobileZoek('<html><body><p>iets heel anders</p></body></html>'), /pagina-opbouw is gewijzigd/);
  });
});

describe('Leescode zoekpagina Kleinanzeigen (nieuwe opbouw van 03-10-2026)', () => {
  const { w } = laadApp();
  test('aantal en advertenties; de TOP-advertentie die twee keer in de pagina staat telt één keer', () => {
    const r = w.parseerKleinanzeigen(fixture('kleinanzeigen-zoek.html'));
    assert.equal(r.count, 30);
    assert.deepEqual(plain(r.items.map(i => i.id)), ['3000000001', '3000000002', '3000000003']);
    assert.deepEqual(plain(r.items[0]), {
      id: '3000000001', title: 'BMW X5 xDrive45e M Sport | Vollausstattung | 8-fach bereift', price: 51000, km: 59000, ez: '2022-09',
      fuel: 'hybride', co2: null, img: 'https://img.kleinanzeigen.de/api/v1/prod-ads/images/aa/aa000000-0000-0000-0000-000000000001?rule=$_59.AUTO',
      seller: null, btw: null, geplaatst: null, city: '21465 Reinbek',
      url: 'https://www.kleinanzeigen.de/s-anzeige/bmw-x5-xdrive45e-m-sport-vollausstattung-8-fach-bereift/3000000001-216-1234',
    });
    assert.equal(r.items[1].geplaatst, 'Heute'); assert.equal(r.items[1].city, '89420 Höchstädt a.d. Donau');
    assert.equal(r.items[1].price, 82990); assert.equal(r.items[1].ez, '2025-10');
    assert.equal(r.items[2].title, 'BMW X5 50e M SPORT PRO.KOMFORT.S.LÜFTUNG.H/K.AHK.22"');
  });
  test('de prijs komt uit het prijsveld, niet uit een bedrag in de titel of omschrijving', () => {
    const metBedrag = fixture('kleinanzeigen-zoek.html')
      .replace('<p>Beschreibung für den Test gekürzt.</p><div><p>82.990 €</p>', '<p>Neupreis 117.000 € laut Liste, jetzt günstig.</p><div><p>82.990 € VB</p>')
      .replace('<p>Beschreibung für den Test gekürzt.</p><div><p>82.890 €</p>', '<p>UPE 131.500 €, Preis auf Anfrage.</p><div><p> VB</p>');
    const r = w.parseerKleinanzeigen(metBedrag);
    assert.equal(r.items[1].price, 82990, 'niet de nieuwprijs uit de omschrijving');
    assert.equal(r.items[2].price, null, 'alleen VB in het prijsveld: geen prijs, ook al noemt de omschrijving een bedrag');
    assert.equal(r.items[0].price, 51000);
  });
  test('geen treffers is nul resultaten en geen fout', () => {
    const r = w.parseerKleinanzeigen(fixture('kleinanzeigen-zoek-nul.html'));
    assert.equal(r.count, 0); assert.equal(r.items.length, 0);
  });
  test('pagina zonder advertenties, teller of "niets gevonden" blijft een fout', () => {
    assert.throws(() => w.parseerKleinanzeigen('<html><body><h1>Bitte bestätige, dass du kein Roboter bist</h1></body></html>'), /pagina-opbouw gewijzigd of geblokkeerd/);
  });
  test('de oude opbouw wordt nog steeds gelezen', () => {
    const oud = '<html><body><h1>1 - 25 von 1.234 Ergebnisse</h1><ul><li class="ad-listitem"><article class="aditem" data-adid="111" data-href="/s-anzeige/bmw-x5/111-216-1">'
      + '<div class="aditem-main--top--left"> 12345 Berlin </div><a class="ellipsis" href="/s-anzeige/bmw-x5/111-216-1">BMW X5 xDrive30d M Sport</a>'
      + '<p class="aditem-main--middle--price-shipping--price">45.000 € VB</p><span>120.000 km</span><span>EZ 03/2020</span></article></li></ul></body></html>';
    const r = w.parseerKleinanzeigen(oud);
    assert.equal(r.count, 1234); assert.equal(r.items.length, 1);
    assert.equal(r.items[0].title, 'BMW X5 xDrive30d M Sport'); assert.equal(r.items[0].price, 45000); assert.equal(r.items[0].km, 120000); assert.equal(r.items[0].ez, '2020-03');
  });
  test('zoeken in de app: nul treffers op Kleinanzeigen is "Geen resultaten" en geen rode fout', async () => {
    const { w: w2, d, G } = laadApp({ fetch: (adres) => {
      const doel = new URL(String(adres)).searchParams.get('url') || '';
      if (!/kleinanzeigen\.de\/s-autos/.test(doel)) return Promise.reject(new Error('onverwacht adres in de test: ' + doel));
      return Promise.resolve({ ok: true, status: 200, text: async () => fixture('kleinanzeigen-zoek-nul.html') });
    } });
    w2.eval("S.instellingen.proxy = 'https://proxy.test/'");
    zet(w2, 'p_merk', 'BMW'); zet(w2, 'p_model', 'X5');
    d.querySelectorAll('#p_sites input').forEach(i => { if (i.checked !== (i.value === 'kleinanzeigen')) i.click(); });
    await w2.zoekLive();
    const sites = G('LIVE').sites;
    assert.deepEqual(plain(sites.map(x => [x.site, x.status, x.items.length, x.count])), [['kleinanzeigen', 'klaar', 0, 0]]);
    assert.match(d.querySelector('#resLijst').textContent, /Geen resultaten/);
    assert.doesNotMatch(d.querySelector('#resLijst').textContent, /mislukt|pagina-opbouw/);
  });
});

describe('Leescode zoekpagina Gaspedaal', () => {
  const { w } = laadApp();
  const r = w.parseerGaspedaalZoek(fixture('gaspedaal-zoek.html'));

  test('aantal en advertenties', () => {
    assert.equal(r.count, 516);
    assert.equal(r.items.length, 4);
  });
  test('eerste occasion: alle velden', () => {
    const it = plain(r.items[0]);
    assert.match(it.geplaatst, /^0[23]-10-2026$/);   // de dag hangt af van de tijdzone van de computer
    delete it.geplaatst;
    assert.deepEqual(it, {
      id: 'gp100000001', title: 'BMW X5 XDrive45e High Executive M-SPORT|PANO|HuD|360CAMERA|LASER|LU', price: 52950, km: 89901, ez: '2021',
      fuel: 'hybride', co2: null, kw: 210, transmission: 'AUTOMATISCH',
      img: 'https://cdn.gaspedaal.nl/images/small/voorbeeld-3.jpg?source=https://cdn.voorbeeld.test/3/foto.jpg',
      seller: 'AutoTrack', city: 'Lijnden', url: 'https://api.gaspedaal.nl/redirect/vehicle/200000001',
    });
  });
  test('brandstof wordt herkend', () => {
    assert.deepEqual(plain(r.items.map(i => i.fuel)), ['hybride', 'hybride', 'hybride', 'benzine']);
  });
  test('zoekwoord en brandstof rekent de app zelf na, want de link kent ze niet', () => {
    const p = { brandstof: [] };
    assert.equal(w.pastGaspedaal(r.items[0], p, 'M Sport'), true, 'M-SPORT in de titel past bij M Sport');
    assert.equal(w.pastGaspedaal({ title: 'BMW X5 xDrive45e xLine', fuel: 'hybride' }, p, 'M Sport'), false);
    assert.equal(w.pastGaspedaal(r.items[3], { brandstof: ['phev'] }, ''), false, 'benzine past niet bij plug-in hybride');
    assert.equal(w.pastGaspedaal(r.items[0], { brandstof: ['phev'] }, ''), true);
    assert.equal(w.pastGaspedaal({ title: 'BMW X5', fuel: null }, { brandstof: ['diesel'] }, ''), true, 'onbekende brandstof blijft staan');
  });
  test('pagina zonder occasions maar met teller nul is geen fout', () => {
    const leeg = '<html><head><script type="application/ld+json">{"@type":"ItemList","numberOfItems":0,"itemListElement":[]}</' + 'script></head><body></body></html>';
    assert.deepEqual(plain(w.parseerGaspedaalZoek(leeg)), { count: 0, items: [] });
  });
  test('geweigerde of onherkenbare pagina geeft een melding', () => {
    assert.throws(() => w.parseerGaspedaalZoek('<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY>blocked</BODY></HTML>'), /weigert/);
    assert.throws(() => w.parseerGaspedaalZoek('<html><body>niets</body></html>'), /pagina-opbouw is gewijzigd/);
  });
});

// ---------------------------------------------------------------- advertentiepagina's
describe('Leescode advertentiepagina\'s: exacte gegevens', () => {
  const { w } = laadApp();
  const leeg = { netto: null, btw: null, det: null, detGeschat: false, km: null, brandstof: null, phev: null, co2: null, kw: null, kenteken: null };

  test('AutoScout24.de: prijs zonder voetnootcijfer, netto, BTW, datum, CO2', () => {
    const url = 'https://www.autoscout24.de/angebote/bmw-x5-voorbeeld';
    assert.deepEqual(plain(w.parseerAs24Advertentie(fixture('as24-de-advertentie.html'), url)), Object.assign({}, leeg, {
      url, land: 'DE', oms: 'BMW X5 xDrive 40d M-Sport Laser Luft Sky HUD H&K AHK', prijs: 65455, netto: 55004, btw: true,
      det: '2023-03-01', km: 59998, brandstof: 'diesel', phev: false, co2: 180, kw: 250,
    }));
  });
  test('AutoScout24.nl: plug-in hybride en kenteken', () => {
    const a = w.parseerAs24Advertentie(fixture('as24-nl-advertentie.html'), 'https://www.autoscout24.nl/aanbod/x');
    assert.equal(a.land, 'NL'); assert.equal(a.prijs, 59950); assert.equal(a.netto, 49615); assert.equal(a.btw, true);
    assert.equal(a.det, '2022-10-01'); assert.equal(a.km, 78455); assert.equal(a.brandstof, 'hybride'); assert.equal(a.phev, true);
    assert.equal(a.co2, 38); assert.equal(a.kw, 290); assert.equal(a.kenteken, 'A-001-EE');
  });
  test('AutoScout24.be: Elektrisch/Benzine is hybride, CO2 uit het andere veld', () => {
    const a = w.parseerAs24Advertentie(fixture('as24-be-advertentie.html'), 'https://www.autoscout24.be/nl/aanbod/x');
    assert.equal(a.land, 'BE'); assert.equal(a.prijs, 60990); assert.equal(a.netto, 50405);
    assert.equal(a.det, '2022-09-01'); assert.equal(a.km, 45507); assert.equal(a.brandstof, 'hybride'); assert.equal(a.phev, true); assert.equal(a.co2, 30);
  });
  test('AutoScout24 Smyle: andere opbouw, zelfde gegevens', () => {
    const a = w.parseerAs24Advertentie(fixture('as24-smyle-advertentie.html'), 'https://www.autoscout24.de/smyle/details/x/');
    assert.equal(a.oms, 'BMW X5 xDrive 30d M Sport*UPE 117.000€*SkyLounge');
    assert.equal(a.prijs, 65980); assert.equal(a.det, '2024-11-01'); assert.equal(a.km, 25200); assert.equal(a.brandstof, 'diesel');
    assert.equal(a.co2, 186); assert.equal(a.kw, 219); assert.equal(a.btw, null, 'BTW-status staat er niet in');
  });
  test('Marktplaats: de vraagprijs en niet de motorrijtuigenbelasting; margeauto; kenteken', () => {
    const a = w.parseerLrpAdvertentie(fixture('marktplaats-advertentie.html'), 'https://www.marktplaats.nl/v/auto-s/bmw/m2000000001-x');
    assert.equal(a.land, 'NL'); assert.equal(a.prijs, 61950); assert.equal(a.btw, false);
    assert.equal(a.km, 47734); assert.equal(a.brandstof, 'hybride'); assert.equal(a.phev, true); assert.equal(a.co2, 29);
    assert.equal(a.kw, 290); assert.equal(a.kenteken, 'AEA-01-E');
    assert.equal(a.det, '2022-06-01'); assert.equal(a.detGeschat, true, 'alleen het bouwjaar is bekend');
  });
  test('2dehands: zelfde platform, land België', () => {
    const a = w.parseerLrpAdvertentie(fixture('2dehands-advertentie.html'), 'https://www.2dehands.be/v/auto-s/bmw/m2000000002-x');
    assert.equal(a.land, 'BE'); assert.equal(a.prijs, 65900); assert.equal(a.km, 78092); assert.equal(a.co2, 28); assert.equal(a.kw, 210);
    assert.equal(a.btw, null); assert.equal(a.kenteken, null);
  });
  test('Kleinanzeigen: prijs met het euroteken achteraan, datum van deze advertentie en niet van een andere', () => {
    const url = 'https://www.kleinanzeigen.de/s-anzeige/bmw-x5/3529376868-216-8947';
    assert.deepEqual(plain(w.parseerKleinanzeigenAdvertentie(fixture('kleinanzeigen-advertentie.html'), url)), Object.assign({}, leeg, {
      url, land: 'DE', oms: 'BMW X5 30 d xDrive M Sport*PANO*22 ZOLL*H&K*', prijs: 69990, det: '2024-06-01', km: 42000, brandstof: 'diesel', phev: false, kw: 210,
    }));
  });
  test('mobile.de: bruto en netto prijs, BTW, eerste toelating, vermogen', () => {
    const url = 'https://suchen.mobile.de/fahrzeuge/details.html?id=1';
    assert.deepEqual(plain(w.parseerMobileAdvertentie(fixture('mobile-advertentie.html'), url)), Object.assign({}, leeg, {
      url, land: 'DE', oms: 'BMW X5 xDrive30d M Sportpaket | AHK Laser 360° RFK', prijs: 54990, netto: 46210, btw: true,
      det: '2022-08-01', km: 85714, brandstof: 'diesel', phev: false, kw: 210,
    }));
  });
  test('mobile.de: zonder nettoprijs is het een margeauto; CO2 wordt gelezen als die er staat', () => {
    const marge = fixture('mobile-advertentie.html').replace(/,\\"nt\\":\{[^}]*\}/, '').replace('{\\"label\\":\\"Kraftstoffart\\"', '{\\"label\\":\\"CO₂-Emissionen (komb.)\\",\\"tag\\":\\"envkv.co2Emissions\\",\\"value\\":\\"159 g/km\\"},{\\"label\\":\\"Kraftstoffart\\"');
    const a = w.parseerMobileAdvertentie(marge, 'https://suchen.mobile.de/fahrzeuge/details.html?id=1');
    assert.equal(a.btw, false); assert.equal(a.netto, null); assert.equal(a.prijs, 54990); assert.equal(a.co2, 159);
  });
  test('controlepagina of lege pagina geeft een melding', () => {
    assert.throws(() => w.parseerMobileAdvertentie(fixture('mobile-controle.html'), 'https://suchen.mobile.de/x'), /controlepagina/);
    assert.throws(() => w.parseerAs24Advertentie('<html></html>', 'https://www.autoscout24.de/x'), /pagina-opbouw gewijzigd/);
    assert.throws(() => w.parseerLrpAdvertentie('<html></html>', 'https://www.marktplaats.nl/x'), /pagina-opbouw gewijzigd/);
    assert.throws(() => w.parseerKleinanzeigenAdvertentie('<html></html>', 'https://www.kleinanzeigen.de/x'), /geen advertentie/);
  });
  test('welke sites de app kan lezen', () => {
    const s = w.siteVanAdvertentie;
    assert.equal(s('https://suchen.mobile.de/fahrzeuge/details.html?id=1'), 'mobile');
    assert.equal(s('https://www.autoscout24.be/nl/aanbod/x'), 'as24');
    assert.equal(s('https://www.2ememain.be/v/autos/bmw/m1'), 'lrp');
    assert.equal(s('https://www.kleinanzeigen.de/s-anzeige/x/1'), 'kleinanzeigen');
    assert.equal(s('https://api.gaspedaal.nl/redirect/vehicle/1'), null);
    assert.equal(s('https://mobile.de.voorbeeld.nl/x'), null);
    assert.equal(s('geen adres'), null);
  });
  test('brandstof: Elektrisch/Benzine en varianten zijn hybride', () => {
    const n = w.normBrandstof;
    assert.equal(n('Elektrisch/Benzine'), 'hybride'); assert.equal(n('Elektro/Benzine'), 'hybride'); assert.equal(n('Hybrid (Benzin/Elektro)'), 'hybride');
    assert.equal(n('Elektro/Diesel'), 'hybride_diesel'); assert.equal(n('Hybrid (Diesel/Elektro)'), 'hybride_diesel');
    assert.equal(n('Diesel'), 'diesel'); assert.equal(n('Benzin'), 'benzine'); assert.equal(n('Elektro'), 'elektrisch'); assert.equal(n('Autogas (LPG)'), null);
  });
});

// ---------------------------------------------------------------- extensie in de app
describe('Zoeken met de KAAP-extensie', () => {
  test('zonder extensie: mobile.de en Gaspedaal doen niet mee en de app zegt waarom', async () => {
    const { w, d, G } = laadApp();
    w.eval("S.instellingen.proxy = ''");
    zet(w, 'p_merk', 'BMW'); zet(w, 'p_model', 'X5');
    await w.zoekLive();
    assert.equal(G('HULP').aanwezig, false);
    assert.equal(G('LIVE').sites.length, 0);
    assert.match(d.querySelector('#resLijst').textContent, /mobile\.de en Gaspedaal staan er niet bij: daarvoor is de KAAP-extensie nodig/);
    assert.equal(d.querySelector('#hulpStatus').hidden, true);
    assert.match(d.querySelector('#hulpTekst').textContent, /Niet gevonden/);
  });

  test('met extensie: beide sites leveren resultaten, het modelnummer wordt geleerd en bewaard', async () => {
    const { w, d, G } = laadApp();
    const verzoeken = nepExtensie(w, paginas);
    w.hulpPing(); await wachtOpHulp(w);
    assert.equal(G('HULP').aanwezig, true);
    assert.equal(d.querySelector('#hulpStatus').hidden, false, 'kop toont dat de extensie actief is');
    assert.match(d.querySelector('#hulpTekst').textContent, /Actief, versie 1\.0\.0/);

    w.eval("S.instellingen.proxy = ''");   // alleen de sites van de extensie
    zet(w, 'p_merk', 'BMW'); zet(w, 'p_model', 'X5'); zet(w, 'p_uitv', 'M Sport'); zet(w, 'p_uitv_de', 'M Sportpaket');
    await w.zoekLive();
    const sites = G('LIVE').sites;
    assert.deepEqual(plain(sites.map(s => [s.site, s.status])), [['mobile', 'klaar'], ['gaspedaal', 'klaar']]);

    const mob = sites[0];
    assert.equal(G('S').instellingen.koppelingen['mobile|bmw|x5'], '3500;49', 'modelnummer geleerd en bewaard');
    assert.equal(JSON.parse(w.localStorage.getItem(SLEUTEL)).instellingen.koppelingen['mobile|bmw|x5'], '3500;49');
    assert.match(mob.url, /ms=3500%3B49%3B%3BM\+Sportpaket/, 'de link is nu op het model');
    assert.equal(mob.count, 1231);
    assert.equal(mob.items.length, 3, 'drie X5-automaten; de handgeschakelde valt af');
    assert.ok(mob.items.every(it => /X5/.test(it.title)));
    assert.deepEqual(verzoeken.filter(v => /mobile\.de/.test(v.url)).map(v => /ms=3500%3B49%3B/.test(v.url)), [false, true], 'eerst merkbreed, dan op modelnummer');
    assert.ok(verzoeken.every(v => v.wachtOp && v.geefOpBij === 'sec-if-cpt-container'), 'de app zegt waarop de extensie moet wachten');

    const gp = sites[1];
    assert.equal(gp.count, 516);
    assert.equal(gp.items.length, 4, 'M-SPORT, M Sport, M-Sport en M-Sportpakket tellen alle vier als M Sport');
    assert.ok(gp.items.every(it => /m.?sport/i.test(it.title)));

    const kaarten = d.querySelectorAll('#resLijst .res');
    assert.equal(kaarten.length, mob.items.length + gp.items.length);
    assert.ok([...kaarten].every(k => k.querySelector('.naarkand').textContent === 'Naar kandidaat'), 'elke kaart heeft de knop');
    assert.match(d.querySelector('#resLijst').textContent, /De app heeft het modelnummer van X5 op mobile\.de zelf opgezocht en bewaard/);
    assert.match(d.querySelector('#resLijst').textContent, /1\.231 op de site/);

    // tweede keer zoeken: het nummer is bekend, dus maar één pagina van mobile.de
    verzoeken.length = 0;
    await w.zoekLive();
    assert.equal(verzoeken.filter(v => /mobile\.de/.test(v.url)).length, 1);
    assert.equal(G('LIVE').sites[0].items.length, 3);
  });

  test('twee uitvoeringen delen één Gaspedaal-pagina: één keer ophalen, teller niet dubbel', async () => {
    const { w, d, G } = laadApp();
    const verzoeken = nepExtensie(w, paginas);
    w.hulpPing(); await wachtOpHulp(w);
    w.eval("S.instellingen.proxy = ''");
    zet(w, 'p_merk', 'BMW'); zet(w, 'p_model', 'X5'); zet(w, 'p_uitv', 'M Sport, High Executive');
    d.querySelector('#p_sites input[value="mobile"]').click();   // alleen Gaspedaal
    await w.zoekLive();
    assert.deepEqual(plain(G('LIVE').sites.map(s => s.site)), ['gaspedaal', 'gaspedaal']);
    assert.equal(verzoeken.filter(v => !/[?&]page=/.test(v.url)).length, 1, 'zelfde adres wordt één keer opgehaald');
    assert.deepEqual(plain(verzoeken.filter(v => /[?&]page=/.test(v.url)).map(v => v.url.match(/page=(\d)/)[1])), ['2', '3'], 'voor de verkoopprijs ook pagina 2 en 3 van Gaspedaal');
    assert.deepEqual(plain(G('LIVE').sites.map(s => s.items.length)), [4, 2], 'High Executive staat in twee van de vier titels');
    assert.equal(d.querySelectorAll('#resLijst .res').length, 4, 'dezelfde advertentie verschijnt één keer');
    assert.match(d.querySelector('#resLijst').textContent, /516 op de site/);
    assert.doesNotMatch(d.querySelector('#resLijst').textContent, /1\.032 op de site/);
  });

  test('controlepagina bij mobile.de: melding per site, Gaspedaal werkt gewoon door', async () => {
    const { w, d, G } = laadApp();
    nepExtensie(w, (url) => /mobile\.de/.test(url) ? fixture('mobile-controle.html') : paginas(url));
    w.hulpPing(); await wachtOpHulp(w);
    w.eval("S.instellingen.proxy = ''");
    zet(w, 'p_merk', 'BMW'); zet(w, 'p_model', 'X5');
    await w.zoekLive();
    const [mob, gp] = G('LIVE').sites;
    assert.equal(mob.status, 'fout'); assert.match(mob.error, /controlepagina/);
    assert.equal(gp.status, 'klaar'); assert.equal(gp.items.length, 4);
    assert.equal(G('S').instellingen.koppelingen['mobile|bmw|x5'], undefined, 'niets geleerd uit een controlepagina');
    assert.match(d.querySelector('#siteStatus').textContent, /mobile\.de.*fout/);
  });

  // De pagina van modelnummer 49 (X5) zoals mobile.de hem geeft als er weinig of niets binnen de filters staat.
  const metModelpagina = (naam) => (url) => /mobile\.de\/fahrzeuge\/search/.test(url) && /ms=3500%3B49%3B/.test(url) ? fixture(naam) : paginas(url);
  async function zoekAlleenMobile(pagina, model = 'X5') {
    const app = laadApp();
    app.verzoeken = nepExtensie(app.w, pagina);
    app.w.hulpPing(); await wachtOpHulp(app.w);
    app.w.eval("S.instellingen.proxy = ''");
    zet(app.w, 'p_merk', 'BMW'); zet(app.w, 'p_model', model);
    app.d.querySelector('#p_sites input[value="gaspedaal"]').click();   // alleen mobile.de
    await app.w.zoekLive();
    app.mob = app.G('LIVE').sites[0];
    app.tekst = app.d.querySelector('#resLijst').textContent;
    return app;
  }

  test('weinig X5\'s binnen de filters: alleen de echte treffer, geen andere modellen (melding van 03-10-2026)', async () => {
    const { mob, tekst, d, G } = await zoekAlleenMobile(metModelpagina('mobile-zoek-weinig.html'));
    assert.equal(mob.status, 'klaar'); assert.equal(mob.count, 1);
    assert.deepEqual(plain(mob.items.map(i => i.title)), ['BMW X5 xDrive45e -SUV M Sport']);
    assert.equal(G('S').instellingen.koppelingen['mobile|bmw|x5'], '3500;49', 'de treffer is een X5: nummer bevestigd en bewaard');
    assert.equal(d.querySelectorAll('#resLijst .res').length, 1);
    assert.doesNotMatch(tekst, /BMW 330|BMW X3|BMW 740|BMW 320|BMW X6/, 'geen andere modellen in beeld');
    assert.doesNotMatch(tekst, /komt niet in de titels voor/);
    assert.match(tekst, /1 op de site, 1 getoond/);
  });

  test('geen enkele X5 binnen de filters: nul resultaten in plaats van de rest van het merk', async () => {
    const { mob, tekst, d, G } = await zoekAlleenMobile(metModelpagina('mobile-zoek-nul.html'));
    assert.equal(mob.status, 'klaar'); assert.equal(mob.items.length, 0); assert.equal(mob.count, 0);
    assert.match(mob.url, /ms=3500%3B49%3B/, 'de knop Op de site gaat naar het model');
    assert.equal(G('S').instellingen.koppelingen['mobile|bmw|x5'], undefined, 'zonder treffers valt het nummer niet te bevestigen, dus niet bewaard');
    assert.equal(d.querySelectorAll('#resLijst .res').length, 0);
    assert.match(tekst, /Geen resultaten/);
    assert.doesNotMatch(tekst, /1\.231 op de site|komt niet in de titels voor/);
  });

  test('model dat mobile.de niet onder die naam kent: alleen wat het model in de titel heeft, met uitleg', async () => {
    const zonderX5 = (url) => /mobile\.de\/fahrzeuge\/search/.test(url) ? fixture('mobile-zoek.html').replace('{\\"value\\":\\"49\\",\\"label\\":\\"X5\\"},', '') : paginas(url);
    const { mob, tekst, verzoeken, G } = await zoekAlleenMobile(zonderX5);
    assert.equal(mob.status, 'klaar');
    assert.deepEqual(plain(mob.items.map(i => i.title)), ['BMW X5 xDrive50e M Sportpaket Pro*22 Zoll*Komfortsit'], 'van de merkpagina blijft alleen de X5-automaat over');
    assert.equal(mob.count, null, 'het aantal van het hele merk wordt niet als aantal X5 getoond');
    assert.match(mob.melding, /kent het model "X5" niet onder die naam/);
    assert.match(tekst, /kent het model "X5" niet onder die naam.*Model-koppeling/);
    assert.doesNotMatch(tekst, /1\.231 op de site|BMW 330|BMW X6/);
    assert.equal(G('S').instellingen.koppelingen['mobile|bmw|x5'], undefined);
    assert.equal(verzoeken.filter(v => /mobile\.de/.test(v.url)).length, 1, 'van mobile.de alleen de merkpagina');

    const x7 = await zoekAlleenMobile(paginas, 'X7');
    assert.equal(x7.mob.items.length, 0, 'geen X7 in de titels: niets tonen, niet het hele merk');
    assert.match(x7.mob.melding, /kent het model "X7" niet/);
  });

  test('pagina van het model is niet op te halen: alleen de X5 van de merkpagina, met uitleg', async () => {
    const { mob, tekst, G } = await zoekAlleenMobile((url) => /ms=3500%3B49%3B/.test(url) ? fixture('mobile-controle.html') : paginas(url));
    assert.equal(mob.status, 'klaar');
    assert.equal(mob.items.length, 1); assert.match(mob.items[0].title, /X5/);
    assert.match(mob.melding, /pagina van X5 op mobile\.de kon niet worden opgehaald/);
    assert.match(tekst, /kon niet worden opgehaald/);
    assert.equal(G('S').instellingen.koppelingen['mobile|bmw|x5'], undefined);
  });

  test('klopt het gevonden modelnummer niet, dan bewaart de app het niet', async () => {
    const { w, G } = laadApp();
    nepExtensie(w, (url) => /mobile\.de\/fahrzeuge\/search/.test(url) ? fixture('mobile-zoek.html') : paginas(url));   // ook op nummer 49 gemengde modellen
    w.hulpPing(); await wachtOpHulp(w);
    w.eval("S.instellingen.proxy = ''");
    zet(w, 'p_merk', 'BMW'); zet(w, 'p_model', 'X5');
    await w.zoekLive();
    assert.equal(G('S').instellingen.koppelingen['mobile|bmw|x5'], undefined);
    assert.equal(G('LIVE').sites[0].status, 'klaar');
    assert.equal(G('LIVE').sites[0].items.length, 1, 'alleen de X5-automaat blijft over');
    assert.match(G('LIVE').sites[0].melding, /vooral andere modellen/);
  });

  test('pk minimum wordt (als kW) nagerekend bij sites die het vermogen meegeven', () => {
    const { w } = laadApp();
    const p = { pk: 340 };   // 340 pk = 250 kW
    assert.equal(w.pastCriteria({ kw: 210 }, p), false);
    assert.equal(w.pastCriteria({ kw: 290 }, p), true);
    assert.equal(w.pastCriteria({ price: 1 }, p), true, 'zonder vermogen in de advertentie geen oordeel');
  });

  test('de extensie die niet antwoordt geeft een melding en geen eeuwig wachten', async () => {
    const { w } = laadApp();
    w.postMessage({ kaap: 'hulp-aanwezig', versie: '1.0.0' }, '*'); await wachtOpHulp(w);
    w.eval('var __st = setTimeout; setTimeout = (f, ms) => __st(f, ms > 1000 ? 30 : ms)');   // wachttijd inkorten voor de test
    await assert.rejects(w.hulpHaal('https://suchen.mobile.de/x', { wachtOp: 'x' }), /geen antwoord van de KAAP-extensie/);
  });
});

// ---------------------------------------------------------------- Naar kandidaat
describe('Naar kandidaat en Gegevens ophalen', () => {
  test('vanaf een resultaat: eerst de kaart, dan exacte gegevens uit de advertentie (AutoScout24 via de proxy)', async () => {
    const aanvragen = [];
    const { w, d, G } = laadApp({ fetch: nepProxy(aanvragen) });
    const url = 'https://www.autoscout24.de/angebote/bmw-x5-voorbeeld';
    w.kandidaatUit({ oms: 'BMW X5 xDrive 40d', url, prijs: 65455, km: 59998, ez: '2023-03', fuel: 'diesel', co2: 180, land: 'DE' });
    assert.ok(d.querySelector('#tab-kandidaten').classList.contains('on'));
    assert.equal(veld(w, 'k_prijs'), '65455');
    await G('verrijkBezig');
    assert.deepEqual(aanvragen, [url]);
    assert.equal(veld(w, 'k_oms'), 'BMW X5 xDrive 40d M-Sport Laser Luft Sky HUD H&K AHK');
    assert.equal(veld(w, 'k_prijs'), '65455'); assert.equal(veld(w, 'k_btw'), 'btw'); assert.equal(veld(w, 'k_det'), '2023-03-01');
    assert.equal(veld(w, 'k_km'), '59998'); assert.equal(veld(w, 'k_brandstof'), 'diesel'); assert.equal(veld(w, 'k_co2w'), '180'); assert.equal(veld(w, 'k_land'), 'DE');
    assert.match(d.querySelector('#toast').textContent, /Aangevuld uit de advertentie/);
    assert.match(d.querySelector('#bpmOut').textContent, /BPM \(forfaitair\)€\s[\d.]+/);
  });

  test('margeauto van Marktplaats: BTW-status wordt marge, kenteken ingevuld', async () => {
    const { w, G } = laadApp({ fetch: nepProxy() });
    w.kandidaatUit({ oms: 'BMW X5', url: 'https://www.marktplaats.nl/v/auto-s/bmw/m2000000001-x', prijs: 61950, land: 'NL' });
    await G('verrijkBezig');
    assert.equal(veld(w, 'k_btw'), 'marge'); assert.equal(veld(w, 'k_prijs'), '61950'); assert.equal(veld(w, 'k_kenteken'), 'AEA-01-E');
    assert.equal(veld(w, 'k_land'), 'NL'); assert.equal(veld(w, 'k_phev'), '1'); assert.equal(veld(w, 'k_co2w'), '29');
  });

  test('mobile.de via de extensie: bruto prijs, BTW en eerste toelating', async () => {
    const { w, d, G } = laadApp();
    nepExtensie(w, paginas); w.hulpPing(); await wachtOpHulp(w);
    w.kandidaatUit({ oms: 'BMW X5', url: 'https://suchen.mobile.de/fahrzeuge/details.html?id=40000000000003', prijs: 54990, land: 'DE', btw: true });
    await G('verrijkBezig');
    assert.equal(veld(w, 'k_oms'), 'BMW X5 xDrive30d M Sportpaket | AHK Laser 360° RFK');
    assert.equal(veld(w, 'k_prijs'), '54990'); assert.equal(veld(w, 'k_btw'), 'btw'); assert.equal(veld(w, 'k_det'), '2022-08-01'); assert.equal(veld(w, 'k_km'), '85714');
    assert.match(d.querySelector('#toast').textContent, /Niet vermeld: de CO2/);
  });

  test('klik op de knop bij een resultaatkaart doet hetzelfde', async () => {
    const { w, d, G } = laadApp();
    nepExtensie(w, paginas); w.hulpPing(); await wachtOpHulp(w);
    w.eval("S.instellingen.proxy = ''");
    zet(w, 'p_merk', 'BMW'); zet(w, 'p_model', 'X5');
    d.querySelector('#p_sites input[value="gaspedaal"]').click();   // alleen mobile.de
    await w.zoekLive();
    d.querySelector('#resLijst .res .naarkand').click();
    await G('verrijkBezig');
    assert.equal(veld(w, 'k_prijs'), '54990'); assert.equal(veld(w, 'k_det'), '2022-08-01');
    assert.match(veld(w, 'k_url'), /^https:\/\/suchen\.mobile\.de\/fahrzeuge\/details\.html\?id=\d+$/);
  });

  test('geplakte link en de knop Gegevens ophalen (Kleinanzeigen)', async () => {
    const { w, d, G } = laadApp({ fetch: nepProxy() });
    w.toonTab('kandidaten');
    zet(w, 'k_url', 'https://www.kleinanzeigen.de/s-anzeige/bmw-x5/3529376868-216-8947');
    d.querySelector('#btnOphalen').click();
    await G('verrijkBezig');
    assert.equal(veld(w, 'k_prijs'), '69990'); assert.equal(veld(w, 'k_det'), '2024-06-01'); assert.equal(veld(w, 'k_km'), '42000'); assert.equal(veld(w, 'k_brandstof'), 'diesel');
    assert.match(d.querySelector('#toast').textContent, /Niet vermeld: de CO2/);
  });

  test('onbekende site, lege link en mobile.de zonder extensie geven uitleg', () => {
    const { w, d } = laadApp({ fetch: nepProxy() });
    d.querySelector('#btnOphalen').click();
    assert.match(d.querySelector('#toast').textContent, /Plak eerst de link/);
    zet(w, 'k_url', 'https://www.voorbeeld-dealer.nl/occasion/1');
    d.querySelector('#btnOphalen').click();
    assert.match(d.querySelector('#toast').textContent, /kan de app de advertentie niet zelf lezen/);
    zet(w, 'k_url', 'https://suchen.mobile.de/fahrzeuge/details.html?id=1');
    d.querySelector('#btnOphalen').click();
    assert.match(d.querySelector('#toast').textContent, /KAAP-extensie nodig/);
  });

  test('advertentie is intussen verkocht of verwijderd (HTTP 410): gewone taal', async () => {
    const { w, d, G } = laadApp({ fetch: () => Promise.resolve({ ok: false, status: 410, text: async () => '' }) });
    w.kandidaatUit({ oms: 'BMW X5', url: 'https://www.autoscout24.de/angebote/x', prijs: 65455, land: 'DE' });
    await G('verrijkBezig');
    assert.match(d.querySelector('#toast').textContent, /de advertentie bestaat niet meer \(verkocht of verwijderd\)/);
    assert.equal(veld(w, 'k_prijs'), '65455', 'wat er al stond blijft staan');
  });

  test('ophalen mislukt: de gegevens van de kaart blijven staan en de app zegt het', async () => {
    const { w, d, G } = laadApp({ fetch: () => Promise.resolve({ ok: false, status: 500, text: async () => '' }) });
    w.kandidaatUit({ oms: 'BMW X5', url: 'https://www.autoscout24.de/angebote/x', prijs: 65455, land: 'DE' });
    await G('verrijkBezig');
    assert.equal(veld(w, 'k_prijs'), '65455');
    assert.match(d.querySelector('#toast').textContent, /Advertentie ophalen lukte niet/);
  });
});

// ---------------------------------------------------------------- vervallen bladwijzers
// ---------------------------------------------------------------- Kandidaten bijwerken
describe('Kandidaten bijwerken', () => {
  const kand = (extra) => Object.assign({ land: 'DE', btw: 'btw', brandstof: 'diesel', det: '2023-03-01', co2w: 180, keuring: '2026-10-20', status: 'nieuw', created: 1759000000000 }, extra);
  const kandidaten = [
    kand({ id: 'k1', oms: 'AutoScout24 DE', url: 'https://www.autoscout24.de/angebote/bmw-x5-voorbeeld', prijs: 66950 }),
    kand({ id: 'k2', oms: 'Marktplaats', url: 'https://www.marktplaats.nl/v/auto-s/bmw/m2000000001-x', prijs: 61950, land: 'NL', status: 'bekeken' }),
    kand({ id: 'k3', oms: 'Kleinanzeigen weg', url: 'https://www.kleinanzeigen.de/s-anzeige/bmw-x5/3000000099-216-1234', prijs: 49900 }),
    kand({ id: 'k4', oms: 'mobile.de', url: 'https://suchen.mobile.de/fahrzeuge/details.html?id=40000000000003', prijs: 52990, status: 'bod' }),
    kand({ id: 'k5', oms: 'al gekocht', url: 'https://www.autoscout24.de/angebote/bmw-x5-gekocht', prijs: 50000, status: 'gekocht' }),
    kand({ id: 'k6', oms: 'site onbekend', url: 'https://www.gocar.be/nl/autos/bmw/x5/1', prijs: 48000 }),
    kand({ id: 'k7', oms: 'AutoScout24 NL verkocht', url: 'https://www.autoscout24.nl/aanbod/bmw-x5-verkocht', prijs: 58000, land: 'NL' }),
    kand({ id: 'k8', oms: 'storing', url: 'https://www.autoscout24.de/angebote/bmw-x5-storing', prijs: 57000 }),
    kand({ id: 'k9', oms: 'zonder link', url: '', prijs: 45000 }),
  ];
  const aanvragen = [];
  const proxy = (adres) => {
    const doel = new URL(String(adres)).searchParams.get('url') || '';
    aanvragen.push(doel);
    if (/autoscout24\.nl/.test(doel)) return Promise.resolve({ ok: false, status: 410, text: async () => '' });   // verkocht: de site zegt "weg"
    if (/storing/.test(doel)) return Promise.resolve({ ok: false, status: 500, text: async () => '' });
    const naam = /autoscout24\.de/.test(doel) ? 'as24-de-advertentie.html' : /marktplaats\.nl/.test(doel) ? 'marktplaats-advertentie.html'
      : /kleinanzeigen\.de\/s-anzeige/.test(doel) ? 'kleinanzeigen-zoek.html' : null;   // Kleinanzeigen stuurt een verdwenen advertentie door naar zoekresultaten
    if (!naam) return Promise.reject(new Error('onverwacht adres in de test: ' + doel));
    return Promise.resolve({ ok: true, status: 200, text: async () => fixture(naam) });
  };

  test('prijsdaling, prijsstijging, verkocht en storing worden herkend; gekochte en onleesbare kandidaten overgeslagen', async () => {
    aanvragen.length = 0;
    const { w, d, G } = laadApp({ fetch: proxy, opslag: JSON.stringify({ kandidaten, profielen: [] }) });
    nepExtensie(w, paginas); w.hulpPing(); await wachtOpHulp(w);
    w.vulKandForm(G('S').kandidaten.find(k => k.id === 'k1'));   // k1 staat open in het formulier
    await w.werkKandidatenBij();
    const k = (id) => plain(G('S').kandidaten.find(x => x.id === id));

    assert.equal(k('k1').controle.status, 'gedaald'); assert.equal(k('k1').controle.oud, 66950); assert.equal(k('k1').controle.nieuw, 65455);
    assert.equal(k('k1').prijs, 65455, 'de nieuwe vraagprijs gaat in kostprijs en marge');
    assert.deepEqual(k('k1').prijzen.map(x => x.prijs), [66950, 65455], 'de oude prijs blijft bewaard');
    assert.equal(veld(w, 'k_prijs'), '65455', 'het open formulier toont de nieuwe vraagprijs');
    assert.equal(k('k2').controle.status, 'ongewijzigd'); assert.equal(k('k2').prijs, 61950); assert.equal(k('k2').prijzen, undefined);
    assert.equal(k('k3').controle.status, 'weg'); assert.match(k('k3').controle.melding, /bestaat niet meer/);
    assert.equal(k('k3').prijs, 49900, 'een verdwenen advertentie verandert de prijs niet');
    assert.equal(k('k4').controle.status, 'gestegen'); assert.equal(k('k4').prijs, 54990);
    assert.equal(k('k4').status, 'bod', 'de status kiest de gebruiker zelf');
    assert.equal(k('k5').controle, undefined, 'gekocht: niet meer gecontroleerd');
    assert.equal(k('k6').controle, undefined, 'site die de app niet kan lezen');
    assert.equal(k('k7').controle.status, 'weg');
    assert.equal(k('k8').controle.status, 'fout'); assert.match(k('k8').controle.melding, /HTTP 500/);
    assert.equal(k('k9').controle, undefined);
    assert.ok(!aanvragen.some(a => /gekocht|gocar/.test(a)), 'gekochte en onleesbare kandidaten worden niet opgevraagd');

    const lijst = d.querySelector('#kandTabel').textContent;
    assert.match(lijst, /↓ €\s1\.495 op/); assert.match(lijst, /↑ €\s2\.000 op/); assert.match(lijst, /niet meer online/);
    assert.match(lijst, /prijs ongewijzigd op/); assert.match(lijst, /kon niet lezen op/);
    assert.match(d.querySelector('#toast').textContent, /^6 kandidaten bijgewerkt: 1 in prijs gedaald, 1 in prijs gestegen, 2 niet meer online, 1 ongewijzigd, 1 niet te lezen\. 1 overgeslagen/);
    const bewaard = JSON.parse(w.localStorage.getItem(SLEUTEL));
    assert.equal(bewaard.kandidaten.find(x => x.id === 'k1').prijs, 65455, 'bewaard in de browser');
    assert.equal(d.querySelector('#btnBijwerken').textContent, 'Kandidaten bijwerken'); assert.equal(d.querySelector('#btnBijwerken').disabled, false);
  });

  test('zonder extensie: mobile.de wordt overgeslagen en de app zegt waarom', async () => {
    const { w, d, G } = laadApp({ fetch: proxy, opslag: JSON.stringify({ kandidaten: [kandidaten[3], kandidaten[1]], profielen: [] }) });
    await w.werkKandidatenBij();
    assert.equal(G('S').kandidaten.find(x => x.id === 'k4').controle, undefined);
    assert.equal(G('S').kandidaten.find(x => x.id === 'k2').controle.status, 'ongewijzigd');
    assert.match(d.querySelector('#toast').textContent, /1 kandidaat bijgewerkt: 1 ongewijzigd\. 1 overgeslagen: die site kan de app niet lezen, of het is mobile\.de zonder extensie\./);
  });

  test('niets te doen: uitleg in plaats van een lege ronde', async () => {
    const { w, d } = laadApp({ opslag: JSON.stringify({ kandidaten: [kandidaten[3]], profielen: [] }) });
    await w.werkKandidatenBij();
    assert.match(d.querySelector('#toast').textContent, /Geen van je 1 lopende kandidaten staat op een site die de app kan lezen \(mobile\.de kan alleen met de KAAP-extensie\)/);
    const leeg = laadApp();
    await leeg.w.werkKandidatenBij();
    assert.match(leeg.d.querySelector('#toast').textContent, /Geen lopende kandidaten met een link/);
  });

  test('verdwenen advertentie herkend: AutoScout24 en Kleinanzeigen tonen dan zoekresultaten, Marktplaats geeft 410', () => {
    const { w } = laadApp();
    const fout = (f) => { try { f(); } catch (e) { return e; } return null; };
    const as24 = fout(() => w.parseerAs24Advertentie('<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"listings":[{"id":"x"}],"numberOfResults":20}}}</script>', 'https://www.autoscout24.de/angebote/x'));
    assert.equal(as24.weg, true); assert.match(as24.message, /verkocht of verwijderd/);
    const ka = fout(() => w.parseerKleinanzeigenAdvertentie(fixture('kleinanzeigen-zoek.html'), 'https://www.kleinanzeigen.de/s-anzeige/x/1-216-1'));
    assert.equal(ka.weg, true); assert.match(ka.message, /bestaat niet meer/);
    const kapot = fout(() => w.parseerKleinanzeigenAdvertentie('<html><body><h1>Wartungsarbeiten</h1></body></html>', 'https://www.kleinanzeigen.de/s-anzeige/x/1-216-1'));
    assert.equal(kapot.weg, undefined, 'een kapotte of andere pagina is niet hetzelfde als verkocht');
    const opbouw = fout(() => w.parseerAs24Advertentie('<html>geen data</html>', 'https://www.autoscout24.de/angebote/x'));
    assert.equal(opbouw.weg, undefined);
  });
});

// ---------------------------------------------------------------- Verwachte verkoopprijs NL
describe('Verwachte verkoopprijs NL: 3e van de 5 goedkoopste vergelijkbare op Gaspedaal', () => {
  test('motorcode uit de titel', () => {
    const { w } = laadApp();
    const gevallen = {
      'BMW X5 xDrive45e M Sport': '45e', 'BMW X5 xDrive 30d': '30d', 'BMW X5 xDr45e M SPORT / PANODAK': '45e', 'BMW X5 30 d xDrive M Sport': '30d', 'BMW X3 M40i': '40i',
      'BMW 330 e Touring': '330e', 'Mercedes-Benz GLE 350 de 4MATIC': '350de', 'Audi Q8 50 TDI quattro': '50tdi', 'Audi Q7 55 TFSI e': '55tfsi',
      'BMW X5 M Sport 22 Zoll Pano': null, 'Volvo XC90 T8 Recharge': null, 'BMW X5 2022 360 Kamera': null, 'VW Golf 2.0 TSI': null, 'BMW X5 20 inch velgen': null,
    };
    for (const [titel, code] of Object.entries(gevallen)) assert.equal(w.motorCode(titel), code, titel);
  });

  const auto = (jaar, km, prijs, extra) => Object.assign({ id: 'r' + jaar + '-' + km, title: 'BMW X5 xDrive45e', price: prijs, km, ez: String(jaar), fuel: 'hybride', url: 'https://api.gaspedaal.nl/redirect/vehicle/' + jaar + km }, extra || {});
  const doel = (jaar, km, extra) => Object.assign({ title: 'BMW X5 xDrive45e M Sport', ez: String(jaar), km, fuel: 'hybride', kw: 290 }, extra || {});

  test('referentiepagina: zelfde motor en brandstof, km ±30.000, eerst hetzelfde bouwjaar, aangevuld met een jaar ouder of nieuwer', () => {
    const { w } = laadApp();
    const ref = { bron: 'Gaspedaal', items: w.parseerGaspedaalZoek(fixture('gaspedaal-referentie.html')).items };
    assert.equal(ref.items.length, 16);
    // 2022, 60.000 km: vier uit 2022 tellen mee (de 2022 met 120.000 km niet: 60.000 km verschil), aangevuld met de
    // goedkoopste uit 2021/2023 (2021, 82.000 km, € 58.500). De 50e, diesel en benzine vallen af. Derde van vijf: € 62.450.
    const nl = w.nlVerkoop(doel(2022, 60000), ref);
    assert.equal(nl.prijs, 62450); assert.equal(nl.n, 8);
    assert.deepEqual(plain(nl.autos.map(a => a.price)), [58500, 61500, 62450, 64950, 66000]);
    assert.equal(w.nlVerkoop(doel(2022, 58000, { title: 'BMW X5 xDrive30d', fuel: 'diesel', kw: 210 }), ref), null, 'minder dan vijf: geen bedrag');
    assert.equal(w.nlVerkoop({ title: 'BMW X5 xDrive45e', km: 60000, fuel: 'hybride' }, ref), null, 'zonder bouwjaar geen bedrag');
    const zelf = ref.items.find(x => x.price === 64950);
    assert.ok(!w.nlVerkoop(zelf, ref).autos.includes(zelf), 'een NL-advertentie telt niet als zijn eigen vergelijking');
  });

  test('vijf of meer uit hetzelfde bouwjaar: alleen die tellen, ook als een jaar ouder goedkoper is', () => {
    const { w } = laadApp();
    const ref = { bron: 'Gaspedaal', items: [auto(2021, 100000, 60000), auto(2021, 105000, 61000), auto(2021, 95000, 62000), auto(2021, 110000, 63000), auto(2021, 90000, 64000), auto(2021, 99000, 70000), auto(2020, 100000, 40000), auto(2020, 98000, 41000)] };
    const nl = w.nlVerkoop(doel(2021, 100000), ref);
    assert.deepEqual(plain(nl.autos.map(a => a.price)), [60000, 61000, 62000, 63000, 64000]);
    assert.equal(nl.prijs, 62000);
  });

  test('km ±30.000 vast, ook bij veel kilometers; minder dan vijf vergelijkbare: geen bedrag', () => {
    const { w } = laadApp();
    const ref = { bron: 'Gaspedaal', items: [auto(2020, 150000, 40000), auto(2020, 170000, 39000), auto(2020, 125000, 42000), auto(2020, 180000, 38000), auto(2020, 185000, 30000), auto(2020, 115000, 45000)] };
    // 185.000 en 115.000 km liggen 35.000 km van 150.000 af: die tellen niet mee (met 30% zouden ze wel meetellen).
    assert.equal(w.nlVerkoop(doel(2020, 150000), ref), null, 'vier over: geen bedrag');
    ref.items.push(auto(2020, 140000, 41000));
    const nl = w.nlVerkoop(doel(2020, 150000), ref);
    assert.deepEqual(plain(nl.autos.map(a => a.price)), [38000, 39000, 40000, 41000, 42000]);
    assert.equal(nl.prijs, 40000);
  });

  test('dezelfde auto twee keer op Gaspedaal (zelfde bouwjaar, km en prijs) telt één keer', () => {
    const { w } = laadApp();
    const ref = { bron: 'Gaspedaal', items: [auto(2021, 100000, 41000), auto(2021, 100000, 41000, { id: 'dubbel', title: 'BMW X5 xDrive 45e M Sport', url: 'https://api.gaspedaal.nl/redirect/vehicle/2' }), auto(2021, 105000, 42000), auto(2021, 95000, 43000), auto(2021, 110000, 44000), auto(2021, 90000, 45000)] };
    const nl = w.nlVerkoop(doel(2021, 100000), ref);
    assert.deepEqual(plain(nl.autos.map(a => a.price)), [41000, 42000, 43000, 44000, 45000]);
    assert.equal(nl.prijs, 43000);
  });

  test('facelift: auto\'s van voor en na het faceliftjaar worden niet vergeleken', () => {
    const { w } = laadApp();
    const items = [auto(2022, 60000, 60000), auto(2022, 62000, 62000), auto(2021, 60000, 50000), auto(2021, 61000, 51000), auto(2021, 59000, 52000), auto(2023, 60000, 65000), auto(2023, 58000, 66000), auto(2023, 61000, 67000)];
    const zonder = w.nlVerkoop(doel(2022, 60000), { bron: 'Gaspedaal', items });
    assert.deepEqual(plain(zonder.autos.map(a => a.price)), [50000, 51000, 52000, 60000, 62000]); assert.equal(zonder.prijs, 52000);
    const met = w.nlVerkoop(doel(2022, 60000), { bron: 'Gaspedaal', items, facelift: 2022 });   // 2022 is na de facelift, 2021 ervoor
    assert.deepEqual(plain(met.autos.map(a => a.price)), [60000, 62000, 65000, 66000, 67000]); assert.equal(met.prijs, 65000);
  });

  test('zoeken met extensie: Gaspedaal zonder prijsfilters, bedrag op de kaart, lijst bij een klik, ook bij Naar kandidaat', async () => {
    const { w, d, G } = laadApp();
    const pagina = (url) => /gaspedaal\.nl/.test(url) && /bmin=2019/.test(url) ? fixture('gaspedaal-referentie.html') : paginas(url);
    const verzoeken = nepExtensie(w, pagina);
    w.hulpPing(); await wachtOpHulp(w);
    w.eval("S.instellingen.proxy = ''");
    zet(w, 'p_merk', 'BMW'); zet(w, 'p_model', 'X5'); zet(w, 'p_bjvan', '2020'); zet(w, 'p_pmax', '90000'); zet(w, 'p_km', '100000'); zet(w, 'p_facelift', '2023');
    d.querySelector('#p_sites input[value="mobile"]').click();   // alleen Gaspedaal als resultaat
    await w.zoekLive();

    const ref = verzoeken.map(v => v.url).find(u => /gaspedaal\.nl/.test(u) && /bmin=2019/.test(u));
    assert.ok(ref, 'vergelijkingsmateriaal: bouwjaar een jaar ruimer');
    assert.doesNotMatch(ref, /pmax|pmin/, 'zonder je prijsfilters'); assert.match(ref, /kmax=130000/, 'kilometergrens 30.000 km ruimer');
    const nl = G('LIVE').nlRef.x5;
    assert.equal(nl.status, 'klaar'); assert.equal(nl.items.length, 16); assert.equal(nl.facelift, 2023, 'faceliftjaar uit het zoekprofiel');

    const kaarten = [...d.querySelectorAll('#resLijst .res')];
    const eerste = kaarten.find(k => /XDrive45e High Executive M-SPORT/.test(k.textContent));
    // 2021, 89.901 km: vijf uit 2021 binnen 30.000 km -> € 53.950, 55.500, 56.950, 58.500, 59.950; de derde is € 56.950
    assert.match(eerste.querySelector('.nlv').textContent, /^verkoop NL ≈ €\s56\.950$/);
    assert.doesNotMatch(eerste.textContent, /waarop gebaseerd/i, 'geen extra uitlegtekst op de kaart');
    const lijst = eerste.querySelector('.nlvlijst');
    assert.equal(lijst.hidden, true, 'lijst pas bij een klik');
    eerste.querySelector('.nlv').click();
    assert.equal(lijst.hidden, false);
    const regels = [...lijst.querySelectorAll('li')].map(li => li.textContent);
    assert.equal(regels.length, 5);
    assert.match(regels[0], /^2021 · 110\.000 km · €\s53\.950 · BMW X5 xDrive45e$/);
    assert.match(lijst.querySelector('li.gekozen').textContent, /€\s56\.950/, 'de derde is de verkoopprijs');
    assert.ok([...lijst.querySelectorAll('a')].every(a => /api\.gaspedaal\.nl\/redirect\/vehicle\//.test(a.href)));
    eerste.querySelector('.nlv').click();
    assert.equal(lijst.hidden, true, 'nog een klik: weer dicht');
    assert.match(d.querySelector('#resLijst').textContent, /Verkoop NL: 3e van de 5 goedkoopste vergelijkbare op Gaspedaal \(klik op het bedrag\)\. X5: 16 auto's\./);
    const zonder = kaarten.find(k => /xDrive40i \| M-Sportpakket/.test(k.textContent));
    assert.equal(zonder.querySelector('.nlv'), null, 'minder dan vijf vergelijkbare: geen bedrag');

    eerste.querySelector('.naarkand').click();
    assert.equal(veld(w, 'k_verkoop'), '56950', 'Naar kandidaat vult de verkoopprijs in');

    // Nog een keer zoeken binnen twee uur: het vergelijkingsmateriaal komt uit het geheugen.
    verzoeken.length = 0;
    await w.zoekLive();
    assert.equal(verzoeken.filter(v => /bmin=2019/.test(v.url)).length, 0);
  });

  test('zonder extensie: geen verkoopprijs (die komt altijd van Gaspedaal), wel een korte melding', async () => {
    const aanvragen = [];
    const { w, d, G } = laadApp({ fetch: (adres) => {
      const doel = new URL(String(adres)).searchParams.get('url') || ''; aanvragen.push(doel);
      if (/autoscout24\.de\/lst/.test(doel)) return Promise.resolve({ ok: true, status: 200, text: async () => '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify({ props: { pageProps: { numberOfResults: 1, listings: [{ id: 'de1', url: '/angebote/x', price: { priceRaw: 52000 }, tracking: { mileage: '50000', firstRegistration: '06-2022' }, vehicle: { make: 'BMW', model: 'X5', modelVersionInput: 'xDrive45e M Sport', fuel: 'Elektro/Benzine' } }] } } }) + '</script>' });
      return Promise.reject(new Error('onverwacht adres in de test: ' + doel));
    } });
    w.eval("S.instellingen.proxy = 'https://proxy.test/'");
    zet(w, 'p_merk', 'BMW'); zet(w, 'p_model', 'X5');
    d.querySelectorAll('#p_sites input').forEach(i => { if (i.checked !== (i.value === 'as24de')) i.click(); });
    await w.zoekLive();
    assert.ok(!aanvragen.some(a => /autoscout24\.nl|gaspedaal/.test(a)), 'geen andere bron voor de verkoopprijs');
    assert.deepEqual(plain(G('LIVE').nlRef), {});
    assert.equal(d.querySelector('#resLijst .nlv'), null);
    assert.match(d.querySelector('#resLijst').textContent, /Verkoop NL: alleen met de KAAP-extensie \(Gaspedaal\)\./);
  });

  test('zonder extensie en zonder proxy: geen vergelijkingsmateriaal en geen fout', async () => {
    const { w, d, G } = laadApp();
    w.eval("S.instellingen.proxy = ''");
    zet(w, 'p_merk', 'BMW'); zet(w, 'p_model', 'X5');
    await w.zoekLive();
    assert.deepEqual(plain(G('LIVE').nlRef), {});
    assert.doesNotMatch(d.querySelector('#resLijst').textContent, /Verkoop NL/);
  });
});

// ---------------------------------------------------------------- BPM uit Autotelex
describe('BPM uit Autotelex (KAAP-extensie 1.2)', () => {
  const g = { bedrag: 20291, basis: 'afschrijvingstabel', afschrijvingstabel: 20291, koerslijst: 22808, taxatierapport: null, uitvoering: 'BMW X6 - M50i High Executive', toelating: '13-06-2022' };
  function extensie(w, versie) {
    const starts = [];
    w.addEventListener('message', (e) => {
      const d = e.data; if (!d || typeof d !== 'object') return;
      if (d.kaap === 'hulp-ping') w.postMessage({ kaap: 'hulp-aanwezig', versie }, '*');
      if (d.kaap === 'hulp-atx-start') { starts.push(d); w.postMessage({ kaap: 'hulp-atx-gestart', id: d.id, ok: true }, '*'); }
    });
    return starts;
  }
  const kandidaat = { id: 'k1', oms: 'BMW X6 M50i', land: 'DE', btw: 'btw', prijs: 60000, verkoop: 95000, brandstof: 'benzine', det: '2022-06-13', co2w: 250, keuring: '2026-10-20', status: 'nieuw', created: 1 };

  test('zonder extensie of met een oude extensie: uitleg, geen aanvraag', async () => {
    const zonder = laadApp();
    zonder.d.querySelector('#btnAtx').click();
    assert.match(zonder.d.querySelector('#toast').textContent, /KAAP-extensie nodig/);
    const oud = laadApp();
    const starts = extensie(oud.w, '1.1.0'); oud.w.hulpPing(); await wachtOpHulp(oud.w);
    oud.d.querySelector('#btnAtx').click();
    assert.match(oud.d.querySelector('#toast').textContent, /Werk de KAAP-extensie bij naar versie 1\.2/);
    assert.equal(starts.length, 0);
    assert.match(oud.d.querySelector('#hulpTekst').textContent, /Werk bij naar versie 1\.2 voor BPM uit Autotelex/);
  });

  test('het voordeligste bedrag komt bij de kandidaat die open staat, met de uitvoering eronder, en wordt bewaard', async () => {
    const { w, d, G } = laadApp({ opslag: JSON.stringify({ kandidaten: [kandidaat], profielen: [] }) });
    const starts = extensie(w, '1.2.0'); w.hulpPing(); await wachtOpHulp(w);
    w.vulKandForm(G('S').kandidaten[0]);
    d.querySelector('#btnAtx').click(); await tik();
    assert.equal(starts.length, 1, 'de app vraagt de extensie AutotelexPRO te openen');
    assert.deepEqual(plain(starts[0].voertuig), { dag: 13, maand: 6, jaar: 2022, merk: '', model: '', oms: 'BMW X6 M50i', brandstof: 'benzine' }, 'met de gegevens voor de zoekvelden');
    assert.match(d.querySelector('#toast').textContent, /AutotelexPRO opent/);
    w.postMessage({ kaap: 'hulp-atx', id: starts[0].id, gegevens: g }, '*'); await tik();
    assert.equal(veld(w, 'k_bpmatx'), '20291');
    const k = G('S').kandidaten[0];
    assert.equal(k.bpmAtx, 20291); assert.equal(k.bpmAtxInfo.uitvoering, 'BMW X6 - M50i High Executive');
    assert.equal(JSON.parse(w.localStorage.getItem(SLEUTEL)).kandidaten[0].bpmAtx, 20291, 'bewaard');
    const blok = d.querySelector('#bpmOut').textContent;
    assert.match(blok, /BPM \(Autotelex\)€\s20\.291/);
    assert.match(blok, /Autotelex: BMW X6 - M50i High Executive \(13-06-2022\) · afschrijvingstabel €\s20\.291 · koerslijst €\s22\.808/);
    assert.match(d.querySelector('#toast').textContent, /BPM uit Autotelex: €\s20\.291 \(afschrijvingstabel\)/);
    // Bedrag met de hand gewijzigd: de Autotelex-regel hoort er dan niet meer bij.
    zet(w, 'k_bpmatx', '19000');
    assert.doesNotMatch(d.querySelector('#bpmOut').textContent, /Autotelex: BMW X6/);
    assert.equal(w.leesKandForm().bpmAtxInfo, null);
  });

  test('gekoppeld zoekprofiel: merk en het model dat in de omschrijving staat', async () => {
    const profiel = { id: 'p1', naam: 'X', merk: 'BMW', model: 'X5, X6', bjvan: 2021, bjtot: null, km: null, pk: null, pmin: null, pmax: null, aanbieder: '', deuren: '', btw: '', carr: [], brandstof: [], opties: [], uitv: '', uitvDe: '', modelDe: '', uitvNiet: '', sites: {} };
    const { w, d, G } = laadApp({ opslag: JSON.stringify({ kandidaten: [Object.assign({}, kandidaat, { profiel: 'p1' })], profielen: [profiel] }) });
    const starts = extensie(w, '1.2.0'); w.hulpPing(); await wachtOpHulp(w);
    w.vulKandForm(G('S').kandidaten[0]);
    d.querySelector('#btnAtx').click(); await tik();
    assert.equal(starts[0].voertuig.merk, 'BMW'); assert.equal(starts[0].voertuig.model, 'X6');
  });

  test('een antwoord voor een andere aanvraag wordt genegeerd', async () => {
    const { w, d, G } = laadApp({ opslag: JSON.stringify({ kandidaten: [kandidaat], profielen: [] }) });
    const starts = extensie(w, '1.2.0'); w.hulpPing(); await wachtOpHulp(w);
    w.vulKandForm(G('S').kandidaten[0]);
    d.querySelector('#btnAtx').click(); await tik();
    w.postMessage({ kaap: 'hulp-atx', id: 'iets-anders', gegevens: g }, '*'); await tik();
    assert.equal(veld(w, 'k_bpmatx'), '');
    assert.equal(G('S').kandidaten[0].bpmAtx, undefined);
    assert.equal(starts.length, 1);
  });
});

describe('Vervallen bladwijzers KAAP teller en KAAP kandidaat', () => {
  test('oude teller-bladwijzer: geen getal meer opgeslagen, wel uitleg', () => {
    const { w, d } = laadApp({ url: 'https://kaap.test/inkoop.html?teller=5&bv=2&bron=' + encodeURIComponent('https://www.gaspedaal.nl/bmw/x5') });
    assert.equal(w.location.search, '');
    assert.match(d.querySelector('#toast').textContent, /KAAP teller is vervallen/);
    assert.deepEqual(JSON.parse(w.localStorage.getItem(SLEUTEL) || '{"tellers":{}}').tellers || {}, {});
  });
  test('oude kandidaat-bladwijzer: de verkeerde prijs uit de bladwijzer wordt genegeerd, de app leest de advertentie zelf', async () => {
    const src = 'https://www.autoscout24.de/angebote/bmw-x5-voorbeeld';
    const { w, d, G } = laadApp({ fetch: nepProxy(), url: 'https://kaap.test/inkoop.html?add=1&bv=2&title=' + encodeURIComponent('BMW X5 in Gera für € 65.455') + '&price=654551&co2=180&ez=' + encodeURIComponent('03/2023') + '&km=59998&fuel=&src=' + encodeURIComponent(src) });
    assert.equal(w.location.search, '');
    assert.ok(d.querySelector('#tab-kandidaten').classList.contains('on'));
    assert.equal(veld(w, 'k_prijs'), '', 'de prijs 654551 uit de oude bladwijzer wordt niet overgenomen');
    assert.equal(veld(w, 'k_url'), src);
    await G('verrijkBezig');
    assert.equal(veld(w, 'k_prijs'), '65455'); assert.equal(veld(w, 'k_det'), '2023-03-01');
  });
});

// ---------------------------------------------------------------- tabbladen
describe('Opruimen van de vervallen bladwijzers', () => {
  test('bewaarde aantallen van KAAP teller verdwijnen uit de opslag; de rest blijft staan', () => {
    const profiel = { id: 'p1', naam: 'X5', merk: 'BMW', model: 'X5', bjvan: 2022, bjtot: null, km: null, pk: null, pmin: null, pmax: null, aanbieder: '', deuren: '', btw: '',
      carr: [], brandstof: [], opties: [], uitv: '', uitvDe: '', modelDe: '', uitvNiet: '', sites: { mobile: true } };
    const oud = { profielen: [profiel], kandidaten: [{ id: 'k1', oms: 'BMW X5', land: 'DE' }], tellers: { s1abc: { n: 516, d: 1 } }, instellingen: { doelmarge: 4000 } };
    const { w, G } = laadApp({ opslag: JSON.stringify(oud) });
    assert.equal(G('S').tellers, undefined);
    const bewaard = JSON.parse(w.localStorage.getItem(SLEUTEL));
    assert.equal('tellers' in bewaard, false, 'ook de bewaarde kopie is opgeruimd, zonder dat je iets hoeft te doen');
    assert.equal(bewaard.profielen.length, 1); assert.equal(bewaard.kandidaten[0].oms, 'BMW X5'); assert.equal(bewaard.instellingen.doelmarge, 4000);
  });
  test('zonder oude aantallen schrijft de app bij het laden niets weg', () => {
    const { w } = laadApp();
    assert.equal(w.localStorage.getItem(SLEUTEL), null);
  });
  test('de app biedt de vervallen bladwijzers nergens meer aan', () => {
    const { d } = laadApp();
    assert.equal(d.querySelector('#bookmarklet'), null); assert.equal(d.querySelector('#tellerlet'), null);
    assert.deepEqual([...d.querySelectorAll('a[draggable="true"]')].map(a => a.textContent), ['KAAP prijshistorie']);
  });
});

describe('Twee tabbladen overschrijven elkaar niet', () => {
  test('wat een ander tabblad bewaart, wordt overgenomen en blijft staan als dit tabblad verder werkt', () => {
    const { w, d } = laadApp();
    zet(w, 'p_merk', 'BMW');                                    // dit tabblad heeft een zoekopdracht open
    const ander = JSON.parse(w.localStorage.getItem(SLEUTEL));  // het andere tabblad bewaart een kandidaat
    ander.kandidaten.push({ id: 'k1', oms: 'Uit het andere tabblad', land: 'DE', prijs: 50000, btw: 'btw', status: 'nieuw', created: 1 });
    ander.concept = { merk: 'Audi', model: 'Q7' };
    w.localStorage.setItem(SLEUTEL, JSON.stringify(ander));
    w.dispatchEvent(new w.StorageEvent('storage', { key: SLEUTEL, newValue: JSON.stringify(ander) }));
    assert.match(d.querySelector('#kandTabel').textContent, /Uit het andere tabblad/);
    assert.match(d.querySelector('#toast').textContent, /Bijgewerkt vanuit een ander tabblad/);
    assert.equal(veld(w, 'p_merk'), 'BMW', 'het eigen formulier blijft staan');

    zet(w, 'p_model', 'X5');                                    // dit tabblad werkt verder en bewaart
    const na = JSON.parse(w.localStorage.getItem(SLEUTEL));
    assert.equal(na.kandidaten.length, 1, 'de kandidaat van het andere tabblad is niet overschreven');
    assert.equal(na.concept.merk, 'BMW'); assert.equal(na.concept.model, 'X5');
  });
  test('wijzigt in het andere tabblad alleen het zoekformulier, dan gebeurt hier niets zichtbaars', () => {
    const { w, d } = laadApp();
    zet(w, 'p_merk', 'BMW');
    const ander = JSON.parse(w.localStorage.getItem(SLEUTEL));
    ander.concept = { merk: 'Audi' };
    d.querySelector('#toast').textContent = '';
    w.localStorage.setItem(SLEUTEL, JSON.stringify(ander));
    w.dispatchEvent(new w.StorageEvent('storage', { key: SLEUTEL, newValue: JSON.stringify(ander) }));
    assert.equal(d.querySelector('#toast').textContent, '');
    assert.equal(w.eval('S.concept.merk'), 'BMW');
  });
  test('een melding over een andere sleutel wordt genegeerd', () => {
    const { w, d } = laadApp();
    d.querySelector('#toast').textContent = '';
    w.dispatchEvent(new w.StorageEvent('storage', { key: 'kaap_rdw', newValue: '{}' }));
    assert.equal(d.querySelector('#toast').textContent, '');
  });
});
