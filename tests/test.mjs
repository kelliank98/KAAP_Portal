import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const FILE = process.argv[2];
const html = fs.readFileSync(FILE, 'utf8');
let pass = 0, fail = 0;
const queue = [];
function t(name, fn) { queue.push([name, fn]); }
async function runAll() {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  ✓', name); }
    catch (e) { fail++; console.log('  ✗', name, '\n     ', e.message); }
  }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' verwacht ' + JSON.stringify(b) + ', kreeg ' + JSON.stringify(a)); }
function near(a, b, msg) { if (Math.abs(a - b) > 0.005) throw new Error((msg || '') + ' verwacht ' + b + ', kreeg ' + a); }

function boot(seed = {}) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, JSON.stringify(v));
  w.HTMLAnchorElement.prototype.click = () => {};
  // jsdom heeft geen Blob.text/createObjectURL: vang de export op
  w.__export = null;
  w.Blob = class { constructor(parts) { this.parts = parts; } };
  w.URL.createObjectURL = b => { w.__export = b.parts.join(''); return 'blob:x'; };
  w.confirm = () => true;
  w.fetch = () => Promise.reject(new Error('geen netwerk in test'));
  const src = html.match(/<script>([\s\S]*)<\/script>/)[1];
  // const/let op topniveau -> var, zodat de test erbij kan via window (gedrag verandert niet)
  w.eval(src
    .replace(/\bconst (BTW|KEY|MAX|VERSIE|HISTORIE|CKEY|VKEY|EXTKEY|EXT_DAGEN|FSA|BACKUP_RECENT|BACKUP_DAGEN|BACKUP_INTERVAL|AFLEVERPAKKET_OMS|AFLEVERPAKKET_BEDRAG|UPPER_FIELDS|rdwMislukt|rdwGedaan|kentGetypt) ?=/g, 'var $1=')
    .replace(/\blet (saleItems|adminMode|vuil|regMode|voorFilter|fileHandle|bundelTijd|nrVergrendeld|regSort|laatsteDriveCheck)=/g, 'var $1='));
  return w;
}
const VER = '1.27';
const w0 = () => boot();
const sale = o => Object.assign({ merk: 'BMW 545E', kenteken: 'X-123-YZ', bj: '', km: '', ch: 'WBA000000000000AA', kl: '', gar: '', prijs: '€ 12.100,00', restbpm: '€ 0,00', regime: 'btw', price: 'incl', kosten: [] }, o);
const inruil = o => Object.assign({ merk: 'AUDI A4', kenteken: 'A-456-BC', bj: '', km: '', ch: 'WAU000000000000BB', kl: '', gar: '', bedrag: '€ 5.000,00', regime: 'btw' }, o);
const factuur = (nr, sales, inr, datum = '10-09-2026') => ({ id: Number(nr), nr: String(nr), datum, klant: { naam: 'Test Klant', adres: '', pc: '', plaats: 'Marum', tel: '', mail: '', deb: '' }, type: 'Gebruikte auto — particulier', term: '5 dagen', sales, inruil: inr, amounts: null });

console.log('\nBestand:', FILE);

console.log('\n1. Versie en labels');
t('versie staat op één plek: bovenaan het script, geen losse HTML-comment', () => {
  if (/<!--\s*KAAP Factuur/.test(html)) throw new Error('oude versie-comment nog aanwezig');
  const kop = html.split('<script>')[1].split('\n').slice(0, 8).join('\n');
  if (!kop.includes("const VERSIE='" + VER + "'")) throw new Error('VERSIE niet in de eerste regels van het script');
});
t('precies één versiestring in comment, constante en historie', () => {
  const w = boot();
  eq(w.VERSIE, VER, 'VERSIE');
  eq(w.HISTORIE[0][0], VER, 'HISTORIE[0]');
  eq(w.document.getElementById('app-versie').textContent, 'v' + VER, 'label');
  eq(w.document.title, 'KAAP Factuur Generator (v' + VER + ')', 'title');
});
t('geen dubbele versienummers in de historie', () => {
  const w = boot(); const s = new Set(w.HISTORIE.map(h => h[0]));
  eq(s.size, w.HISTORIE.length);
});

console.log('\n2. Fiscale kern (ongewijzigd, regressie)');
t('BTW incl: 12.100 → 10.000 excl + 2.100 btw', () => { const c = boot().saleCalc(sale()); near(c.excl, 10000); near(c.btw, 2100); near(c.total, 12100); });
t('BTW excl: 10.000 → 12.100 totaal', () => { const c = boot().saleCalc(sale({ prijs: '€ 10.000,00', price: 'excl' })); near(c.btw, 2100); near(c.total, 12100); });
t('BTW incl met rest-BPM 1.000: btw over 11.100', () => { const c = boot().saleCalc(sale({ restbpm: '€ 1.000,00' })); near(c.excl, 11100 / 1.21); near(c.btw, 11100 - 11100 / 1.21); near(c.total, 12100); near(c.restbpm, 1000); });
t('marge: geen btw, total = prijs', () => { const c = boot().saleCalc(sale({ regime: 'marge' })); eq(c.btw, 0); near(c.total, 12100); near(c.excl, 12100); });
t('afleverpakket bij BTW-auto: 574,38 excl + 120,62 btw', () => { const w = boot(); const c = w.kostenCalc(sale({ kosten: [w.afleverpakket()] })); near(c.excl, 574.38); near(c.btw, 120.62); near(c.incl, 695); });
t('afleverpakket bij margeauto: geen aparte btw', () => { const w = boot(); const c = w.kostenCalc(sale({ regime: 'marge', kosten: [w.afleverpakket()] })); near(c.excl, 695); eq(c.btw, 0); });
t('inruil BTW 5.000 excl → credit 6.050; marge → credit 5.000', () => { const w = boot(); near(w.inruilCalc(inruil()).credit, 6050); near(w.inruilCalc(inruil({ regime: 'marge' })).credit, 5000); });
t('creditfactuur maakt alle bedragen negatief, incl. kosten', () => {
  const w = boot(); w.saleItems = [sale({ kosten: [w.afleverpakket()] })]; w.inruilItems = [inruil()]; w.renderSales(); w.renderInruil();
  w.maakCreditfactuur();
  near(w.parseNum(w.saleItems[0].prijs), -12100); near(w.parseNum(w.saleItems[0].kosten[0].bedrag), -695); near(w.parseNum(w.inruilItems[0].bedrag), -5000);
});

console.log('\n3. Specificatie en totalen');
t('klantfactuur: 12.100 + 695 pakket − 6.050 inruil = 6.745', () => {
  const w = boot(); w.saleItems = [sale({ kosten: [w.afleverpakket()] })]; w.inruilItems = [inruil()]; w.renderSales(); w.renderInruil();
  w.setDocMode('verkoop'); const r = w.recalc(); near(r.total, 6745);
  eq(w.document.getElementById('out_total').textContent, '€ 6.745,00');
});
t('interne kopie: inruil niet afgetrokken, btw-afdracht 2.220,62', () => {
  const w = boot(); w.saleItems = [sale({ kosten: [w.afleverpakket()] })]; w.inruilItems = [inruil()]; w.renderSales(); w.renderInruil();
  w.setDocMode('boek'); const r = w.recalc(); near(r.total, 12795);
  eq(w.document.getElementById('out_btw_afdracht').textContent, '€ 2.220,62');
});
t('inkoopverklaring alleen bij marge-inruil', () => {
  const w = boot(); w.inruilItems = [inruil()]; w.renderInruil(); w.recalc();
  eq(w.document.getElementById('inkoopverkl').style.display, 'none');
  w.inruilItems = [inruil({ regime: 'marge' })]; w.renderInruil(); w.recalc();
  eq(w.document.getElementById('inkoopverkl').style.display, 'block');
});
t('nieuw verkoopvoertuig krijgt automatisch het afleverpakket', () => { const w = boot(); const s = w.blankSale(); eq(s.kosten.length, 1); eq(s.kosten[0].oms, 'Afleverpakket'); eq(s.kosten[0].bedrag, '€ 695,00'); });

console.log('\n4. Export in bundelformaat (v1.26)');
t('export bevat facturen én voorraad met formaat 2 en app-versie', () => {
  const w = boot({ kaap_facturen_v2: [factuur(1001, [sale()], [])], kaap_voorraad_v1: [{ id: 1, merk: 'AUDI', ch: 'WAU000000000000BB' }] });
  w.extDoExport(); const b = JSON.parse(w.__export);
  eq(b.formaat, 2); eq(b.app, VER); eq(b.facturen.length, 1); eq(b.voorraad.length, 1); eq(b.voorraad[0].merk, 'AUDI');
});
t('export is identiek aan wat het Drive-bestand krijgt (bundel)', () => {
  const w = boot({ kaap_facturen_v2: [factuur(1001, [sale()], [])] });
  w.extDoExport(); const b = JSON.parse(w.__export), d = w.bundel();
  eq(JSON.stringify(b.facturen), JSON.stringify(d.facturen)); eq(JSON.stringify(b.voorraad), JSON.stringify(d.voorraad));
});

console.log('\n5. Import (v1.26)');
t('bundel importeren: facturen + voorraad, geïmporteerd wint bij gelijk nummer', () => {
  const w = boot({ kaap_facturen_v2: [factuur(1001, [sale({ merk: 'OUD' })], []), factuur(1002, [sale()], [])], kaap_voorraad_v1: [{ id: 5, merk: 'LOKAAL', kenteken: '', ch: 'WVW000000000000CC' }] });
  const n = w.importeerBackup(JSON.stringify({ formaat: 2, facturen: [factuur(1001, [sale({ merk: 'NIEUW' })], []), factuur(1003, [sale()], [])], voorraad: [{ id: 99, merk: 'UITBESTAND', kenteken: '', ch: 'WVW000000000000CC' }, { id: 100, merk: 'EXTRA', kenteken: 'Z-1', ch: '' }] }));
  eq(n.facturen, 2); eq(n.voorraad, 2);
  const db = w.loadDB(); eq(db.length, 3); eq(db.find(f => f.nr === '1001').sales[0].merk, 'NIEUW'); eq(!!db.find(f => f.nr === '1002'), true);
  const v = w.loadVoor(); eq(v.length, 2); eq(v.find(a => a.ch === 'WVW000000000000CC').merk, 'UITBESTAND');
});
t('oude back-up (kale lijst) importeren: facturen erin, voorraad ongemoeid', () => {
  const w = boot({ kaap_voorraad_v1: [{ id: 5, merk: 'LOKAAL', ch: 'X1' }] });
  const n = w.importeerBackup(JSON.stringify([factuur(1001, [sale()], [])]));
  eq(n.facturen, 1); eq(n.voorraad, null); eq(w.loadDB().length, 1); eq(w.loadVoor().length, 1); eq(w.loadVoor()[0].merk, 'LOKAAL');
});
t('rommel importeren gooit een fout en laat de data staan', () => {
  const w = boot({ kaap_facturen_v2: [factuur(1001, [sale()], [])] });
  let gooit = false; try { w.importeerBackup(JSON.stringify({ foo: 1 })); } catch (e) { gooit = true; }
  eq(gooit, true); eq(w.loadDB().length, 1);
});
t('export → import rondreis is verliesvrij', () => {
  const a = boot({ kaap_facturen_v2: [factuur(1001, [sale()], [inruil()])], kaap_voorraad_v1: [{ id: 1, merk: 'AUDI', kenteken: 'A-456-BC', ch: 'WAU000000000000BB', inkoop: '€ 5.000,00', bron: 'inruil bij factuur 1001' }] });
  a.extDoExport();
  const b = boot(); b.importeerBackup(a.__export);
  eq(JSON.stringify(b.loadDB()), JSON.stringify(a.loadDB())); eq(JSON.stringify(b.loadVoor()), JSON.stringify(a.loadVoor()));
});
t('bestandskiezer wordt na import geleegd (zelfde bestand opnieuw kiesbaar)', () => {
  const w = boot(); const inp = w.document.getElementById('file-import');
  const src = html.match(/\$\('file-import'\)\.onchange[\s\S]*?r\.readAsText\(file\);\};/)[0];
  if (!src.includes("e.target.value=''")) throw new Error('reset ontbreekt');
});

console.log('\n6. Back-upmap (v1.26)');
t('writeBackup wordt bij map kiezen met force-vlag aangeroepen, niet met de lijst', () => {
  if (html.includes('writeBackup(loadDB(),true)')) throw new Error('oude aanroep nog aanwezig');
  if (!html.includes('await writeBackup(true);')) throw new Error('nieuwe aanroep mist');
});
t('bewaarbeleid: 15 nieuwste + 1 per dag, 60 dagen', () => { const w = boot(); eq(w.BACKUP_RECENT, 15); eq(w.BACKUP_DAGEN, 60); });

console.log('\n7. Sluitwaarschuwing (v1.26)');
t('schoon formulier: geen waarschuwing', () => {
  const w = boot(); const e = new w.Event('beforeunload', { cancelable: true }); w.dispatchEvent(e); eq(e.defaultPrevented, false);
});
t('na een wijziging: waarschuwing; na opslaan weer niet', () => {
  const w = boot(); const inp = w.document.getElementById('k_naam'); inp.value = 'Jan';
  inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  let e = new w.Event('beforeunload', { cancelable: true }); w.dispatchEvent(e); eq(e.defaultPrevented, true, 'vuil');
  w.saleItems = [sale()]; w.renderSales(); w.document.getElementById('btn-save').click();
  e = new w.Event('beforeunload', { cancelable: true }); w.dispatchEvent(e); eq(e.defaultPrevented, false, 'schoon na opslaan');
  eq(w.loadDB().length, 1);
});

console.log('\n8. Concept, nummering, voorraad (regressie)');
t('concept wordt bewaard met versiestempel en teruggezet', () => {
  const w = boot(); const inp = w.document.getElementById('k_naam'); inp.value = 'Piet'; inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  w.bewaarConceptNu(); const c = JSON.parse(w.localStorage.getItem('kaap_concept_v1')); eq(c.klant.naam, 'Piet'); eq(c.app, VER);
  const w2 = boot({ kaap_concept_v1: c }); eq(w2.document.getElementById('k_naam').value, 'Piet');
});
t('oud concept zonder kosten krijgt het afleverpakket terug', () => {
  const w = boot(); const st = w.migreerConcept({ app: '1.10', sales: [sale({ kosten: undefined })] }); eq(st.sales[0].kosten.length, 1); eq(st.app, VER);
});
t('volgend factuurnummer', () => { const w = boot({ kaap_facturen_v2: [factuur(1007, [sale()], []), factuur(1003, [sale()], [])] }); eq(w.volgendNummer(), '1008'); });
t('voorraad: inruil komt binnen, verkoop op VIN zet verkocht, credit zet terug', () => {
  const w = boot({ kaap_facturen_v2: [factuur(1001, [sale()], [inruil({ regime: 'marge' })])] });
  let v = w.syncVoorraad(); eq(v.length, 1); eq(v[0].ch, 'WAU000000000000BB'); eq(v[0].verkocht, false); eq(v[0].bron, 'inruil bij factuur 1001');
  const db = w.loadDB(); db.push(factuur(1002, [sale({ merk: 'AUDI A4', kenteken: 'ANDERS', ch: 'WAU000000000000BB', prijs: '€ 7.000,00' })], [], '15-09-2026')); w.saveDBNoWrite(db);
  v = w.syncVoorraad(); eq(v[0].verkocht, true, 'verkocht op VIN ondanks ander kenteken'); eq(v[0].factuurNr, '1002');
  db.push(factuur(1003, [sale({ ch: 'WAU000000000000BB', prijs: '€ -7.000,00' })], [], '16-09-2026')); w.saveDBNoWrite(db);
  v = w.syncVoorraad(); eq(v[0].verkocht, false, 'na volledige creditering weer in voorraad');
});
t('periodefilter Q3 2026', () => {
  const w = boot({ kaap_facturen_v2: [factuur(1001, [sale()], [], '10-09-2026'), factuur(1002, [sale()], [], '10-11-2026')] });
  w.vulJaarKeuze(); w.document.getElementById('per-jaar').value = '2026'; w.document.getElementById('per-deel').value = 'Q3';
  eq(w.inPeriode(w.loadDB()[0]), true); eq(w.inPeriode(w.loadDB()[1]), false);
});

console.log('\n9. Datumcontrole (v1.27)');
t('normaliseerDatum: varianten en onbestaande datums', () => {
  const w = boot();
  eq(w.normaliseerDatum('5-9-26'), '05-09-2026'); eq(w.normaliseerDatum('05/09/2026'), '05-09-2026'); eq(w.normaliseerDatum('2026-09-05'), '05-09-2026');
  eq(w.normaliseerDatum('31-02-2026'), null); eq(w.normaliseerDatum('12-13-2026'), null); eq(w.normaliseerDatum(''), null); eq(w.normaliseerDatum('abc'), null);
});
t('ongeldige datum blokkeert opslaan, geldige datum wordt genormaliseerd', () => {
  const w = boot(); w.saleItems = [sale()]; w.renderSales();
  w.document.getElementById('f_datum').value = '31-02-2026'; w.document.getElementById('btn-save').click(); eq(w.loadDB().length, 0, 'geblokkeerd');
  w.document.getElementById('f_datum').value = '5/9/2026'; w.document.getElementById('btn-save').click(); eq(w.loadDB().length, 1, 'opgeslagen'); eq(w.loadDB()[0].datum, '05-09-2026');
});

console.log('\n10. Factuurnummer op slot (v1.27)');
t('open uit register → slot; leeg formulier → vrij; opslaan → slot', () => {
  const w = boot({ kaap_facturen_v2: [factuur(1001, [sale()], [])] }); const nr = w.document.getElementById('f_nr');
  eq(nr.readOnly, false, 'start');
  w.fillForm(w.loadDB()[0]); eq(nr.readOnly, true, 'na openen');
  w.leegFormulier(); eq(nr.readOnly, false, 'na legen');
  w.saleItems = [sale()]; w.renderSales(); w.document.getElementById('btn-save').click(); eq(nr.readOnly, true, 'na opslaan');
  w.dupliceerFactuur(); eq(nr.readOnly, false, 'na dupliceren'); eq(nr.value, '1002');
});
t('slot overleeft het concept', () => {
  const w = boot({ kaap_facturen_v2: [factuur(1001, [sale()], [])] }); w.fillForm(w.loadDB()[0]); w.bewaarConceptNu();
  const w2 = boot({ kaap_concept_v1: JSON.parse(w.localStorage.getItem('kaap_concept_v1')) }); eq(w2.document.getElementById('f_nr').readOnly, true);
});

console.log('\n11. Extra kosten in overzichten (v1.27)');
t('invoiceFigures telt afleverpakket mee, gelijk aan de factuur', () => {
  const w = boot(); const f = factuur(1001, [sale({ kosten: [w.afleverpakket()] })], [inruil()]);
  const g = w.invoiceFigures(f); near(g.klantTot, 6745); near(g.boekTot, 12795); near(g.btwAfdracht, 2220.62); near(g.kostenTot, 695); near(g.inruilTot, 6050); near(g.inruilBtw, 1050);
});
t('interne registerweergave en BTW-kolom komen overeen met de interne factuur', () => {
  const w = boot({ kaap_facturen_v2: [factuur(1001, [sale({ kosten: [w0().afleverpakket()] })], [])] });
  w.setRegMode('boek'); const cells = [...w.document.querySelectorAll('#reg-body tr')][0].querySelectorAll('td');
  eq(cells[5].textContent, '€ 12.795,00'); eq(cells[6].textContent, '€ 2.220,62');
});
t('maandstaaf bevat het afleverpakket', () => {
  const w = boot({ kaap_facturen_v2: [factuur(1001, [sale({ kosten: [w0().afleverpakket()] })], [])] });
  w.renderStats(); if (!w.document.getElementById('stat-bars').textContent.includes('€ 12.795,00')) throw new Error('staaf zonder kosten');
});

console.log('\n12. Register sorteren en CSV (v1.27)');
t('sorteren op nummer oplopend/aflopend en op klant', () => {
  const w = boot({ kaap_facturen_v2: [Object.assign(factuur(1002, [sale()], []), { id: 2 }), Object.assign(factuur(1001, [sale()], []), { id: 1, klant: { naam: 'Zeeman' } }), Object.assign(factuur(1003, [sale()], []), { id: 3, klant: { naam: 'Aalbers' } })] });
  const nrs = () => [...w.document.querySelectorAll('#reg-body tr')].slice(0, 3).map(r => r.children[1].textContent);
  w.renderReg(''); eq(nrs().join(','), '1003,1002,1001', 'standaard nieuwste eerst');
  const th = w.document.querySelector('#view-reg th[data-sort="nr"]'); th.click(); eq(nrs().join(','), '1003,1002,1001', 'nr aflopend'); th.click(); eq(nrs().join(','), '1001,1002,1003', 'nr oplopend');
  w.document.querySelector('#view-reg th[data-sort="klant"]').click(); eq(nrs()[0], '1003', 'Aalbers eerst');
  if (!th.textContent.includes('Nr.')) throw new Error('koptekst kwijt');
});
t('CSV: BOM, puntkomma, decimale komma, totaalregel, periode-filter', () => {
  const w = boot({ kaap_facturen_v2: [factuur(1001, [sale({ kosten: [w0().afleverpakket()] })], [inruil()], '10-09-2026'), factuur(1002, [sale()], [], '10-11-2026')] });
  w.vulJaarKeuze(); w.document.getElementById('per-jaar').value = '2026'; w.document.getElementById('per-deel').value = 'Q3';
  const r = w.registerCsv(''); eq(r.aantal, 1);
  const lines = r.csv.split('\r\n').filter(Boolean); eq(lines.length, 3);
  if (!lines[0].startsWith('\ufeffFactuurnr;Datum;Klant')) throw new Error('kop: ' + lines[0].slice(0, 30));
  const c = lines[1].split(';'); eq(c[0], '1001'); eq(c[6], 'BTW'); eq(c[7], '6745,00'); eq(c[8], '12795,00'); eq(c[10], '2220,62'); eq(c[12], '695,00'); eq(c[13], '6050,00'); eq(c[14], '1050,00');
  eq(lines[2].split(';')[0], 'TOTAAL'); eq(lines[2].split(';')[7], '6745,00');
  w.exportRegisterCsv(); if (!w.__export.includes('1001;10-09-2026')) throw new Error('download mist');
});
t('CSV: klantnaam met puntkomma wordt gequoot', () => { const w = boot(); eq(w.csvVeld('Jansen; Zn'), '"Jansen; Zn"'); eq(w.csvVeld('Piet'), 'Piet'); });

console.log('\n13. Klanten (v1.27)');
t('klantenlijst groepeert hoofdletterongevoelig en telt totalen', () => {
  const w = boot({ kaap_facturen_v2: [Object.assign(factuur(1001, [sale()], [], '01-08-2026'), { id: 1, klant: { naam: 'Jan de Vries', plaats: 'Marum', tel: '' } }), Object.assign(factuur(1002, [sale()], [], '10-09-2026'), { id: 2, klant: { naam: 'jan de vries', plaats: 'Groningen', tel: '06 12' } }), Object.assign(factuur(1003, [sale()], [], '05-09-2026'), { id: 3, klant: { naam: 'Ans', plaats: '' } })] });
  const l = w.klantenLijst(); eq(l.length, 2); const j = l.find(k => k.naam.toLowerCase() === 'jan de vries');
  eq(j.n, 2); near(j.totaal, 24200); eq(j.plaats, 'Groningen', 'nieuwste gegevens'); eq(j.laatste, '10-09-2026'); eq(l[0].naam, 'jan de vries', 'meest recente klant eerst');
});
t('tabblad Klanten rendert, zoekt en springt naar het register', () => {
  const w = boot({ kaap_facturen_v2: [Object.assign(factuur(1001, [sale()], []), { id: 1, klant: { naam: 'Jan', plaats: 'Marum' } }), Object.assign(factuur(1002, [sale()], []), { id: 2, klant: { naam: 'Ans', plaats: 'Leek' } })] });
  w.document.querySelector('.tab[data-view="klant"]').click();
  eq(w.document.querySelectorAll('#klant-body tr').length, 2);
  w.document.getElementById('kq').value = 'leek'; w.document.getElementById('kq').dispatchEvent(new w.Event('input'));
  eq(w.document.querySelectorAll('#klant-body tr').length, 1);
  w.document.querySelector('#klant-body [data-kreg]').click();
  eq(w.document.getElementById('view-reg').classList.contains('active'), true); eq(w.document.getElementById('q').value, 'Ans');
  eq(w.document.querySelectorAll('#reg-body tr').length, 2, 'één factuur + totaalregel');
});
t('+ Factuur vanuit Klanten vult de klant in met een nieuw nummer', () => {
  const w = boot({ kaap_facturen_v2: [Object.assign(factuur(1001, [sale()], []), { id: 1, klant: { naam: 'Jan', adres: 'Dorp 1', pc: '9363 tg', plaats: 'Marum', tel: '0612345678', mail: 'j@x.nl', deb: 'D7' } })] });
  w.renderKlanten(); w.document.querySelector('#klant-body [data-knew]').click();
  eq(w.document.getElementById('f_nr').value, '1002'); eq(w.document.getElementById('k_naam').value, 'Jan'); eq(w.document.getElementById('k_pc').value, '9363 TG'); eq(w.document.getElementById('k_tel').value, '06 12 34 56 78'); eq(w.document.getElementById('g_deb').value, 'D7');
  eq(w.document.getElementById('view-gen').classList.contains('active'), true); eq(w.document.getElementById('f_nr').readOnly, false);
});

console.log('\n14. Drive-bestand opnieuw inlezen (v1.27)');
function nepHandle(obj) { return { getFile: async () => ({ text: async () => JSON.stringify(obj) }), queryPermission: async () => 'granted' }; }
t('stil: nieuwer tijdstempel → overnemen; ouder → laten staan', async () => {
  const w = boot({ kaap_facturen_v2: [factuur(1001, [sale()], [])] });
  w.bundelTijd = 1000;
  w.fileHandle = nepHandle({ formaat: 2, tijd: 500, facturen: [factuur(1009, [sale()], [])], voorraad: [] });
  eq(await w.fileReadInto(true), false); eq(w.loadDB()[0].nr, '1001', 'ouder: ongewijzigd');
  w.fileHandle = nepHandle({ formaat: 2, tijd: 2000, facturen: [factuur(1009, [sale()], [])], voorraad: [{ id: 1, merk: 'X', ch: 'VIN1' }] });
  eq(await w.fileReadInto(true), true); eq(w.loadDB()[0].nr, '1009', 'nieuwer: overgenomen'); eq(w.loadVoor().length, 1); eq(w.bundelTijd, 2000);
});
t('stil: oud formaat zonder tijdstempel wordt met rust gelaten; bij opstarten wel geladen', async () => {
  const w = boot({ kaap_facturen_v2: [factuur(1001, [sale()], [])] }); w.bundelTijd = 0;
  w.fileHandle = nepHandle([factuur(1009, [sale()], [])]);
  eq(await w.fileReadInto(true), false); eq(w.loadDB()[0].nr, '1001');
  eq(await w.fileReadInto(), true); eq(w.loadDB()[0].nr, '1009');
});
t('schrijven zet het tijdstempel, zodat eigen schrijfacties niet als "ander apparaat" tellen', async () => {
  const w = boot(); let geschreven = '';
  w.FSA = true; w.fileHandle = { createWritable: async () => ({ write: async d => { geschreven = d; }, close: async () => {} }) };
  await w.fileWrite(); const b = JSON.parse(geschreven); eq(w.bundelTijd, b.tijd); if (!(b.tijd > 0)) throw new Error('geen tijd');
});

console.log('\n15. Lettertype (v1.27)');
t('terugvalstack aanwezig', () => { if (!html.includes("font-family:'Poppins','Helvetica Neue',Helvetica,Arial,sans-serif")) throw new Error('stack mist'); });

await runAll();
console.log(`\n${pass} geslaagd, ${fail} mislukt`);
process.exit(fail ? 1 : 0);
