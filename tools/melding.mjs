/*
  KAAP Inkoop-radar – melding bij een nieuwe treffer  v1.2
  Maakt van de nieuwe advertenties van één ronde van de ophaler een kort mailonderwerp, een mail (HTML)
  en een WhatsApp-tekst. Geen bericht bij "niets nieuws". Dezelfde auto wordt alleen opnieuw gemeld als
  de prijs veranderd is (v1.1, op verzoek: "alleen bij prijswijziging"); wat gemeld is, staat met de
  prijs in results.json (gemeld).
  v1.2: geen melding bij een prijs onder € 2.500. Dat is bij deze auto's een maandbedrag, een bod of prijs
  op aanvraag (op 06-10-2026 kwam zo een X5 voor € 1.372 binnen). Zelfde grens als GEEN_PRIJS_ONDER in
  inkoop.html. Krijgt zo'n advertentie later een echte prijs, dan volgt een melding als nieuwe treffer.
*/
const APP_URL = 'https://kelliank98.github.io/KAAP_Portal/inkoop.html';
const BEWAAR_DAGEN = 90;     // zo lang onthoudt de ophaler wat hij meldde
const MAX_WA = 6;            // meer wordt onleesbaar op een telefoon
const MAX_WA_TEKENS = 900;   // CallMeBot knipt lange berichten af
export const GEEN_PRIJS_ONDER = 2500;   // gelijk aan inkoop.html
export const geenEchtePrijs = (prijs) => +prijs > 0 && +prijs < GEEN_PRIJS_ONDER;

const eur = (n) => '€ ' + Math.round(n).toLocaleString('nl-NL');
const kmTekst = (n) => Math.round(n).toLocaleString('nl-NL') + ' km';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// "2022-03" wordt "03-2022", "2022" blijft "2022".
function datum(ez) {
  const m = String(ez || '').match(/^(\d{4})(?:-(\d{1,2}))?/);
  return m ? (m[2] ? m[2].padStart(2, '0') + '-' : '') + m[1] : null;
}
// Het begin van de titel, tot de eerste opsomming ("BMW X5 xDrive45e M Sport | Pano | HUD").
export function korteTitel(titel) {
  const kort = String(titel || '').split(/\s*[|•*\/]\s*|\s+[–-]\s+/)[0].replace(/\s+/g, ' ').trim();
  return kort.length > 48 ? kort.slice(0, 47).trimEnd() + '…' : kort;
}
const siteMetLand = (n) => /\b(DE|NL|BE|DK)\b/.test(n.siteNaam || '') ? n.siteNaam : `${n.siteNaam} (${n.land})`;
const prijsTekst = (n) => (n.price ? eur(n.price) : 'prijs onbekend') + (n.was ? ` (was ${eur(n.was)})` : '');
const regel = (n) => [prijsTekst(n), n.km ? kmTekst(n.km) : null, datum(n.ez), siteMetLand(n)].filter(Boolean).join(' · ');
const soortTekst = (n) => n.was ? (n.price < n.was ? 'Prijs verlaagd' : 'Prijs verhoogd') : 'Nieuw';

function onderwerpVan(lijst) {
  if (lijst.length === 1) {
    const n = lijst[0];
    return `${soortTekst(n)}: ${korteTitel(n.title)}${n.price ? ' · ' + eur(n.price) : ''}`;
  }
  const nieuw = lijst.filter(n => !n.was), prijs = lijst.filter(n => n.was);
  const modellen = [...new Set(nieuw.map(n => n.model).filter(Boolean))];
  const ding = modellen.length === 1 ? modellen[0] : 'auto';
  return [nieuw.length ? `${nieuw.length} nieuwe ${nieuw.length === 1 ? ding : ding + "'s"}` : null,
    prijs.length ? `${prijs.length} prijswijziging${prijs.length === 1 ? '' : 'en'}` : null].filter(Boolean).join(' en ');
}

// items: wat deze ronde nieuw is ({soort: 'nieuw' | 'prijs', prijs_was, profiel, siteNaam, land, model, id, url, title, price, km, ez}).
// gemeld: {advertentie-id: {d: moment van melden, p: gemelde prijs}} uit de vorige results.json (t/m v1.0 alleen het moment).
export function bouwMelding(items, gemeld = {}, nu = new Date()) {
  const grens = nu.getTime() - BEWAAR_DAGEN * 864e5;
  const lees = (v) => typeof v === 'string' ? { d: v, p: null } : (v || {});
  const bewaard = Object.fromEntries(Object.entries(gemeld || {}).map(([k, v]) => [k, lees(v)]).filter(([, g]) => new Date(g.d).getTime() >= grens));
  const deze = new Set(), lijst = [];
  for (const n of items || []) {
    const sleutel = n.id || n.url;
    if (!sleutel || deze.has(sleutel)) continue;   // dezelfde auto uit twee uitvoeringen (of van 2dehands en 2ememain)
    if (geenEchtePrijs(n.price)) continue;          // maandbedrag of bod: geen melding (v1.2)
    const g = bewaard[sleutel];
    let was = null;
    if (n.soort === 'nieuw') {
      if (g && !(g.p && n.price && n.price !== g.p)) continue;   // al gemeld en de prijs is niet veranderd
      if (g) was = g.p;                                          // weer terug, met een andere prijs
    } else if (n.soort === 'prijs') {
      was = (g && g.p) || n.prijs_was || null;
      if (!was || !n.price || n.price === was) continue;
    } else continue;
    if (geenEchtePrijs(was)) was = null;            // eerst een nep-prijs, nu een echte: melden als nieuwe treffer
    deze.add(sleutel); lijst.push(Object.assign({}, n, { was }));
  }
  if (!lijst.length) return { melding: false, gemeld: bewaard };
  lijst.forEach(n => { bewaard[n.id || n.url] = { d: nu.toISOString(), p: n.price || null }; });

  const onderwerp = onderwerpVan(lijst);
  const moment = nu.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
  const profielen = [...new Set(lijst.map(n => n.profiel))];
  const kaart = (n) => `<p style="margin:0 0 14px"><b>${esc(n.title)}</b><br>${esc(regel(n))}<br><a href="${esc(n.url)}">Bekijk advertentie</a></p>`;
  const blokken = profielen.map(p => {
    const eigen = lijst.filter(n => n.profiel === p), nieuw = eigen.filter(n => !n.was), prijs = eigen.filter(n => n.was);
    const delen = [];
    if (nieuw.length) delen.push((prijs.length ? '<p style="margin:0 0 6px"><b>Nieuw</b></p>\n' : '') + nieuw.map(kaart).join('\n'));
    if (prijs.length) delen.push('<p style="margin:0 0 6px"><b>Prijs gewijzigd</b></p>\n' + prijs.map(kaart).join('\n'));
    return `<p style="margin:0 0 10px;color:#555">Zoekopdracht: ${esc(p)}</p>\n${delen.join('\n')}`;
  }).join('\n');
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.45;color:#111">
<p style="margin:0 0 6px"><b>${lijst.length} ${lijst.length === 1 ? 'treffer' : 'treffers'}</b> · ${esc(moment)}</p>
${blokken}
<p style="margin:18px 0 0"><a href="${APP_URL}">Open de Inkoop Radar</a></p>
</div>
`;

  const stukken = lijst.slice(0, MAX_WA).map(n => `*${n.was ? soortTekst(n) + ': ' : ''}${korteTitel(n.title)}*\n${regel(n)}\n${n.url}`);
  let tekst = `*KAAP: ${onderwerp}*\n\n` + stukken.join('\n\n');
  if (lijst.length > MAX_WA) tekst += `\n\n+ ${lijst.length - MAX_WA} meer in de app.`;
  if (tekst.length > MAX_WA_TEKENS) tekst = tekst.slice(0, MAX_WA_TEKENS - 3) + '...';

  return { melding: true, onderwerp, html, tekst, aantal: lijst.length, gemeld: bewaard };
}

// Testbericht: zelfde opbouw als een echte melding, zodat je de mail en WhatsApp kunt controleren.
export function testMelding(nu = new Date()) {
  const moment = nu.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
  return {
    melding: true, aantal: 0, onderwerp: 'Testbericht van de KAAP Inkoop Radar',
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.45;color:#111"><p style="margin:0 0 6px"><b>Testbericht</b> · ${esc(moment)}</p><p style="margin:0">De melding werkt. Bij een nieuwe treffer of een prijswijziging krijg je zo'n bericht met de auto's erin.</p><p style="margin:18px 0 0"><a href="${APP_URL}">Open de Inkoop Radar</a></p></div>\n`,
    tekst: `*KAAP: testbericht*\n\nDe melding werkt (${moment}). Bij een nieuwe treffer of een prijswijziging krijg je zo'n bericht met de auto's erin.`,
  };
}

