/* KAAP Inkoop Radar hulp - Autotelex (v1.1.0)
   Draait op de pagina's van AutotelexPRO. Staat daar de voertuigpagina met "BPM berekenen bij IMPORT",
   dan leest dit script de Rest-BPM-bedragen en geeft ze via de achtergrond aan de KAAP Inkoop Radar.
   De achtergrond geeft ze alleen door als de app erom vroeg (knop "BPM uit Autotelex").
   Dit script klikt niets aan en verandert niets op de pagina, behalve een melding als het bedrag is overgenomen.
   Element-id's nagemeten op 05-10-2026 op een berekening van de gebruiker. */
(() => {
  'use strict';
  const P = 'ctl00_cp_ucVD_tcVehicleDetails_tpnlIE_ucVD_IE_';
  const tekst = (id) => {
    const e = document.getElementById(id);
    return e ? String(e.tagName === 'INPUT' ? e.value : e.textContent).replace(/\s+/g, ' ').trim() : null;
  };
  const bedrag = (s) => {
    if (!s || !/\d/.test(s) || /geen/i.test(s)) return null;
    const n = parseInt(s.replace(/[^\d]/g, ''), 10);
    return isNaN(n) ? null : n;
  };
  const NAAM = { C: 'afschrijvingstabel', K: 'koerslijst', T: 'taxatierapport' };

  function lees() {
    if (!/\/Vehicle\/Vehicle_Details\.aspx/i.test(location.pathname)) return null;
    const opties = {
      C: bedrag(tekst(P + 'lblBPMPartitionTable')),   // Rest-BPM op basis van afschrijvingstabel
      K: bedrag(tekst(P + 'lblBPMExchangeList')),     // Rest-BPM op basis van koerslijst
      T: bedrag(tekst(P + 'lblBPMTaxatie')),          // Rest-BPM op basis van taxatierapport
    };
    // Autotelex zet in hidVoordeligeRestBPM welke het voordeligst is (C nagemeten; K en T aangenomen).
    // Staat daar iets onbekends, dan nemen we het laagste bedrag: dat is per definitie het voordeligst.
    const code = (tekst(P + 'hidVoordeligeRestBPM') || '').toUpperCase().slice(0, 1);
    let basis = null;
    if (code in opties && opties[code] != null) basis = code;
    else for (const k of Object.keys(opties)) if (opties[k] != null && (basis == null || opties[k] < opties[basis])) basis = k;
    if (basis == null) return null;
    return {
      bedrag: opties[basis], basis: NAAM[basis],
      afschrijvingstabel: opties.C, koerslijst: opties.K, taxatierapport: opties.T,
      uitvoering: tekst('ctl00_cp_ucVD_tcVehicleDetails_tpnlVS_ucVD_BO_lblSamenvatting_UitvoeringValue'),
      toelating: tekst('ctl00_cp_ucVD_txtHiddenDateEersteToelating'),
    };
  }

  function melding(g) {
    let el = document.getElementById('kaap-atx-melding');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kaap-atx-melding';
      el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#14532d;color:#fff;font:600 14px/1.4 system-ui,sans-serif;padding:10px 14px;border-radius:10px';
      document.body.appendChild(el);
    }
    el.textContent = 'Overgenomen in de KAAP Inkoop Radar: € ' + g.bedrag.toLocaleString('nl-NL') + ' (' + g.basis + ')';
  }

  let laatst = '';
  function kijk() {
    const g = lees();
    if (!g) return;
    const sleutel = JSON.stringify(g);
    if (sleutel === laatst) return;   // dezelfde berekening maar één keer doorgeven
    laatst = sleutel;
    try {
      chrome.runtime.sendMessage({ type: 'atx-bpm', gegevens: g })
        .then(r => { if (r && r.overgenomen) melding(g); })
        .catch(() => { /* extensie herladen of geen aanvraag */ });
    } catch (e) { /* extensie herladen */ }
  }

  kijk();
  // De pagina werkt deels zonder herladen (ASP.NET); daarom ook kijken als er iets verandert.
  let wacht = null;
  new MutationObserver(() => { clearTimeout(wacht); wacht = setTimeout(kijk, 400); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();
