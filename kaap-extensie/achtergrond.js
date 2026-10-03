/* KAAP Inkoop Radar hulp - achtergrond (service worker)
   Doet een ding: op verzoek van de KAAP Inkoop Radar een pagina van een toegestane site
   openen in een tabblad op de achtergrond, de HTML teruggeven en het tabblad weer sluiten.
   Alle kennis over wat er op die pagina's staat zit in de app (inkoop.html), niet hier.
   Daardoor hoeft deze extensie niet opnieuw geladen te worden als een site zijn pagina wijzigt. */
'use strict';

// Alleen deze sites mag de extensie openen. Alles daarbuiten wordt geweigerd.
const TOEGESTAAN = ['mobile.de', 'gaspedaal.nl'];
const MAX_TEGELIJK = 3;        // nooit meer dan drie achtergrondtabbladen tegelijk
const STANDAARD_MS = 25000;    // zo lang wachten we standaard op een pagina
const MAX_MS = 45000;
const STAP_MS = 400;
const GEEF_OP_MS = 12000;      // zo lang mag een controlepagina van de site blijven staan

function magAdres(url) {
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  if (u.protocol !== 'https:') return false;
  return TOEGESTAAN.some(d => u.hostname === d || u.hostname.endsWith('.' + d));
}

// Wachtrij, zodat een zoekopdracht met veel links de browser niet volzet met tabbladen.
let bezig = 0;
const wachtrij = [];
function metBeurt(taak) {
  return new Promise((ok, fout) => { wachtrij.push({ taak, ok, fout }); volgende(); });
}
function volgende() {
  while (bezig < MAX_TEGELIJK && wachtrij.length) {
    const w = wachtrij.shift();
    bezig++;
    Promise.resolve().then(w.taak).then(w.ok, w.fout).finally(() => { bezig--; volgende(); });
  }
}

const slaap = (ms) => new Promise(r => setTimeout(r, ms));

async function leesTab(tabId) {
  const uit = await chrome.scripting.executeScript({
    target: { tabId },
    injectImmediately: true,   // niet wachten tot alle plaatjes en advertenties binnen zijn
    func: () => ({
      html: document.documentElement ? document.documentElement.outerHTML : '',
      url: location.href, titel: document.title, staat: document.readyState
    })
  });
  return uit && uit[0] ? uit[0].result : null;
}

/* Opent de pagina en geeft de HTML terug zodra die compleet is ingelezen.
   - Met wachtOp: klaar zodra de HTML helemaal binnen is (readyState niet meer 'loading')
     en die tekst erin staat. Dat is seconden eerder dan wachten op alle plaatjes en advertenties.
   - Zonder wachtOp: klaar als de pagina volledig geladen is.
   - Met geefOpBij: staat die tekst langer dan GEEF_OP_MS in de pagina (de controlepagina van
     een site die niet vanzelf verdwijnt), dan stoppen we en melden we dat met controle:true.
     De extensie probeert zo'n controle niet te omzeilen; de gebruiker opent de site dan zelf.
   Loopt de tijd af, dan geven we terug wat er wel is, met gevonden:false. */
async function haalPagina(vraag) {
  const url = vraag && vraag.url;
  if (!magAdres(url)) return { ok: false, fout: 'adres niet toegestaan: de extensie opent alleen mobile.de en gaspedaal.nl' };
  const wachtOp = typeof vraag.wachtOp === 'string' ? vraag.wachtOp : '';
  const geefOpBij = typeof vraag.geefOpBij === 'string' ? vraag.geefOpBij : '';
  let controleSinds = 0;
  const limiet = Math.min(Math.max(+vraag.maxMs || STANDAARD_MS, 5000), MAX_MS);
  const start = Date.now();
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    try { await chrome.tabs.update(tab.id, { muted: true }); } catch (e) { /* niet erg */ }
    let laatste = null, laatsteFout = '';
    while (Date.now() - start < limiet) {
      await slaap(STAP_MS);
      let info;
      try { info = await chrome.tabs.get(tab.id); }
      catch (e) { tab = null; return { ok: false, fout: 'het tabblad is gesloten voordat de pagina klaar was' }; }
      let r = null;
      try { r = await leesTab(tab.id); }
      catch (e) { laatsteFout = String((e && e.message) || e); continue; }   // pagina nog niet bereikbaar
      if (!r || !r.html || r.staat === 'loading') continue;                  // HTML nog niet helemaal binnen
      laatste = r;
      const klaar = wachtOp ? r.html.includes(wachtOp) : (r.staat === 'complete' || info.status === 'complete');
      if (klaar) return { ok: true, html: r.html, url: r.url, titel: r.titel, gevonden: true, ms: Date.now() - start };
      if (geefOpBij && r.html.includes(geefOpBij)) {
        if (!controleSinds) controleSinds = Date.now();
        else if (Date.now() - controleSinds >= GEEF_OP_MS) {
          return { ok: true, html: r.html, url: r.url, titel: r.titel, gevonden: false, controle: true, ms: Date.now() - start };
        }
      } else controleSinds = 0;
    }
    if (laatste) return { ok: true, html: laatste.html, url: laatste.url, titel: laatste.titel, gevonden: !wachtOp, ms: Date.now() - start };
    return { ok: false, fout: laatsteFout || 'de pagina was niet op tijd geladen' };
  } catch (e) {
    return { ok: false, fout: String((e && e.message) || e) };
  } finally {
    if (tab && tab.id != null) { try { await chrome.tabs.remove(tab.id); } catch (e) { /* al weg */ } }
  }
}

chrome.runtime.onMessage.addListener((bericht, afzender, antwoord) => {
  // Alleen berichten van het eigen brugscript (brug.js) in het tabblad van de app.
  if (!bericht || !afzender || afzender.id !== chrome.runtime.id) return undefined;
  if (bericht.type === 'ping') {
    antwoord({ ok: true, versie: chrome.runtime.getManifest().version, sites: TOEGESTAAN });
    return undefined;
  }
  if (bericht.type === 'haal') {
    metBeurt(() => haalPagina(bericht)).then(antwoord, e => antwoord({ ok: false, fout: String((e && e.message) || e) }));
    return true;   // antwoord volgt later
  }
  return undefined;
});
