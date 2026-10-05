// Test voor de melding bij een nieuwe treffer (tools/melding.mjs) en de koppeling in de ophaler.
// Draaien: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { bouwMelding, korteTitel } from '../tools/melding.mjs';

const hier = dirname(fileURLToPath(import.meta.url));
const nu = new Date('2026-10-05T16:17:00Z');
const auto = (id, extra) => Object.assign({ soort: 'nieuw', profiel: 'BMW X5 M Sport, M-Sport 2022+', siteNaam: 'AutoScout24 DE', land: 'DE', model: 'X5', id,
  url: 'https://www.autoscout24.de/angebote/' + id, title: 'BMW X5 xDrive45e M Sport | Pano | HUD | 22"', price: 46900, km: 72000, ez: '2022-03' }, extra || {});

describe('Melding bij een nieuwe treffer (ophaler v1.13)', () => {
  test('niets nieuws: geen melding', () => {
    const m = bouwMelding([], {}, nu);
    assert.equal(m.melding, false);
    assert.deepEqual(m.gemeld, {});
  });
  test('één treffer: kort onderwerp zonder codetaal, mail en WhatsApp met de gegevens', () => {
    const m = bouwMelding([auto('a1')], {}, nu);
    assert.equal(m.melding, true);
    assert.equal(m.onderwerp, 'Nieuw: BMW X5 xDrive45e M Sport · € 46.900');
    assert.match(m.html, /1 treffer<\/b> · 05-10-2026 18:17/);
    assert.match(m.html, /Zoekopdracht: BMW X5 M Sport, M-Sport 2022\+/);
    assert.match(m.html, /<b>BMW X5 xDrive45e M Sport \| Pano \| HUD \| 22&quot;<\/b><br>€ 46\.900 · 72\.000 km · 03-2022 · AutoScout24 DE<br><a href="https:\/\/www\.autoscout24\.de\/angebote\/a1">Bekijk advertentie<\/a>/);
    assert.match(m.html, /Open de Inkoop Radar/);
    assert.equal(m.tekst, '*KAAP: Nieuw: BMW X5 xDrive45e M Sport · € 46.900*\n\n*BMW X5 xDrive45e M Sport*\n€ 46.900 · 72.000 km · 03-2022 · AutoScout24 DE\nhttps://www.autoscout24.de/angebote/a1');
    assert.deepEqual(m.gemeld.a1, { d: nu.toISOString(), p: 46900 });
  });
  test('meerdere treffers: "2 nieuwe X5\'s"; verschillende modellen: "nieuwe auto\'s"; site zonder land krijgt het land erbij', () => {
    const m = bouwMelding([auto('a1'), auto('a2', { siteNaam: 'Kleinanzeigen', title: 'BMW X5 xDrive45e M Sportpaket AHK', price: 47500, ez: '2022' })], {}, nu);
    assert.equal(m.onderwerp, "2 nieuwe X5's");
    assert.match(m.html, /€ 47\.500 · 72\.000 km · 2022 · Kleinanzeigen \(DE\)/);
    assert.equal(bouwMelding([auto('a1'), auto('b1', { model: 'X6' }), auto('b2', { model: 'X6' })], {}, nu).onderwerp, "3 nieuwe auto's");
  });
  test('dezelfde auto opnieuw alleen bij een prijswijziging, met de oude prijs erbij', () => {
    const eerder = { a1: { d: '2026-10-04T10:00:00Z', p: 49900 } };
    const daling = bouwMelding([auto('a1', { soort: 'prijs', prijs_was: 49900, price: 47500 })], eerder, nu);
    assert.equal(daling.onderwerp, 'Prijs verlaagd: BMW X5 xDrive45e M Sport · € 47.500');
    assert.match(daling.html, /€ 47\.500 \(was € 49\.900\) · 72\.000 km/);
    assert.match(daling.tekst, /^\*KAAP: Prijs verlaagd: BMW X5 xDrive45e M Sport · € 47\.500\*\n\n\*Prijs verlaagd: BMW X5 xDrive45e M Sport\*\n€ 47\.500 \(was € 49\.900\)/);
    assert.deepEqual(daling.gemeld.a1, { d: nu.toISOString(), p: 47500 });
    assert.equal(bouwMelding([auto('a1', { soort: 'prijs', prijs_was: 47000, price: 47500 })], { a1: { d: '2026-10-04T10:00:00Z', p: 47000 } }, nu).onderwerp, 'Prijs verhoogd: BMW X5 xDrive45e M Sport · € 47.500');
    assert.equal(bouwMelding([auto('a1', { soort: 'prijs', prijs_was: 48000, price: 47500 })], {}, nu).onderwerp, 'Prijs verlaagd: BMW X5 xDrive45e M Sport · € 47.500', 'ook een auto die er al stond voordat er gemeld werd');
    assert.equal(bouwMelding([auto('a1', { soort: 'prijs', prijs_was: 47500, price: 47500 })], {}, nu).melding, false, 'zelfde prijs: niets');
  });
  test('nieuw en prijswijziging in één mail: onderwerp en twee kopjes', () => {
    const m = bouwMelding([auto('a1'), auto('b2', { soort: 'prijs', prijs_was: 50900, price: 48900 })], {}, nu);
    assert.equal(m.onderwerp, '1 nieuwe X5 en 1 prijswijziging');
    assert.match(m.html, /<b>Nieuw<\/b>[\s\S]*<b>Prijs gewijzigd<\/b>[\s\S]*€ 48\.900 \(was € 50\.900\)/);
  });
  test('dezelfde auto via twee uitvoeringen (M Sport en M-Sport) één keer', () => {
    const m = bouwMelding([auto('a1'), auto('a1', { site: 'tweede zoekopdracht' })], {}, nu);
    assert.equal(m.aantal, 1);
    assert.equal(m.onderwerp, 'Nieuw: BMW X5 xDrive45e M Sport · € 46.900');
  });
  test('niet twee keer dezelfde auto, ook niet als een site hem even kwijt was; wel als hij terugkomt met een andere prijs; na 90 dagen vergeten', () => {
    const eerder = { a1: { d: '2026-10-01T10:00:00Z', p: 46900 }, oud: { d: '2026-06-01T10:00:00Z', p: 1 }, v10: '2026-10-01T10:00:00Z' };
    const m = bouwMelding([auto('a1')], eerder, nu);
    assert.equal(m.melding, false, 'al gemeld, zelfde prijs');
    assert.deepEqual(Object.keys(m.gemeld).sort(), ['a1', 'v10'], 'wat ouder is dan 90 dagen valt eruit');
    assert.equal(bouwMelding([auto('v10')], eerder, nu).melding, false, 'gemeld met v1.0 (zonder prijs): niet opnieuw');
    const terug = bouwMelding([auto('a1', { price: 44900 })], eerder, nu);
    assert.equal(terug.onderwerp, 'Prijs verlaagd: BMW X5 xDrive45e M Sport · € 44.900');
  });
  test('titels worden veilig in de mail gezet', () => {
    const m = bouwMelding([auto('x', { title: 'BMW X5 <script>alert(1)</script> & co' })], {}, nu);
    assert.ok(!m.html.includes('<script>'));
    assert.match(m.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; co/);
  });
  test('WhatsApp: hooguit 6 auto\'s en 900 tekens', () => {
    const veel = Array.from({ length: 9 }, (_, i) => auto('v' + i));
    const m = bouwMelding(veel, {}, nu);
    assert.equal(m.onderwerp, "9 nieuwe X5's");
    assert.match(m.tekst, /\+ 3 meer in de app\.$/);
    assert.ok(m.tekst.length <= 900);
    assert.equal((m.tekst.match(/https:\/\//g) || []).length, 6);
  });
  test('korte titel: tot de eerste opsomming, hooguit 48 tekens', () => {
    assert.equal(korteTitel('BMW X5 xDrive45e M Sport | Pano | HUD'), 'BMW X5 xDrive45e M Sport');
    assert.equal(korteTitel('BMW X5 30 d xDrive M Sport*PANO*22 ZOLL*H&K*'), 'BMW X5 30 d xDrive M Sport');
    assert.equal(korteTitel('BMW X5 xDrive45e - M Sport - Panorama'), 'BMW X5 xDrive45e');
    assert.ok(korteTitel('A'.repeat(80)).length <= 48);
  });
  test('ophaler: schrijft "gemeld" in results.json en meldt aan de workflow dat er niets te melden is', () => {
    const map = mkdtempSync(join(tmpdir(), 'kaap-ophaler-'));
    // Alleen sites die de ophaler niet ophaalt (poll:false): geen netwerk nodig.
    writeFileSync(join(map, 'profiles.json'), JSON.stringify({ profiles: [{ id: 'p1', naam: 'X5', exclude: [], links: [{ site: 'mobile', naam: 'mobile.de', land: 'DE', poll: false, url: 'https://suchen.mobile.de/x' }] }] }));
    writeFileSync(join(map, 'results.json'), JSON.stringify({ profiles: {}, gemeld: { a1: new Date().toISOString() } }));
    const uitvoer = join(map, 'output.txt'); writeFileSync(uitvoer, '');
    execFileSync(process.execPath, [resolve(hier, '..', 'tools', 'inkoop-fetch.mjs'), 'profiles.json', 'results.json'], { cwd: map, env: { ...process.env, GITHUB_OUTPUT: uitvoer }, stdio: 'pipe' });
    const res = JSON.parse(readFileSync(join(map, 'results.json'), 'utf8'));
    assert.equal(res.tool, 'inkoop-fetch 1.13');
    assert.deepEqual(Object.keys(res.gemeld), ['a1'], 'eerder gemelde auto\'s blijven onthouden');
    assert.match(readFileSync(uitvoer, 'utf8'), /melding=false\nonderwerp=\n/);
    assert.equal(existsSync(join(map, 'melding.html')), false);
  });
});
