// Test voor KAAP Inkoop Radar (inkoop.html).
// Draaien:  npm install --save-dev jsdom   (eenmalig)
//           npm test            (of: node --test)
// Of met een ander bestand: INKOOP_HTML=pad/naar/bestand.html node --test
//
// Wat wordt getest:
//  1. BPM: referentiegevallen, met de hand uitgerekend uit de tarieftabellen in het bestand.
//  2. Afschrijving: forfaitaire tabel, maandgrens en resterende dagen.
//  3. Kostprijs: BTW-aftrek per land, transport en importkosten.
//  4. Zoeklinks: parameters per site voor een vast profiel (BMW X5 M Sport).
//  5. UI: versienummer op drie plekken gelijk, tabs, bewaren in localStorage.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const hier = dirname(fileURLToPath(import.meta.url));
const fixture = (naam) => readFileSync(resolve(hier, 'fixtures', naam), 'utf8');
const bestand = process.env.INKOOP_HTML || resolve(hier, '..', 'inkoop.html');
const html = readFileSync(bestand, 'utf8');

let w, d;   // window en document van de geladen app

function laadApp(){
  const vc = new VirtualConsole();
  const fouten = [];
  vc.on('jsdomError', e => fouten.push(e));
  const dom = new JSDOM(html, {
    url: 'https://kaap.test/inkoop.html',   // https-origin: localStorage werkt, bookmarklet-URL is netjes
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win){
      // Geen netwerk in de test: results.json en RDW worden nooit opgehaald.
      win.fetch = () => Promise.reject(new Error('geen netwerk in test'));
      win.scrollTo = () => {};
      win.HTMLElement.prototype.scrollIntoView = function(){};
    },
  });
  return { dom, fouten };
}

before(() => {
  const { dom, fouten } = laadApp();
  w = dom.window; d = w.document;
  assert.equal(fouten.length, 0, 'script laadt zonder fouten: ' + fouten.map(e => e.message).join('; '));
});

const D = (s) => new w.Date(s + 'T12:00:00');
// const/let uit het script staan niet op window; via eval in de pagina-scope ophalen.
const G = (naam) => w.eval(naam);
// Objecten uit de pagina hebben een ander prototype dan die van de test; voor deepEqual eerst platslaan.
const plain = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------- BPM
describe('BPM-berekening', () => {
  test('benzine WLTP 187 g, DET 15-03-2021, keuring 06-10-2026: tarief 2021 wint', () => {
    // 2021: 11438 + (187-172)*432 = 17918. 2022 t/m 2026 zijn allemaal hoger.
    // Afschrijving: 66 volle maanden + 21 dagen -> rij 66 mnd 67% + 1*0,42 = 67,42%.
    const r = w.berekenBpm({brandstof:'benzine', phev:false, co2w:187, co2n:null, det:D('2021-03-15'), keuring:D('2026-10-06')});
    assert.equal(r.fout, undefined);
    assert.equal(r.keuze.tabel.van, '2021-01-01');
    assert.equal(r.keuze.label, 'personenauto');
    assert.equal(r.bruto, 17918);
    assert.equal(r.afs.pct, 67.42);
    assert.equal(r.netto, Math.round(17918 * (100 - 67.42) / 100));   // 5838
    assert.equal(r.alle.length, 6);   // 2021..2026 komen alle zes in aanmerking
  });

  test('diesel WLTP 150 g, DET 01-06-2022, keuring 01-06-2025: dieseltoeslag uit tabel 2022', () => {
    // 2022: 2010 + (150-109)*137 = 7627; toeslag (150-75)*86,67 = 6500,25.
    // 36 maanden precies -> rij 30 mnd 51% + 6*0,5 = 54%.
    const r = w.berekenBpm({brandstof:'diesel', phev:false, co2w:150, co2n:null, det:D('2022-06-01'), keuring:D('2025-06-01')});
    assert.equal(r.keuze.tabel.van, '2022-01-01');
    assert.equal(r.basis, 7627);
    assert.equal(r.toeslag, 6500);
    assert.equal(r.bruto, 14127);
    assert.equal(r.afs.pct, 54);
    assert.equal(r.netto, Math.round(14127.25 * 0.46));   // 6499
  });

  test('PHEV benzine 45 g, DET 01-09-2023, keuring 01-03-2024: PHEV-tabel 2023', () => {
    // 2023 PHEV (WLTP-grenzen 34/60): 884 + (45-34)*91 = 1885; 2024 PHEV zou 952 + 11*100 = 2052 zijn.
    // 6 maanden -> rij 5 mnd 27% + 1*1,5 = 28,5%.
    const r = w.berekenBpm({brandstof:'hybride', phev:true, co2w:45, co2n:null, det:D('2023-09-01'), keuring:D('2024-03-01')});
    assert.equal(r.keuze.label, 'PHEV-tabel');
    assert.equal(r.keuze.tabel.van, '2023-01-01');
    assert.equal(r.bruto, 1885);
    assert.equal(r.afs.pct, 28.5);
    assert.equal(r.netto, Math.round(1885 * 0.715));   // 1348
  });

  test('PHEV in 2025 valt terug op de personenautotabel (geen PHEV-tabel meer)', () => {
    const r = w.berekenBpm({brandstof:'hybride', phev:true, co2w:45, co2n:null, det:D('2025-04-01'), keuring:D('2025-10-01')});
    assert.equal(r.keuze.label, 'personenauto');
    assert.equal(r.keuze.tabel.van, '2025-01-01');
    assert.equal(r.bruto, 667 + 45 * 2);   // 757
  });

  test('diesel-PHEV 40 g, DET 01-03-2022, keuring 01-09-2022: PHEV-tabel, toeslag nul onder de grens', () => {
    // 2022 PHEV: 816 + (40-34)*85 = 1326; dieseltoeslag max(0, 40-75) = 0.
    const r = w.berekenBpm({brandstof:'hybride_diesel', phev:true, co2w:40, co2n:null, det:D('2022-03-01'), keuring:D('2022-09-01')});
    assert.equal(r.keuze.label, 'PHEV-tabel');
    assert.equal(r.bruto, 1326);
    assert.equal(r.toeslag, 0);
    assert.equal(r.netto, Math.round(1326 * 0.715));   // 948
  });

  test('EV met DET in 2024 is vrijgesteld (nihiltarief), ook als de keuring in 2025 valt', () => {
    const r = w.berekenBpm({brandstof:'elektrisch', phev:false, co2w:null, co2n:null, det:D('2024-05-01'), keuring:D('2025-03-01')});
    assert.equal(r.keuze.label, 'nihiltarief');
    assert.equal(r.bruto, 0);
    assert.equal(r.netto, 0);
  });

  test('EV met DET in 2025 betaalt de vaste voet 2025 (667), afgeschreven', () => {
    // 10 maanden -> rij 9 mnd 33% + 1*1 = 34%.
    const r = w.berekenBpm({brandstof:'elektrisch', phev:false, co2w:null, co2n:null, det:D('2025-04-01'), keuring:D('2026-02-01')});
    assert.equal(r.keuze.label, 'vaste voet');
    assert.equal(r.bruto, 667);
    assert.equal(r.afs.pct, 34);
    assert.equal(r.netto, Math.round(667 * 0.66));   // 440
  });

  test('DET vóór 1 juli 2020 met alleen NEDC: alleen de NEDC-tabel telt mee', () => {
    // 2020-H1: 7277 + (140-133)*212 = 8761. Tabel 2020-H2 (WLTP) wordt overgeslagen zonder WLTP-waarde.
    // 6 maanden + 16 dagen -> rij 5 mnd 27% + 2*1,5 = 30%.
    const r = w.berekenBpm({brandstof:'benzine', phev:false, co2w:null, co2n:140, det:D('2020-05-15'), keuring:D('2020-12-01')});
    assert.equal(r.alle.length, 1);
    assert.equal(r.keuze.tabel.methode, 'NEDC');
    assert.equal(r.bruto, 8761);
    assert.equal(r.afs.pct, 30);
    assert.equal(r.netto, Math.round(8761 * 0.70));   // 6133
  });

  test('DET vóór 1 juli 2020 met NEDC én WLTP: beide tabellen vergeleken, NEDC wint hier', () => {
    // 2020-H2 WLTP: 7642 + (170-162)*204 = 9274 > 8761.
    const r = w.berekenBpm({brandstof:'benzine', phev:false, co2w:170, co2n:140, det:D('2020-05-15'), keuring:D('2020-12-01')});
    assert.equal(r.alle.length, 2);
    assert.equal(r.keuze.tabel.methode, 'NEDC');
    assert.equal(r.bruto, 8761);
  });

  test('foutmeldingen: geen datum, geen CO2, periode buiten de tabellen', () => {
    assert.match(w.berekenBpm({brandstof:'benzine', co2w:150, det:null, keuring:D('2026-01-01')}).fout, /Datum eerste toelating/);
    assert.match(w.berekenBpm({brandstof:'benzine', co2w:null, co2n:null, det:D('2022-01-01'), keuring:D('2026-01-01')}).fout, /CO2/);
    assert.match(w.berekenBpm({brandstof:'benzine', co2w:150, co2n:150, det:D('2015-01-01'), keuring:D('2016-01-01')}).fout, /Geen tarieftabel/);
  });
});

describe('Forfaitaire afschrijving', () => {
  test('grenzen van de tabel', () => {
    assert.equal(w.afschrijvingPct(D('2026-01-01'), D('2026-01-01')).pct, 0);
    assert.equal(w.afschrijvingPct(D('2026-01-01'), D('2026-01-10')).pct, 12);      // 0 mnd + dagen -> 1 stap van 12%
    assert.equal(w.afschrijvingPct(D('2026-01-01'), D('2026-02-01')).pct, 12);      // precies 1 maand
    assert.equal(w.afschrijvingPct(D('2026-01-01'), D('2026-02-02')).pct, 16);      // 1 maand + 1 dag
    assert.equal(w.afschrijvingPct(D('2016-01-01'), D('2026-01-01')).pct, 81 + 6 * 0.19);   // 120 mnd
  });
  test('loopt nooit boven 100%', () => {
    assert.equal(w.afschrijvingPct(D('2000-01-01'), D('2026-01-01')).pct, 100);
  });
});

describe('Kostprijs', () => {
  test('BTW-auto uit Duitsland: prijs gedeeld door 1,19 plus transport, import en BPM', () => {
    const kp = w.kostprijs({prijs:60000, land:'DE', btw:'btw'}, {netto:5838});
    assert.ok(Math.abs(kp.netto - 60000 / 1.19) < 0.01);
    assert.equal(kp.transport, 400);
    assert.equal(kp.imp, 250);
    assert.equal(kp.bpm, 5838);
    assert.ok(Math.abs(kp.totaal - (60000 / 1.19 + 400 + 250 + 5838)) < 0.01);
  });
  test('margeauto: geen BTW-aftrek', () => {
    assert.equal(w.kostprijs({prijs:60000, land:'BE', btw:'marge'}, {netto:1000}).netto, 60000);
  });
  test('NL-auto: geen BPM, geen importkosten', () => {
    const kp = w.kostprijs({prijs:50000, land:'NL', btw:'btw'}, {fout:'x'});
    assert.equal(kp.bpm, 0); assert.equal(kp.imp, 0); assert.equal(kp.transport, 0);
    assert.ok(Math.abs(kp.totaal - 50000 / 1.21) < 0.01);
  });
  test('BPM onbekend: geen totaal', () => {
    assert.equal(w.kostprijs({prijs:50000, land:'DE', btw:'btw'}, {fout:'x'}).totaal, null);
  });
});

describe('Ophaler-status en bladwijzerversie (v1.41, v1.42)', () => {
  const nu = new Date('2026-09-22T12:00:00Z').getTime();
  const res = (urenGeleden, fouten) => ({generated: new Date(nu - urenGeleden * 3600000).toISOString(),
    profiles: {p1: {sites: {'as24nl:0': {items: [], error: fouten ? 'HTTP 503' : null}, 'marktplaats:0': {items: []}}}}});
  test('groen binnen 3 uur, oranje tot 24 uur, rood daarna', () => {
    assert.equal(w.ophaalStatus(res(1), nu).klasse, 'ok');
    assert.equal(w.ophaalStatus(res(5), nu).klasse, 'warn');
    assert.equal(w.ophaalStatus(res(30), nu).klasse, 'bad');
  });
  test('een site met een fout maakt een verse run oranje', () => {
    const st = w.ophaalStatus(res(1, true), nu);
    assert.equal(st.klasse, 'warn');
    assert.match(st.tekst, /1 site met een fout/);
  });
  test('geen results.json: grijs met uitleg', () => {
    assert.equal(w.ophaalStatus({leeg: true}, nu).klasse, '');
    assert.match(w.ophaalStatus({leeg: true}, nu).tekst, /geen results.json/);
    assert.equal(w.ophaalStatus(null, nu).klasse, '');
  });
  test('bolletje in de kop volgt de status', () => {
    const el = d.querySelector('#ophaalStatus');
    assert.ok(el, 'bolletje aanwezig');
    // zetOphaalStatus gebruikt de echte klok; daarom hier een run van een uur geleden ten opzichte van nu.
    const vers = {generated: new Date(Date.now() - 3600000).toISOString(), profiles: {}};
    w.eval('RES = ' + JSON.stringify(vers) + '; zetOphaalStatus();');
    assert.ok(el.classList.contains('ok'), el.className);
    assert.match(el.title, /Ophaler: laatste run/);
    w.eval('RES = null; zetOphaalStatus();');
  });
  test('bladwijzers sturen hun versie mee; een oudere bladwijzer geeft een melding', () => {
    const bv = G('BLADWIJZER_VERSIE');
    assert.ok(bv >= 2);
    assert.ok(d.querySelector('#histlet').getAttribute('href').includes('&bv=' + bv), 'prijshistorie-bladwijzer stuurt zijn versie mee');
    assert.equal(w.bladwijzerVerouderd(new w.URLSearchParams('add=1&bv=' + bv)), '');
    assert.match(w.bladwijzerVerouderd(new w.URLSearchParams('add=1')), /verouderd \(versie 1/);
    assert.match(w.bladwijzerVerouderd(new w.URLSearchParams('add=1&bv=1')), /verouderd/);
    assert.equal(d.querySelector('#bwVersie').textContent, 'v' + bv);
  });
});

describe('Prijsbenchmark (v1.39)', () => {
  const items = [
    {price: 60000, ez: '2021-03'}, {price: 62000, ez: '2021-05'}, {price: 65000, ez: '2021-01'}, {price: 70000, ez: '2021-09'},
    {price: 45000, ez: '2021-02'},   // −27% onder de mediaan van 2021
    {price: 40000, ez: '2019-06'},   // 2019: maar één auto, geen oordeel
    {price: 50000, ez: null},        // zonder bouwjaar telt niet mee
  ];
  test('index per model en bouwjaar, gesorteerd', () => {
    const idx = w.prijsIndex([{model: 'X5', items}]);
    assert.deepEqual(plain(idx['x5|2021']), [45000, 60000, 62000, 65000, 70000]);
    assert.deepEqual(plain(idx['x5|2019']), [40000]);
    assert.equal(Object.keys(idx).length, 2);
  });
  test('mediaan (oneven aantal) en drempel van 15%', () => {
    G('S').instellingen.scherpPct = 15;
    const idx = w.prijsIndex([{model: 'X5', items}]);
    const s = w.scherpPrijs(items[4], 'X5', idx);
    assert.equal(s.mediaan, 62000);
    assert.equal(s.pct, 27);
    assert.equal(s.n, 5);
    assert.equal(w.scherpPrijs(items[0], 'X5', idx), null);   // 60000 is maar 3% onder de mediaan
    assert.equal(w.scherpPrijs(items[5], 'X5', idx), null);   // 2019: te weinig auto's
    assert.equal(w.scherpPrijs(items[4], 'X3', idx), null);   // ander model: geen index
  });
  test('mediaan bij even aantal is het gemiddelde van de middelste twee', () => {
    const idx = w.prijsIndex([{model: 'X5', items: items.slice(0, 4).concat([{price: 30000, ez: '2021-01'}, {price: 30000, ez: '2021-01'}])}]);
    // gesorteerd: 30000, 30000, 60000, 62000, 65000, 70000 -> mediaan 61000
    assert.equal(w.scherpPrijs({price: 30000, ez: '2021-01'}, 'X5', idx).mediaan, 61000);
  });
  test('drempel uit Instellingen wordt gebruikt', () => {
    const idx = w.prijsIndex([{model: 'X5', items}]);
    G('S').instellingen.scherpPct = 30;
    assert.equal(w.scherpPrijs(items[4], 'X5', idx), null);
    G('S').instellingen.scherpPct = 15;
  });
  test('resultaatkaart toont het label', () => {
    const idx = w.prijsIndex([{model: 'X5', items}]);
    const kaart = w.resKaart({title: 'BMW X5', url: 'https://x.test/1', price: 45000, ez: '2021-02', fuel: 'benzine'}, 'DE', false, null, {}, {model: 'X5', prijsIdx: idx});
    assert.ok(kaart.textContent.includes('scherp: −27% t.o.v. mediaan 2021'), kaart.textContent);
    const gewoon = w.resKaart({title: 'BMW X5', url: 'https://x.test/2', price: 62000, ez: '2021-02', fuel: 'benzine'}, 'DE', false, null, {}, {model: 'X5', prijsIdx: idx});
    assert.ok(!gewoon.textContent.includes('scherp'));
  });
});

describe('Koerslijst-afschrijving (v1.38)', () => {
  const basis = {brandstof:'benzine', phev:false, co2w:187, co2n:null, det:'2021-03-15', keuring:'2026-10-06'};
  test('zonder percentage: alleen forfaitair, kostprijs gebruikt het forfaitaire bedrag', () => {
    const r = w.bpmVoor(Object.assign({}, basis, {afs:null}));
    assert.equal(r.netto, 5838);
    assert.equal(r.nettoKoers, undefined);
    assert.equal(G('bpmTeBetalen')(r), 5838);
  });
  test('met 75%: tweede uitkomst op dezelfde bruto, forfaitair blijft staan', () => {
    const r = w.bpmVoor(Object.assign({}, basis, {afs:75}));
    assert.equal(r.bruto, 17918);
    assert.equal(r.netto, 5838);                    // forfaitair onveranderd
    assert.equal(r.nettoKoers, Math.round(17918 * 0.25));   // 4480 (4479,5 rondt af naar boven)
    assert.equal(G('bpmTeBetalen')(r), 4480);
    const kp = w.kostprijs({prijs:60000, land:'DE', btw:'btw'}, r);
    assert.equal(kp.bpm, 4480);
  });
  test('ongeldig percentage wordt genegeerd', () => {
    assert.equal(w.bpmVoor(Object.assign({}, basis, {afs:120})).nettoKoers, undefined);
    assert.equal(w.bpmVoor(Object.assign({}, basis, {afs:-5})).nettoKoers, undefined);
  });
  test('legenda onder het balkje noemt het gebruikte percentage', () => {
    const zet = (id, v, ev) => { const e = d.querySelector('#' + id); e.value = v; e.dispatchEvent(new w.Event(ev || 'input', {bubbles:true})); };
    d.querySelector('#btnNieuwKand').click();
    zet('k_prijs', '60000'); zet('k_det', '2021-03-15'); zet('k_keuring', '2026-10-06'); zet('k_brandstof', 'benzine', 'change'); zet('k_co2w', '187');
    assert.match(d.querySelector('#bpmOut .legend').textContent, /afschrijving 67\.42%/);
    zet('k_afs', '72');
    const leg = d.querySelector('#bpmOut .legend').textContent;
    assert.match(leg, /te betalen 28%/);
    assert.match(leg, /afschrijving koerslijst 72%/);
    d.querySelector('#btnNieuwKand').click();
  });
  test('bij een BPM-fout geen bedrag', () => {
    assert.equal(G('bpmTeBetalen')({fout:'x'}), null);
    assert.equal(G('bpmTeBetalen')(null), null);
  });
});

describe('Marge (v1.37)', () => {
  test('BTW-auto: 21% over de verkoop, marge = verkoop excl. − kostprijs', () => {
    const kp = {totaal: 56908};
    const mg = w.margeVoor({verkoop: 79950, btw: 'btw', prijs: 60000}, kp);
    assert.ok(Math.abs(mg.btw - (79950 - 79950 / 1.21)) < 0.01);
    assert.ok(Math.abs(mg.marge - (79950 / 1.21 - 56908)) < 0.01);   // ≈ 9.166
    assert.ok(Math.abs(mg.pct - mg.marge / 56908 * 100) < 0.01);
  });
  test('margeauto: BTW alleen over verkoop − inkoop (margeregeling)', () => {
    const mg = w.margeVoor({verkoop: 70000, btw: 'marge', prijs: 60000}, {totaal: 66488});
    assert.ok(Math.abs(mg.btw - 10000 * 21 / 121) < 0.01);            // 1.735,54
    assert.ok(Math.abs(mg.marge - (70000 - 10000 * 21 / 121 - 66488)) < 0.01);
  });
  test('zonder verkoopprijs of zonder kostprijs: geen marge', () => {
    assert.equal(w.margeVoor({verkoop: null, btw: 'btw', prijs: 60000}, {totaal: 1}), null);
    assert.equal(w.margeVoor({verkoop: 70000, btw: 'btw', prijs: 60000}, {totaal: null}), null);
  });
  test('kleur op de doelmarge', () => {
    G('S').instellingen.doelmarge = 3000;
    assert.equal(w.margeKleur(3000), 'gekocht');
    assert.equal(w.margeKleur(2999), 'bod');
    assert.equal(w.margeKleur(-1), 'afgewezen');
    assert.equal(w.margeKleur(null), '');
  });
});

// ---------------------------------------------------------------- Zoeklinks
function profiel(extra){
  const sites = {}; for (const k of Object.keys(G('SITES'))) sites[k] = true;
  return Object.assign({
    naam:'', merk:'BMW', model:'X5', bjvan:2020, bjtot:null, km:100000, kw:200, pmin:50000, pmax:90000,
    aanbieder:'', deuren:'', btw:'', carr:[], brandstof:[], opties:['sportpakket'],
    uitv:'M Sport', uitvDe:'M Sportpaket', modelDe:'', uitvNiet:'', sites,
  }, extra || {});
}
const linkVan = (links, site) => links.find(l => l.site === site);
const params = (url) => new w.URL(url).searchParams;

describe('Zoeklinks per site', () => {
  let links;
  before(() => { links = w.bouwLinks(profiel()); });

  test('elke aangevinkte site levert precies één link; Gocar en Vroom missen zonder geplakte URL', () => {
    assert.equal(links.length, Object.keys(G('SITES')).length);
    assert.equal(linkVan(links, 'gocar').status, 'miss');
    assert.equal(linkVan(links, 'vroom').status, 'miss');
    assert.equal(linkVan(links, 'gocar').url, '');
  });

  test('mobile.de: merk-ID 3500, Duits zoekwoord, automaat, jaar/km/prijs, sportpakket', () => {
    const l = linkVan(links, 'mobile'); const q = params(l.url);
    assert.ok(l.url.startsWith('https://suchen.mobile.de/fahrzeuge/search.html?'));
    assert.equal(q.get('ms'), '3500;;;M Sportpaket');   // merk zonder model: "3500;" + ";;" + zoekwoord
    assert.equal(l.status, 'warn');                       // model niet gekoppeld
    assert.equal(q.get('tr'), 'AUTOMATIC_GEAR');
    assert.equal(q.get('fr'), '2020:');
    assert.equal(q.get('ml'), ':100000');
    assert.equal(q.get('p'), '50000:90000');
    assert.equal(q.get('pw'), '200:');   // kW, live nagemeten 22-09-2026
    assert.deepEqual(q.getAll('fe'), ['SPORT_PACKAGE']);
    assert.equal(q.get('vat'), null);
    assert.equal(params(linkVan(w.bouwLinks(profiel({kw:null})), 'mobile').url).get('pw'), null);
  });

  test('mobile.de: BTW-filter vat=1, marge vat=0, dealer st=DEALER', () => {
    assert.equal(params(linkVan(w.bouwLinks(profiel({btw:'btw'})), 'mobile').url).get('vat'), '1');
    assert.equal(params(linkVan(w.bouwLinks(profiel({btw:'marge'})), 'mobile').url).get('vat'), '0');
    assert.equal(params(linkVan(w.bouwLinks(profiel({aanbieder:'dealer'})), 'mobile').url).get('st'), 'DEALER');
    assert.equal(params(linkVan(w.bouwLinks(profiel({aanbieder:'particulier'})), 'mobile').url).get('st'), 'FSBO');
  });

  test('mobile.de zonder bekend merk: status miss', () => {
    const l = linkVan(w.bouwLinks(profiel({merk:'Onbekendmerk'})), 'mobile');
    assert.equal(l.status, 'miss'); assert.equal(l.url, '');
  });

  test('AutoScout24 NL/DE/BE: pad merk/model, landcode, automaat, kW, sportpakket, versie', () => {
    const verwacht = {as24nl:['https://www.autoscout24.nl/lst/bmw/x5', 'NL'], as24de:['https://www.autoscout24.de/lst/bmw/x5', 'D'], as24be:['https://www.autoscout24.be/nl/lst/bmw/x5', 'B']};
    for (const [site, [basis, cy]] of Object.entries(verwacht)){
      const l = linkVan(links, site); const u = new w.URL(l.url);
      assert.equal(u.origin + u.pathname, basis, site);
      const q = u.searchParams;
      assert.equal(q.get('cy'), cy, site);
      assert.equal(q.get('atype'), 'C'); assert.equal(q.get('gear'), 'A');
      assert.equal(q.get('damaged_listing'), 'exclude');
      assert.equal(q.get('fregfrom'), '2020'); assert.equal(q.get('fregto'), null);
      assert.equal(q.get('kmto'), '100000');
      assert.equal(q.get('pricefrom'), '50000'); assert.equal(q.get('priceto'), '90000');
      assert.equal(q.get('powertype'), 'kw'); assert.equal(q.get('powerfrom'), '200');
      assert.equal(q.get('eq'), '112');
      assert.equal(q.get('version'), 'M Sport');
      assert.equal(q.get('custtype'), null);
    }
  });

  test('AutoScout24: Engelse modelnamen en deurenfilter', () => {
    assert.equal(w.as24Slug('5 Serie'), '5-series');
    assert.equal(w.as24Slug('V-Klasse'), 'v-class');
    assert.equal(w.as24Slug('RS 6'), 'rs6');
    assert.equal(w.as24Slug('Range Rover Sport'), 'range-rover-sport');
    const q = params(linkVan(w.bouwLinks(profiel({deuren:'45'})), 'as24nl').url);
    assert.equal(q.get('doorfrom'), '4'); assert.equal(q.get('doorto'), '5');
  });

  test('Marktplaats: hash-URL met f:-attributen, prijs in centen, zoekwoord; API-URL voor de ophaler', () => {
    const l = linkVan(links, 'marktplaats');
    assert.ok(l.url.startsWith('https://www.marktplaats.nl/l/auto-s/bmw/#'), l.url);
    const hash = l.url.split('#')[1];
    assert.match(hash, /^f:534,10882,11797\|/);
    assert.ok(hash.includes('constructionYearFrom:2020'));
    assert.ok(hash.includes('mileageTo:100000'));
    assert.ok(hash.includes('PriceCentsFrom:5000000|PriceCentsTo:9000000'));
    assert.ok(hash.includes('q:X5+M+Sport'));
    const a = new w.URL(l.apiUrl);
    assert.equal(a.origin + a.pathname, 'https://www.marktplaats.nl/lrp/api/search');
    assert.equal(a.searchParams.get('l1CategoryId'), '91');
    assert.equal(a.searchParams.get('l2CategoryId'), '96');
    assert.deepEqual(a.searchParams.getAll('attributesById[]'), ['534', '10882', '11797']);
    assert.deepEqual(a.searchParams.getAll('attributeRanges[]'), ['constructionYear:2020:', 'mileage::100000', 'PriceCents:5000000:9000000']);
    assert.equal(a.searchParams.get('query'), 'X5 M Sport');
    assert.equal(a.searchParams.get('limit'), '50');
    assert.deepEqual(plain(l.resolve), {host:'https://www.marktplaats.nl', pad:'auto-s', merkSlug:'bmw', model:'X5'});
  });

  test('Marktplaats: BTW-filter 13149, dealer 10899, deuren 172', () => {
    const l = linkVan(w.bouwLinks(profiel({btw:'btw', aanbieder:'dealer', deuren:'45'})), 'marktplaats');
    assert.match(l.url.split('#')[1], /^f:534,10882,10899,13149,172,11797\|/);
  });

  test('2dehands en 2ememain: zelfde opbouw, eigen host en pad', () => {
    assert.ok(linkVan(links, 'twodehands').url.startsWith('https://www.2dehands.be/l/auto-s/bmw/#'));
    assert.ok(linkVan(links, 'twoememain').url.startsWith('https://www.2ememain.be/l/autos/bmw/#'));
    assert.ok(linkVan(links, 'twodehands').apiUrl.startsWith('https://www.2dehands.be/lrp/api/search?'));
  });

  test('Kleinanzeigen: prijs in pad, model als zoekwoord, merk/jaar/km/PS/automaat als attributen', () => {
    const l = linkVan(links, 'kleinanzeigen');
    // 200 kW = 272 PS; live nagemeten 22-09-2026
    assert.equal(l.url, 'https://www.kleinanzeigen.de/s-autos/preis:50000:90000/x5-m-sportpaket/k0c216+autos.marke_s:bmw+autos.ez_i:2020,+autos.km_i:,100000+autos.power_i:272,+autos.getriebe_s:automatik');
    assert.ok(!linkVan(w.bouwLinks(profiel({kw:null})), 'kleinanzeigen').url.includes('power_i'));
  });

  test('Kleinanzeigen: Duitse modelnaam gaat voor, één brandstof wordt meegestuurd, twee niet', () => {
    const l1 = linkVan(w.bouwLinks(profiel({model:'5 Serie', modelDe:'5er', brandstof:['diesel']})), 'kleinanzeigen');
    assert.ok(l1.url.includes('/5er-m-sportpaket/'), l1.url);
    assert.ok(l1.url.includes('+autos.fuel_s:diesel'));
    const l2 = linkVan(w.bouwLinks(profiel({brandstof:['diesel', 'benzine']})), 'kleinanzeigen');
    assert.ok(!l2.url.includes('autos.fuel_s'));
    assert.match(l2.note, /Meerdere brandstoffen/);
  });

  test('Gaspedaal: merk/model en automaat in het pad, jaar/km/prijs als parameters, status warn', () => {
    const l = linkVan(links, 'gaspedaal'); const u = new w.URL(l.url);
    assert.equal(u.origin + u.pathname, 'https://www.gaspedaal.nl/bmw/x5/automatisch');   // live nagemeten 03-10-2026
    assert.equal(new w.URL(linkVan(w.bouwLinks(profiel({model: ''})), 'gaspedaal').url).pathname, '/bmw/automatisch');
    assert.equal(u.searchParams.get('bmin'), '2020'); assert.equal(u.searchParams.get('kmax'), '100000');
    assert.equal(u.searchParams.get('pmin'), '50000'); assert.equal(u.searchParams.get('pmax'), '90000');
    assert.equal(u.searchParams.get('srt'), 'dt-d');
    assert.equal(l.status, 'warn');
  });

  test('Bilbasen: alleen merk/model', () => {
    assert.equal(linkVan(links, 'bilbasen').url, 'https://www.bilbasen.dk/brugt/bil/bmw/x5');
  });

  test('meerdere modellen: X3, X5 geeft per model een eigen set links', () => {
    const ls = w.bouwLinks(profiel({model:'X3, X5'}));
    assert.equal(ls.length, 2 * Object.keys(G('SITES')).length);
    assert.equal(ls.filter(l => l.model === 'X3').length, Object.keys(G('SITES')).length);
  });

  test('meerdere uitvoeringen: per zoekwoord een link, Duits zoekwoord alleen op DE-sites', () => {
    const ls = w.bouwLinks(profiel({uitv:'M Sport, M50i', uitvDe:'M Sportpaket, M50i', sites:{mobile:true, as24nl:true}}));
    assert.equal(ls.length, 4);
    assert.deepEqual(plain(ls.filter(l => l.site === 'mobile').map(l => l.variant)), ['M Sportpaket', 'M50i']);
    assert.deepEqual(plain(ls.filter(l => l.site === 'as24nl').map(l => l.variant)), ['M Sport', 'M50i']);
  });

  test('model-koppeling leren uit een geplakte mobile.de-URL', () => {
    const r = w.leerKoppeling('mobile', 'https://suchen.mobile.de/fahrzeuge/search.html?ms=3500;20;;&s=Car', 'BMW', 'X5');
    assert.equal(r.ok, true, r.msg);
    const l = linkVan(w.bouwLinks(profiel()), 'mobile');
    assert.equal(params(l.url).get('ms'), '3500;20;;M Sportpaket');
    assert.equal(l.status, 'ok');
    delete G('S').instellingen.koppelingen['mobile|bmw|x5']; w.bewaar();
  });

  test('model-koppeling weigert een mobile.de-URL zonder model', () => {
    const r = w.leerKoppeling('mobile', 'https://suchen.mobile.de/fahrzeuge/search.html?ms=3500;;;', 'BMW', 'X5');
    assert.equal(r.ok, false);
  });
});

// ---------------------------------------------------------------- Proxy en parsers (v1.36)
describe('Proxy en parserstatus', () => {
  test('proxy-adres krijgt de sleutel alleen mee als die is ingesteld', () => {
    const S = G('S');
    S.instellingen.proxy = 'https://kaap-proxy.test/'; S.instellingen.proxyKey = '';
    assert.equal(w.proxyAdres('https://www.marktplaats.nl/x?a=1'), 'https://kaap-proxy.test/?url=https%3A%2F%2Fwww.marktplaats.nl%2Fx%3Fa%3D1');
    S.instellingen.proxyKey = 'geheim 1';
    assert.equal(w.proxyAdres('https://www.marktplaats.nl/x'), 'https://kaap-proxy.test/?url=https%3A%2F%2Fwww.marktplaats.nl%2Fx&k=geheim%201');
    S.instellingen.proxyKey = ''; w.bewaar();
  });

  test('parsers melden een gewijzigde pagina-opbouw in plaats van een kale JavaScript-fout', () => {
    assert.throws(() => w.parseerLrp('<html>blokkade</html>', 'https://www.marktplaats.nl'), /pagina-opbouw gewijzigd/);
    assert.throws(() => w.parseerAs24('<html>geen next-data</html>', 'https://www.autoscout24.nl'), /pagina-opbouw gewijzigd/);
    assert.throws(() => w.parseerKleinanzeigen('<html>leeg</html>'), /pagina-opbouw gewijzigd/);
    assert.equal(w.parseerKleinanzeigen('<html>0 Ergebnisse</html>').count, 0);   // echte nul is geen fout
  });

  test('sitestatus onthoudt het laatste succes en zet het bij een latere fout', () => {
    w.noteerSiteStatus('as24nl', null);
    assert.ok(G('S').sitestatus.as24nl.ok > 0);
    assert.match(w.foutMetHistorie('as24nl', 'HTTP 503.'), /^HTTP 503\. Laatst gelukt: \d{2}-\d{2}-\d{4}/);
    assert.match(w.foutMetHistorie('as24be', 'HTTP 503.'), /Nog nooit gelukt/);
    w.noteerSiteStatus('as24nl', 'HTTP 503.');
    assert.equal(G('S').sitestatus.as24nl.fout, 'HTTP 503.');
    assert.ok(G('S').sitestatus.as24nl.ok > 0, 'laatste succes blijft bewaard');
    w.renderSiteStatus();
    assert.ok(d.querySelector('#siteStatus').textContent.includes('fout'));
    delete G('S').sitestatus.as24nl; w.bewaar();
  });
});

// ---------------------------------------------------------------- Donker thema (v1.43)
describe('Donker thema zoals KAAP Studio', () => {
  test('kleuren en kleurschema van Studio staan in :root', () => {
    const css = d.querySelector('style').textContent;
    assert.match(css, /color-scheme:dark/);
    for (const [naam, waarde] of [['--bg','#0a0c10'], ['--card','#141821'], ['--line','#252c3a'], ['--text','#eef1f6'], ['--sel','#6b93ff']])
      assert.ok(css.includes(`${naam}:${waarde}`), `${naam} = ${waarde}`);
    assert.equal(d.querySelector('meta[name=theme-color]').content, '#0a0c10');
  });
  test('geen externe stylesheet meer (Google Fonts weg), alles in één bestand', () => {
    assert.equal(d.querySelectorAll('link[rel=stylesheet], link[rel=preconnect]').length, 0);
  });
  test('kop met ingebouwd KAAP-logo, merknaam en versie', () => {
    const img = d.querySelector('header.top .brand img');
    assert.ok(img.getAttribute('src').startsWith('data:image/png;base64,'), 'logo zit in het bestand');
    assert.equal(img.alt, 'KAAP Auto House');
    assert.equal(d.querySelector('.brand span').textContent, 'Inkoop Radar');
    assert.ok(d.querySelector('.top-r #ophaalStatus'), 'statusbolletje in de kop');
  });
  test('klik op het versienummer opent de wijzigingsgeschiedenis', () => {
    d.querySelector('#ver').click();
    assert.ok(d.querySelector('#histVenster').classList.contains('on'));
    assert.ok(d.querySelector('#histLijst').textContent.includes('v' + G('APP_VERSIE')));
    d.querySelector('#histSluit').click();
  });
  test('geen losse lichte kleuren meer in de app (bladwijzer op de externe site uitgezonderd)', () => {
    const script = [...d.querySelectorAll('script')].map(x => x.textContent).join('');
    const zonderBladwijzer = script.replace(/const histCode = `[\s\S]*?`;/, '');
    assert.ok(!/#D9D2C8|#F3F0EB|#FFFFFF/i.test(zonderBladwijzer + d.body.innerHTML.replace(/<script[\s\S]*<\/script>/, '')));
  });
});

// ---------------------------------------------------------------- UI
describe('UI en opslag', () => {
  test('versienummer staat op drie plekken en is overal gelijk', () => {
    const kop = d.querySelector('#ver').textContent.trim();
    assert.equal(kop, 'v' + G('APP_VERSIE'));
    assert.equal(G('VERSIES')[0][0], G('APP_VERSIE'));
    assert.equal(d.title, 'KAAP Inkoop Radar');
  });

  test('versienummers in de geschiedenis zijn uniek en aflopend', () => {
    const vs = G('VERSIES').map(v => v[0]);
    assert.equal(new Set(vs).size, vs.length, 'dubbel versielabel');
    for (let i = 1; i < vs.length; i++) assert.ok(parseFloat(vs[i - 1]) > parseFloat(vs[i]), `${vs[i - 1]} > ${vs[i]}`);
  });

  test('drie tabs, standaard Zoeken open', () => {
    assert.deepEqual([...d.querySelectorAll('nav button')].map(b => b.dataset.tab), ['profielen', 'kandidaten', 'instellingen']);
    assert.ok(d.querySelector('#tab-profielen').classList.contains('on'));
    w.toonTab('kandidaten');
    assert.ok(d.querySelector('#tab-kandidaten').classList.contains('on'));
    assert.ok(!d.querySelector('#tab-profielen').classList.contains('on'));
    w.toonTab('profielen');
  });

  test('BPM-tabellen zijn de officiële set 2017 t/m 2026, aaneengesloten', () => {
    const t = G('BPM_TABELLEN');
    assert.equal(t[0].van, '2017-01-01');
    assert.equal(t[t.length - 1].tot, '2026-12-31');
    for (let i = 1; i < t.length; i++){
      const vorig = new w.Date(t[i - 1].tot), dit = new w.Date(t[i].van);
      assert.equal(dit - vorig, 86400000, `gat of overlap tussen ${t[i - 1].tot} en ${t[i].van}`);
    }
  });

  test('profiel invullen, links verschijnen, bewaren komt in localStorage', () => {
    const zet = (id, v) => { const e = d.querySelector('#' + id); e.value = v; e.dispatchEvent(new w.Event('input', {bubbles:true})); };
    zet('p_merk', 'BMW'); zet('p_model', 'X5'); zet('p_bjvan', '2020'); zet('p_pmin', '50000'); zet('p_km', '100000');
    assert.ok(d.querySelectorAll('#linkLijst .lnk').length >= 5, 'linkkaarten zichtbaar');
    d.querySelector('#btnBewaarProfiel').click();
    const opslag = JSON.parse(w.localStorage.getItem('kaap_inkoop_v1'));
    assert.equal(opslag.profielen.length, 1);
    assert.equal(opslag.profielen[0].merk, 'BMW');
    assert.equal(opslag.profielen[0].pmin, 50000);
    assert.equal(opslag.profielen[0].km, 100000);
    assert.equal(opslag.profielen[0].naam, 'BMW X5 2020+');
    assert.deepEqual(opslag.geschiedenis.bmw.uitv, []);
  });

  test('kandidaat: formulier rekent BPM en kostprijs, bewaren vult de tabel', () => {
    const zet = (id, v, ev) => { const e = d.querySelector('#' + id); e.value = v; e.dispatchEvent(new w.Event(ev || 'input', {bubbles:true})); };
    d.querySelector('#btnNieuwKand').click();
    zet('k_oms', 'BMW X5 xDrive45e M Sport'); zet('k_land', 'DE', 'change'); zet('k_prijs', '60000');
    zet('k_det', '2021-03-15'); zet('k_keuring', '2026-10-06'); zet('k_brandstof', 'benzine', 'change'); zet('k_co2w', '187');
    const uit = d.querySelector('#bpmOut').textContent;
    assert.ok(uit.includes('5.838'), 'te betalen BPM 5.838 in beeld: ' + uit.slice(0, 200));
    assert.ok(uit.includes('17.918'), 'bruto 17.918 in beeld');
    zet('k_verkoop', '79950');
    const met = d.querySelector('#bpmOut').textContent;
    assert.ok(met.includes('Marge'), 'margeblok zichtbaar');
    assert.ok(met.includes('9.166'), 'marge ≈ 9.166 in beeld: ' + met.slice(-300));   // 79950/1,21 − (60000/1,19 + 400 + 250 + 5838)
    d.querySelector('#btnBewaarKand').click();
    assert.equal(d.querySelectorAll('#kandTabel tbody tr').length, 1);
    assert.ok(d.querySelector('#kandTabel tbody tr').textContent.includes('9.166'), 'marge in de tabel');
    const k = JSON.parse(w.localStorage.getItem('kaap_inkoop_v1')).kandidaten;
    assert.equal(k.length, 1);
    assert.equal(k[0].verkoop, 79950);
  });

  test('export van profiles.json bevat de links en de API-URL voor de ophaler', () => {
    let gedownload = null;
    w.URL.createObjectURL = (b) => { gedownload = b; return 'blob:x'; };
    w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function(){};
    w.exportProfiles();
    assert.ok(gedownload, 'download gestart');
    return gedownload.text().then(t => {
      const j = JSON.parse(t);
      assert.equal(j.app, G('APP_VERSIE'));
      assert.equal(j.profiles.length, 1);
      const mp = j.profiles[0].links.find(l => l.site === 'marktplaats');
      assert.ok(mp.apiUrl.includes('attributesById%5B%5D='), 'attributesById[] (URL-gecodeerd) in de API-URL');
      assert.equal(mp.poll, true);
    });
  });

  test('alleen de prijshistorie-bladwijzer bestaat nog en is gevuld met de app-URL', () => {
    const href = d.querySelector('#histlet').getAttribute('href');
    assert.ok(href.startsWith('javascript:'));
    assert.ok(href.includes('https://kaap.test/inkoop.html'), 'bevat de app-URL');
    assert.equal(d.querySelector('#bookmarklet'), null, 'KAAP kandidaat is vervallen');
    assert.equal(d.querySelector('#tellerlet'), null, 'KAAP teller is vervallen');
  });
});
