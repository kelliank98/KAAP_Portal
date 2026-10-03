// Test voor de Cloudflare Worker (tools/kaap-proxy.js): toegangscontrole en sitelijst.
// Draait zonder netwerk: fetch wordt vervangen door een stub.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../tools/kaap-proxy.js';

const PROXY = 'https://kaap-proxy.test/';
const doel = 'https://www.marktplaats.nl/lrp/api/search?l1CategoryId=91&limit=1';
let laatsteFetch = null;
globalThis.fetch = async (url) => { laatsteFetch = url; return new Response('{"totalResultCount":5}', { status: 200, headers: { 'content-type': 'application/json' } }); };

const vraag = (query, headers = {}) => worker.fetch(new Request(PROXY + '?' + query, { headers }), { PROXY_KEY: 'geheim' });

describe('Proxy-toegang', () => {
  test('zonder herkomst en zonder sleutel: 401', async () => {
    const r = await vraag('url=' + encodeURIComponent(doel));
    assert.equal(r.status, 401);
    assert.match(await r.text(), /sleutel ontbreekt/);
  });
  test('verkeerde sleutel: 401', async () => {
    assert.equal((await vraag('url=' + encodeURIComponent(doel) + '&k=fout')).status, 401);
  });
  test('juiste sleutel zonder herkomst (weekcontrole, lokaal bestand): doorgelaten', async () => {
    const r = await vraag('url=' + encodeURIComponent(doel) + '&k=geheim');
    assert.equal(r.status, 200);
    assert.equal(laatsteFetch, doel);
  });
  test('app op GitHub Pages zonder sleutel: doorgelaten, CORS op die herkomst', async () => {
    const r = await vraag('url=' + encodeURIComponent(doel), { Origin: 'https://kelliank98.github.io' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://kelliank98.github.io');
  });
  test('andere herkomst zonder sleutel: 401', async () => {
    assert.equal((await vraag('url=' + encodeURIComponent(doel), { Origin: 'https://kwaadwillende.example' })).status, 401);
  });
  test('PROXY_KEY niet ingesteld: verzoek zonder herkomst legt uit wat er mist', async () => {
    const r = await worker.fetch(new Request(PROXY + '?url=' + encodeURIComponent(doel)), {});
    assert.equal(r.status, 401);
    assert.match(await r.text(), /PROXY_KEY is nog niet ingesteld/);
  });
  test('SLEUTEL_VERPLICHT: ook de app op GitHub Pages heeft dan de sleutel nodig', async () => {
    const streng = (query, headers = {}) => worker.fetch(new Request(PROXY + '?' + query, { headers }), { PROXY_KEY: 'geheim', SLEUTEL_VERPLICHT: 'ja' });
    const app = { Origin: 'https://kelliank98.github.io' };
    const zonder = await streng('url=' + encodeURIComponent(doel), app);
    assert.equal(zonder.status, 401, 'een nagebootste herkomst is niet genoeg');
    assert.equal(zonder.headers.get('Access-Control-Allow-Origin'), 'https://kelliank98.github.io', 'de app kan de weigering lezen en uitleggen');
    assert.match(await zonder.text(), /sleutel ontbreekt of klopt niet/);
    assert.equal((await streng('url=' + encodeURIComponent(doel) + '&k=fout', app)).status, 401);
    const met = await streng('url=' + encodeURIComponent(doel) + '&k=geheim', app);
    assert.equal(met.status, 200);
    assert.equal(met.headers.get('Access-Control-Allow-Origin'), 'https://kelliank98.github.io');
    assert.equal((await streng('url=' + encodeURIComponent(doel) + '&k=geheim')).status, 200, 'weekcontrole met sleutel blijft werken');
  });
  test('SLEUTEL_VERPLICHT zonder PROXY_KEY: niemand komt erin en de melding zegt wat er mist', async () => {
    const r = await worker.fetch(new Request(PROXY + '?url=' + encodeURIComponent(doel), { headers: { Origin: 'https://kelliank98.github.io' } }), { SLEUTEL_VERPLICHT: 'ja' });
    assert.equal(r.status, 401);
    assert.match(await r.text(), /PROXY_KEY is nog niet ingesteld/);
  });
  test('SLEUTEL_VERPLICHT uit of leeg: de app mag zonder sleutel, zoals in v1.01', async () => {
    for (const waarde of ['', 'nee', '0', undefined]) {
      const r = await worker.fetch(new Request(PROXY + '?url=' + encodeURIComponent(doel), { headers: { Origin: 'https://kelliank98.github.io' } }), { PROXY_KEY: 'geheim', SLEUTEL_VERPLICHT: waarde });
      assert.equal(r.status, 200, 'waarde: ' + waarde);
    }
  });
  test('de sleutel wordt niet doorgestuurd naar de autosite', async () => {
    await vraag('url=' + encodeURIComponent(doel) + '&k=geheim');
    assert.ok(!String(laatsteFetch).includes('geheim'));
  });
  test('site buiten de lijst: 403, ook met sleutel', async () => {
    const r = await vraag('url=' + encodeURIComponent('https://example.com/') + '&k=geheim');
    assert.equal(r.status, 403);
  });
  test('OPTIONS (preflight) antwoordt zonder toegangscontrole', async () => {
    const r = await worker.fetch(new Request(PROXY, { method: 'OPTIONS', headers: { Origin: 'https://kelliank98.github.io' } }), {});
    assert.equal(r.status, 200);
  });
});
