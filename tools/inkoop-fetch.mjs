#!/usr/bin/env node
/*
  KAAP Inkoop-radar – ophaler  v1.02
  Leest profiles.json (geëxporteerd uit de app), haalt per profiel de zoekopdrachten op bij
  AutoScout24 (NL/DE/BE), Marktplaats, 2dehands en Kleinanzeigen, en schrijft results.json.
  Nieuwe advertenties (niet in de vorige results.json) komen in new_items.md.

  Gebruik:  node tools/inkoop-fetch.mjs [profiles.json] [results.json]
  Vereist:  Node 20 of nieuwer. Geen npm-pakketten.
*/
import fs from 'node:fs';

const [, , PROFILES = 'profiles.json', RESULTS = 'results.json'] = process.argv;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const MAX_ITEMS = 60;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { if (fallback !== undefined) return fallback; throw new Error(`Kan ${p} niet lezen: ${e.message}`); }
}
async function get(url, accept = 'text/html', ua = UA, pogingen = 3) {
  let laatste = null;
  for (let i = 1; i <= pogingen; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': ua, 'Accept': accept + ',*/*;q=0.8', 'Accept-Language': 'nl-NL,nl;q=0.9,de;q=0.8,en;q=0.7' }, redirect: 'follow' });
    if (r.ok) return accept.includes('json') ? r.json() : r.text();
    laatste = r.status;
    if (![403, 429, 500, 502, 503].includes(r.status) || i === pogingen) break;
    await sleep(4000 * i);   // even wachten: meestal een snelheidslimiet, geen blokkade
  }
  throw new Error(`HTTP ${laatste}`);
}
const unent = (s) => String(s ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&ndash;/g, '–').replace(/&#(\d+);/g, (m, c) => String.fromCharCode(c));
const num = (s) => { const n = parseInt(String(s ?? '').replace(/[^0-9]/g, ''), 10); return isNaN(n) ? null : n; };
function normFuel(s) {
  const t = (s || '').toLowerCase();
  if (!t) return null;
  if (/elektro\s*\/\s*diesel|hybrid.*diesel|diesel.*hybrid/.test(t)) return 'hybride_diesel';
  if (/elektro\s*\/\s*benzin|hybrid|hybride/.test(t)) return 'hybride';
  if (/diesel/.test(t)) return 'diesel';
  if (/benzin|benzine|petrol|essence|super/.test(t)) return 'benzine';
  if (/elektr|electric|ev\b/.test(t)) return 'elektrisch';
  return null;
}
function fuelFromTitle(t) {
  const x = (t || '').toLowerCase().replace(/&quot;|&amp;/g, ' ');
  if (/(\d{2}e\b|\bphev\b|hybrid|e-hybrid|\bhybride\b)/.test(x)) return /\d{2,3}\s?de\b|diesel/.test(x) ? 'hybride_diesel' : 'hybride';
  if (/(\d{2}d\b|\btdi\b|\bcdi\b|diesel|bluetec|\bd\d\b)/.test(x)) return 'diesel';
  if (/(\d{2}i\b|\btfsi\b|\btsi\b|benzin|\bt\d\b)/.test(x)) return 'benzine';
  if (/(\bix\d|\beqs\b|\beqe\b|\beqc\b|e-tron|taycan|elektro|electric|\bev\b)/.test(x)) return 'elektrisch';
  return null;
}
function ezFromMonthYear(s) { // "10-2023" | "10/2023" | "2023" -> "2023-10" | "2023"
  const m = String(s || '').match(/(\d{1,2})[\/\-](\d{4})/); if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  const y = String(s || '').match(/(20\d\d|19\d\d)/); return y ? y[1] : null;
}

// ---------- AutoScout24 ----------
async function fetchAs24(l) {
  const host = new URL(l.url).origin;
  const items = [];
  let count = null, warn = null;
  for (let page = 1; page <= 3; page++) {
    const url = l.url + (l.url.includes('?') ? '&' : '?') + 'page=' + page;
    const html = await get(url);
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
    if (!m) throw new Error('geen __NEXT_DATA__ (pagina gewijzigd of geblokkeerd)');
    const d = JSON.parse(m[1]);
    const pp = d?.props?.pageProps || {};
    if (count == null) count = pp.numberOfResults ?? null;
    const list = pp.listings || [];
    for (const it of list) {
      if (!it || !it.id) continue;
      const v = it.vehicle || {}, tr = it.tracking || {};
      const co2m = (it.wltpValues || []).join(' ').match(/(\d{1,3})\s*g\/km/);
      items.push({
        id: it.id,
        title: [v.make, v.model, v.modelVersionInput].filter(Boolean).join(' ').slice(0, 120),
        price: it.price?.priceRaw ?? num(it.price?.priceFormatted),
        km: num(tr.mileage) ?? num(v.mileageInKm),
        ez: ezFromMonthYear(tr.firstRegistration),
        fuel: normFuel(v.fuel) || fuelFromTitle(v.modelVersionInput),
        co2: co2m ? +co2m[1] : null,
        seller: it.seller?.companyName || null,
        city: it.location?.city || null,
        url: it.url ? host + it.url : null,
      });
    }
    if (list.length < 20 || items.length >= MAX_ITEMS) break;
    await sleep(1200);
  }
  if (!items.length && l.model) {
    // Model-slug klopt waarschijnlijk niet: zoek de juiste schrijfwijze op in het merkoverzicht.
    try {
      const b = l.url.replace(/\/lst\/([^\/?]+)\/[^\/?]+/, '/lst/$1');
      const bh = await get(b);
      const bd = JSON.parse((bh.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s) || [, '{}'])[1]);
      const groups = [...new Set((bd?.props?.pageProps?.listings || []).map(x => x?.vehicle?.modelGroup).filter(Boolean))];
      const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
      const hit = groups.find(g => norm(g) === norm(l.model)) || groups.find(g => norm(g).startsWith(norm(l.model)));
      warn = hit
        ? `0 resultaten; AutoScout24 noemt dit model "${hit}" - plak de model-URL in de app (Model-koppeling) of schrijf het model zo.`
        : `0 resultaten; controleer de model-schrijfwijze op AutoScout24 (gezien in dit merk: ${groups.slice(0, 6).join(', ') || 'geen'}).`;
    } catch (e) { warn = '0 resultaten; controleer de model-schrijfwijze op AutoScout24.'; }
  }
  return { count, items: dedupe(items).slice(0, MAX_ITEMS), warn };
}

// ---------- Marktplaats / 2dehands / 2ememain: model-id opzoeken ----------
const modelCache = new Map();
async function resolveLrpModel(r) {
  const key = `${r.host}|${r.merkSlug}|${r.model}`.toLowerCase();
  if (modelCache.has(key)) return modelCache.get(key);
  const html = await get(`${r.host}/l/${r.pad}/${r.merkSlug}/`);
  const i = html.indexOf('"facets"');
  const seg = html.slice(i, i + 300000);
  const g = seg.match(/"key":"model","type":"AttributeGroupFacet","label":"[^"]+","attributeGroup":(\[[\s\S]*?\])/);
  if (!g) { modelCache.set(key, null); return null; }
  const pairs = [...g[1].matchAll(/"attributeValueKey":"([^"]+)","attributeValueId":(\d+)/g)].map(m => [m[1], m[2]]);
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = norm(r.model);
  let hit = pairs.find(([k]) => norm(k) === want)
         || pairs.find(([k]) => norm(k) === want.replace(/klasse|klass|class|serie|series/g, ''))
         || pairs.find(([k]) => norm(k).startsWith(want) || want.startsWith(norm(k)));
  const out = hit ? { id: hit[1], naam: hit[0] } : null;
  modelCache.set(key, out);
  return out;
}

// ---------- Marktplaats / 2dehands (LRP API) ----------
async function fetchLrp(l) {
  if (!l.apiUrl) throw new Error('merk onbekend op dit platform: controleer de merknaam of plak de model-URL');
  const host = new URL(l.apiUrl).origin;
  // Marktplaats/2dehands negeren sinds kort een deel van de attribuutfilters (waargenomen 09-2026).
  // Daarom: altijd op zoekwoord zoeken (merk + model + uitvoering) EN de resultaten hier narekenen.
  const q = [l.merk, l.model, l.variant].filter(Boolean).join(' ').trim();
  let url = l.apiUrl.replace(/([?&])query=[^&]*/, '$1query=' + encodeURIComponent(q));
  if (!/[?&]query=/.test(url) && q) url += '&query=' + encodeURIComponent(q);
  let extra = null;
  const d = await get(url, 'application/json');
  const items = (d.listings || []).filter(x => !x.reserved).map(x => {
    const attr = (k) => (x.attributes || []).concat(x.extendedAttributes || []).find(a => a.key === k)?.value ?? null;
    return {
      id: x.itemId,
      title: (x.title || '').slice(0, 120),
      price: x.priceInfo?.priceCents ? Math.round(x.priceInfo.priceCents / 100) : null,
      km: num(attr('mileage')),
      ez: ezFromMonthYear(attr('constructionYear')),
      fuel: normFuel(attr('fuel')) || fuelFromTitle(x.title),
      co2: null,
      transmission: attr('transmission'),
      seller: x.sellerInformation?.sellerName || null,
      city: x.location?.cityName || null,
      url: x.vipUrl ? host + x.vipUrl : null,
    };
  });
  const crit = l.criteria || {};
  const past = (it) => {
    const t = (it.title || '').toLowerCase();
    if (l.merk && !tokensIn(t, l.merk)) return false;
    if (l.model && !tokensIn(t, l.model)) return false;
    if (l.variant && !tokensIn(t, l.variant)) return false;
    if (crit.bjvan && it.ez && +String(it.ez).slice(0, 4) < crit.bjvan) return false;
    if (crit.bjtot && it.ez && +String(it.ez).slice(0, 4) > crit.bjtot) return false;
    if (crit.km && it.km && it.km > crit.km) return false;
    if (crit.pmin && it.price && it.price < crit.pmin) return false;
    if (crit.pmax && it.price && it.price > crit.pmax) return false;
    if (it.transmission && !/automa/i.test(it.transmission)) return false;
    return true;
  };
  const alle = dedupe(items);
  const ok = alle.filter(past);
  if (alle.length && ok.length < alle.length / 2) extra = `deze site negeerde een deel van de filters; ${alle.length - ok.length} van ${alle.length} advertenties hier weggefilterd`;
  return { count: d.totalResultCount ?? null, items: ok.slice(0, MAX_ITEMS), warn: extra };
}
// Alle woorden van s moeten in de titel staan; cijfers/letters aan elkaar toegestaan (RS 6 ~ RS6).
function tokensIn(titel, s) {
  const nt = titel.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return String(s).toLowerCase().split(/\s+/).filter(Boolean)
    .every(w => nt.includes(w.replace(/[^a-z0-9]+/g, '')) || titel.toLowerCase().includes(w));
}

// ---------- Kleinanzeigen ----------
function kaPage(url, page) {
  if (page === 1) return url;
  const i = url.indexOf('/k0c216'); if (i < 0) return url;
  const head = url.slice(0, i), tail = url.slice(i);
  const segs = head.split('/'); const last = segs[segs.length - 1];
  if (last && !last.includes(':') && last !== 's-autos') segs.splice(segs.length - 1, 0, 'seite:' + page); else segs.push('seite:' + page);
  return segs.join('/') + tail;
}
async function fetchKleinanzeigen(l) {
  const items = []; let count = null, warn = null;
  for (let page = 1; page <= 2; page++) {
    const html = await get(kaPage(l.url, page), 'text/html', UA_MOBILE);
    if (page === 1 && l.merk) {
      const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [, ''])[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const ruw = l.merk.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      if (h1.toLowerCase().includes(ruw) && ruw.includes('_')) warn = `merk "${l.merk}" wordt door Kleinanzeigen niet herkend (filter genegeerd): probeer een andere spelling`;
    }
    if (count == null) { const c = html.match(/([\d\.]+)\s*Ergebnisse/) || html.match(/von\s+([\d\.]+)\s*<\/?[^>]*>?\s*\{autos/) || (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [,''])[1].match(/von\s+([\d\.]+)/); count = c ? num(c[1]) : null; }
    const re = /<(?:li|article)\b([^>]*\bdata-adid="\d+"[^>]*)>/g;
    const tags = []; let mm;
    while ((mm = re.exec(html))) tags.push({ idx: mm.index, attrs: mm[1] });
    let n = 0;
    for (let i = 0; i < tags.length; i++) {
      const t = tags[i];
      const blk = html.slice(t.idx, tags[i + 1] ? tags[i + 1].idx : t.idx + 20000);
      const id = (t.attrs.match(/data-adid="(\d+)"/) || [])[1]; if (!id) continue;
      const href = (t.attrs.match(/data-href="([^"]+)"/) || [])[1] || (blk.match(/href="(\/s-anzeige\/[^"]+)"/) || [])[1];
      let title = (blk.match(/"name":"((?:[^"\\]|\\.)*)"/) || blk.match(/"title":"((?:[^"\\]|\\.)*)"/) || [])[1];
      if (title) { try { title = JSON.parse('"' + title + '"'); } catch (e) { /* laat staan */ } }
      if (!title) { const t2 = blk.match(/boldtitle[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || blk.match(/class="ellipsis"[^>]*>([\s\S]*?)<\/a>/); if (t2) title = t2[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
      const txt = blk.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, '|').replace(/\s+/g, ' ');
      const price = (txt.match(/([\d\.]{4,9})\s*€/) || [])[1];
      const km = (txt.match(/([\d\.]{4,9})\s*km\b/) || [])[1];
      const ez = (txt.match(/EZ\s*(\d{2})\/(\d{4})/) || []);
      const city = (blk.match(/info--location"[^>]*>\s*([^<]+?)\s*</) || blk.match(/aditem-main--top--left"[^>]*>\s*([^<]+?)\s*</) || [])[1];
      title = unent(title);
      items.push({ id, title: (title || '').slice(0, 120), price: num(price), km: num(km), ez: ez[2] ? `${ez[2]}-${ez[1]}` : null,
        fuel: fuelFromTitle(title), co2: null, seller: null, city: city ? city.replace(/\s+/g, ' ').trim() : null,
        url: href ? 'https://www.kleinanzeigen.de' + href : null });
      n++;
    }
    if (n < 25 || items.length >= MAX_ITEMS) break;
    await sleep(1200);
  }
  if (count >= 10000 && !warn) warn = 'Kleinanzeigen geeft het maximum van 10.000 terug: filter je profiel scherper aan.';
  return { count, items: dedupe(items).slice(0, MAX_ITEMS), warn };
}

function dedupe(items) { const seen = new Set(); return items.filter(i => { if (!i.id || seen.has(i.id)) return false; seen.add(i.id); return true; }); }

const HANDLERS = { as24nl: fetchAs24, as24de: fetchAs24, as24be: fetchAs24, marktplaats: fetchLrp, twodehands: fetchLrp, twoememain: fetchLrp, kleinanzeigen: fetchKleinanzeigen };

// ---------- Hoofdprogramma ----------
const src = readJson(PROFILES);
const prev = readJson(RESULTS, { profiles: {} });
const out = { generated: new Date().toISOString(), tool: 'inkoop-fetch 1.02', profiles: {} };
const newItems = [];
let fouten = 0;

for (const p of (src.profiles || [])) {
  const P = { naam: p.naam, sites: {} };
  const excl = (p.exclude || []).map(x => String(x).toLowerCase()).filter(Boolean);
  const uitgesloten = (it) => excl.some(t => (it.title || '').toLowerCase().includes(t));
  for (const l of (p.links || [])) {
    if (!l.poll || !HANDLERS[l.site]) continue;
    const key = l.site + (l.variant ? ':' + l.variant : '');
    const prevSite = prev.profiles?.[p.id]?.sites?.[key];
    const prevMap = new Map((prevSite?.items || []).map(i => [i.id, i]));
    const site = { naam: l.naam, land: l.land, variant: l.variant || '', url: l.url, checked: new Date().toISOString(), count: null, items: [], error: null, warn: null };
    try {
      const res = await HANDLERS[l.site](l);
      site.count = res.count; site.warn = res.warn || null;
      site.items = res.items.filter(it => !uitgesloten(it)).map(it => {
        const old = prevMap.get(it.id);
        const o = { ...it, first_seen: old?.first_seen || site.checked };
        if (old && old.price && it.price && it.price < old.price) o.price_prev = old.price_prev && old.price_prev > old.price ? old.price_prev : old.price;
        else if (old && old.price_prev && it.price === old.price) o.price_prev = old.price_prev;
        return o;
      });
      if (prevSite) {
        site.items.filter(it => !prevMap.has(it.id)).forEach(it => newItems.push({ profiel: p.naam, site: l.naam, soort: 'nieuw', ...it }));
        site.items.filter(it => prevMap.has(it.id) && it.price_prev && prevMap.get(it.id).price !== it.price).forEach(it => newItems.push({ profiel: p.naam, site: l.naam, soort: 'prijs', ...it }));
      }
      console.log(`✓ ${p.naam} · ${l.naam}${l.variant ? ' · ' + l.variant : ''}: ${site.items.length} opgehaald${res.count != null ? ' van ' + res.count : ''}${site.warn ? '  [!] ' + site.warn : ''}`);
    } catch (e) {
      fouten++;
      site.error = String(e.message || e).slice(0, 200);
      if (prevSite) { site.items = prevSite.items || []; site.count = prevSite.count ?? null; site.checked = prevSite.checked; }
      console.log(`✗ ${p.naam} · ${l.naam}: ${site.error}`);
    }
    P.sites[key] = site;
    await sleep(l.site === 'kleinanzeigen' ? 5000 : 1800);
  }
  out.profiles[p.id] = P;
}

fs.writeFileSync(RESULTS, JSON.stringify(out, null, 1));
const regel = (n) => `- **${n.profiel}** · ${n.site}: [${n.title}](${n.url}) – ${n.price ? '€ ' + n.price.toLocaleString('nl-NL') : 'prijs onbekend'}${n.price_prev ? ' (was € ' + n.price_prev.toLocaleString('nl-NL') + ')' : ''}${n.km ? ', ' + n.km.toLocaleString('nl-NL') + ' km' : ''}${n.ez ? ', EZ ' + n.ez : ''}${n.co2 ? ', ' + n.co2 + ' g/km' : ''}`;
const nieuw = newItems.filter(n => n.soort === 'nieuw'), prijs = newItems.filter(n => n.soort === 'prijs');
const md = newItems.length
  ? `# Inkoop-radar – ${new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })}\n\n` +
    (nieuw.length ? `## ${nieuw.length} nieuwe advertentie${nieuw.length === 1 ? '' : 's'}\n\n` + nieuw.map(regel).join('\n') + '\n\n' : '') +
    (prijs.length ? `## ${prijs.length} prijsverlaging${prijs.length === 1 ? '' : 'en'}\n\n` + prijs.map(regel).join('\n') + '\n' : '')
  : '';
fs.writeFileSync('new_items.md', md);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `new=${newItems.length ? 'true' : 'false'}\ncount=${newItems.length}\n`);
console.log(`Klaar: ${Object.keys(out.profiles).length} profielen, ${newItems.length} nieuw, ${fouten} fout(en).`);
