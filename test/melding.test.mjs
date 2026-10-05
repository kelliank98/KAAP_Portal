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

describe('Melding bij een nieuwe treffer (ophaler v1.12)', () => {
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
    assert.equal(m.gemeld.a1, nu.toISOString());
  });
  test('meerdere treffers: "2 nieuwe X5\'s"; verschillende modellen: "nieuwe auto\'s"; site zonder land krijgt het land erbij', () => {
    const m = bouwMelding([auto('a1'), auto('a2', { siteNaam: 'Kleinanzeigen', title: 'BMW X5 xDrive45e M Sportpaket AHK', price: 47500, ez: '2022' })], {}, nu);
    assert.equal(m.onderwerp, "2 nieuwe X5's");
    assert.match(m.html, /€ 47\.500 · 72\.000 km · 2022 · Kleinanzeigen \(DE\)/);
    assert.equal(bouwMelding([auto('a1'), auto('b1', { model: 'X6' }), auto('b2', { model: 'X6' })], {}, nu).onderwerp, "3 nieuwe auto's");
  });
  test('alleen nieuwe advertenties: een prijsdaling geeft geen melding', () => {
    assert.equal(bouwMelding([auto('a1', { soort: 'prijs', price_prev: 49900 })], {}, nu).melding, false);
  });
  test('dezelfde auto via twee uitvoeringen (M Sport en M-Sport) één keer', () => {
    const m = bouwMelding([auto('a1'), auto('a1', { site: 'tweede zoekopdracht' })], {}, nu);
    assert.equal(m.aantal, 1);
    assert.equal(m.onderwerp, 'Nieuw: BMW X5 xDrive45e M Sport · € 46.900');
  });
  test('nooit twee keer dezelfde auto, ook niet als een site hem even kwijt was; na 90 dagen vergeten', () => {
    const eerder = { a1: '2026-10-01T10:00:00Z', oud: '2026-06-01T10:00:00Z' };
    const m = bouwMelding([auto('a1')], eerder, nu);
    assert.equal(m.melding, false, 'al gemeld');
    assert.deepEqual(Object.keys(m.gemeld), ['a1'], 'wat ouder is dan 90 dagen valt eruit');
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
    assert.equal(res.tool, 'inkoop-fetch 1.12');
    assert.deepEqual(Object.keys(res.gemeld), ['a1'], 'eerder gemelde auto\'s blijven onthouden');
    assert.match(readFileSync(uitvoer, 'utf8'), /melding=false\nonderwerp=\n/);
    assert.equal(existsSync(join(map, 'melding.html')), false);
  });
});
