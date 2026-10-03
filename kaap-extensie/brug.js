/* KAAP Inkoop Radar hulp - brug
   Draait alleen in het tabblad van de KAAP Inkoop Radar. Geeft verzoeken van de app door
   aan de achtergrond (achtergrond.js) en het antwoord weer terug aan de app.
   De app en dit script praten via window.postMessage:
     app  -> brug : {kaap:'hulp-ping'}                                  wie is daar?
     brug -> app  : {kaap:'hulp-aanwezig', versie, sites}
     app  -> brug : {kaap:'hulp-haal', id, url, wachtOp, geefOpBij, maxMs}   haal deze pagina
     brug -> app  : {kaap:'hulp-antwoord', id, ok, html, url, titel, gevonden, controle, ms, fout} */
(() => {
  'use strict';
  const doel = location.origin === 'null' ? '*' : location.origin;
  const naarApp = (bericht) => { try { window.postMessage(bericht, doel); } catch (e) { /* tabblad weg */ } };

  function meld() {
    let versie = '';
    try { versie = chrome.runtime.getManifest().version; } catch (e) { return; }   // extensie is herladen: zwijg
    naarApp({ kaap: 'hulp-aanwezig', versie, sites: ['mobile.de', 'gaspedaal.nl'] });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || typeof e.data !== 'object') return;
    const d = e.data;
    if (d.kaap === 'hulp-ping') { meld(); return; }
    if (d.kaap !== 'hulp-haal' || !d.id || typeof d.url !== 'string') return;
    const mislukt = (fout) => naarApp({ kaap: 'hulp-antwoord', id: d.id, ok: false, fout });
    try {
      chrome.runtime.sendMessage({ type: 'haal', url: d.url, wachtOp: d.wachtOp || '', geefOpBij: d.geefOpBij || '', maxMs: d.maxMs || 0 })
        .then(r => naarApp(Object.assign({ kaap: 'hulp-antwoord', id: d.id }, r || { ok: false, fout: 'geen antwoord van de extensie' })))
        .catch(err => mislukt(String((err && err.message) || err)));
    } catch (err) {
      // Gebeurt als de extensie is bijgewerkt of herladen terwijl dit tabblad open stond.
      mislukt('de extensie is herladen; herlaad ook het tabblad van de app');
    }
  });

  meld();
})();
