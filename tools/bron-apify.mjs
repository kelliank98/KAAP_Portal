#!/usr/bin/env node
/*  KAAP bron-apify  v1.00
    Optionele betaalde bron. Doet niets zolang APIFY_TOKEN leeg is.

    Aanzetten (later, als je de knoop doorhakt):
      APIFY_TOKEN   = je Apify-sleutel        (GitHub secret)
      APIFY_SITES   = mobile,gaspedaal        (welke sites via Apify lopen)
      APIFY_MAX     = 60                      (maximaal advertenties per zoekopdracht)

    Zolang APIFY_SITES een site niet noemt, blijft die via de gratis weg lopen.
*/

// Welke actor hoort bij welke site. Namen uit de Apify Store, prijs per 1000
// advertenties tussen haakjes; controleer die vóór je aanzet.
export const ACTORS = {
  mobile:      'khadinakbar~mobile-de-scraper',      // ~$1,80 / 1000, houdt prijswijzigingen bij
  gaspedaal:   'studio-amba~gaspedaal-scraper',      // ~$2,00 / 1000
  as24de:      'yadroo~autoscout24-cars',            // alleen nodig bij blokkades
  as24nl:      'yadroo~autoscout24-cars',
  as24be:      'yadroo~autoscout24-cars',
};

export const apifyAan = (site) => {
  const token = process.env.APIFY_TOKEN;
  if (!token) return false;
  const sites = (process.env.APIFY_SITES || '').split(',').map(s => s.trim()).filter(Boolean);
  return sites.includes(site) && !!ACTORS[site];
};

// Vertaalt het antwoord van een actor naar dezelfde vorm als onze eigen parsers.
const normaliseer = (r) => ({
  id: String(r.id || r.listingId || r.url || '').slice(0, 60),
  title: (r.title || r.name || '').slice(0, 120),
  price: r.price ?? r.priceEur ?? r.priceEUR ?? null,
  km: r.mileageKm ?? r.mileage ?? null,
  ez: r.firstRegistration || r.registration || null,
  fuel: (r.fuelType || r.fuel || '').toLowerCase() || null,
  co2: r.co2 ?? null,
  img: (r.imageUrls || r.images || [])[0] || r.image || null,
  seller: r.sellerName || r.dealerName || null,
  city: r.location || r.city || null,
  url: r.url || r.listingUrl || null,
  geplaatst: r.firstSeen || r.publishedAt || null,
  price_prev: r.previousPriceEur ?? null,
});

export async function haalViaApify(site, zoekUrl, monitorSleutel){
  const token = process.env.APIFY_TOKEN;
  const actor = ACTORS[site];
  const max = +(process.env.APIFY_MAX || 60);
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}`;
  const body = {
    startUrls: [{url: zoekUrl}],
    maxResults: max,
    maxItems: max,
    monitoringKey: monitorSleutel || site,
  };
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 120000);
  try {
    const r = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: c.signal});
    if (!r.ok) throw new Error('Apify gaf HTTP ' + r.status);
    const rijen = await r.json();
    const items = (Array.isArray(rijen) ? rijen : []).slice(0, max).map(normaliseer).filter(x => x.url);
    return {count: items.length, items, bron: 'apify'};
  } finally { clearTimeout(t); }
}
