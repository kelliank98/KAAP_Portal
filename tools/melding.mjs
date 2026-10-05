/*
  KAAP Inkoop-radar – melding bij een nieuwe treffer  v1.0
  Maakt van de nieuwe advertenties van één ronde van de ophaler een kort mailonderwerp, een mail (HTML)
  en een WhatsApp-tekst. Alleen nieuwe advertenties: geen prijsdalingen, geen "niets gevonden".
  Dezelfde advertentie wordt nooit twee keer gemeld; wat gemeld is, staat in results.json (gemeld).
*/
const APP_URL = 'https://kelliank98.github.io/KAAP_Portal/inkoop.html';
const BEWAAR_DAGEN = 90;     // zo lang onthoudt de ophaler wat hij meldde
const MAX_WA = 6;            // meer wordt onleesbaar op een telefoon
const MAX_WA_TEKENS = 900;   // CallMeBot knipt lange berichten af

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
const regel = (n) => [n.price ? eur(n.price) : 'prijs onbekend', n.km ? kmTekst(n.km) : null, datum(n.ez), siteMetLand(n)].filter(Boolean).join(' · ');

function onderwerpVan(lijst) {
  if (lijst.length === 1) {
    const n = lijst[0];
    return `Nieuw: ${korteTitel(n.title)}${n.price ? ' · ' + eur(n.price) : ''}`;
  }
  const modellen = [...new Set(lijst.map(n => n.model).filter(Boolean))];
  return `${lijst.length} nieuwe ${modellen.length === 1 ? modellen[0] + "'s" : "auto's"}`;
}

// items: de nieuwe advertenties van deze ronde ({soort, profiel, siteNaam, land, model, id, url, title, price, km, ez}).
// gemeld: {advertentie-id: moment van melden} uit de vorige results.json.
export function bouwMelding(items, gemeld = {}, nu = new Date()) {
  const grens = nu.getTime() - BEWAAR_DAGEN * 864e5;
  const bewaard = Object.fromEntries(Object.entries(gemeld || {}).filter(([, d]) => new Date(d).getTime() >= grens));
  const deze = new Set(), lijst = [];
  for (const n of items || []) {
    if (n.soort !== 'nieuw') continue;
    const sleutel = n.id || n.url;
    if (!sleutel || deze.has(sleutel) || bewaard[sleutel]) continue;   // twee uitvoeringen, of eerder gemeld
    deze.add(sleutel); lijst.push(n);
  }
  if (!lijst.length) return { melding: false, gemeld: bewaard };
  lijst.forEach(n => { bewaard[n.id || n.url] = nu.toISOString(); });

  const onderwerp = onderwerpVan(lijst);
  const moment = nu.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
  const profielen = [...new Set(lijst.map(n => n.profiel))];
  const blokken = profielen.map(p => {
    const auto = lijst.filter(n => n.profiel === p).map(n =>
      `<p style="margin:0 0 14px"><b>${esc(n.title)}</b><br>${esc(regel(n))}<br><a href="${esc(n.url)}">Bekijk advertentie</a></p>`).join('\n');
    return `<p style="margin:0 0 10px;color:#555">Zoekopdracht: ${esc(p)}</p>\n${auto}`;
  }).join('\n');
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.45;color:#111">
<p style="margin:0 0 6px"><b>${lijst.length} ${lijst.length === 1 ? 'treffer' : 'treffers'}</b> · ${esc(moment)}</p>
${blokken}
<p style="margin:18px 0 0"><a href="${APP_URL}">Open de Inkoop Radar</a></p>
</div>
`;

  const stukken = lijst.slice(0, MAX_WA).map(n => `*${korteTitel(n.title)}*\n${regel(n)}\n${n.url}`);
  let tekst = `*KAAP: ${onderwerp}*\n\n` + stukken.join('\n\n');
  if (lijst.length > MAX_WA) tekst += `\n\n+ ${lijst.length - MAX_WA} meer in de app.`;
  if (tekst.length > MAX_WA_TEKENS) tekst = tekst.slice(0, MAX_WA_TEKENS - 3) + '...';

  return { melding: true, onderwerp, html, tekst, aantal: lijst.length, gemeld: bewaard };
}
