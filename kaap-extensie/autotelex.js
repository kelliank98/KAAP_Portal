/* KAAP Inkoop Radar hulp - Autotelex (v1.2.0)
   Draait op de pagina's van AutotelexPRO, en doet alleen iets als de app erom vroeg (knop "BPM uit Autotelex"):
   1. Op de startpagina vult het de zoekvelden van "Op kenmerken / import" in: personenauto, eerste toelating,
      merk, brandstof, transmissie (automaat) en model. Zoeken en de uitvoering kiezen doet de gebruiker zelf.
   2. Op de voertuigpagina met "BPM berekenen bij IMPORT" leest het de Rest-BPM-bedragen en geeft ze via de
      achtergrond aan de app.
   Het script rekent niets uit en klikt niet op Zoeken. Element-id's en het invullen nagemeten op 05-10-2026
   in de sessie van de gebruiker: na het bouwjaar laadt de site de merken, na het merk brandstof, transmissie
   en modellen (gedeeltelijke postbacks, de keuzelijsten worden daarbij vervangen). */
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

  // ---------- Zoekvelden invullen op de startpagina ----------
  const slaap = (ms) => new Promise(r => setTimeout(r, ms));
  const veld = (naam) => document.getElementById('ctl00_cp_ucSearch_Manual_' + naam);   // steeds opnieuw opzoeken: na een postback is het element vervangen
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  const ALIAS = { vw: 'volkswagen', mercedes: 'mercedesbenz', merc: 'mercedesbenz', benz: 'mercedesbenz', landrover: 'landrover', range: 'landrover', rangerover: 'landrover', alfa: 'alfaromeo', rolls: 'rollsroyce' };
  function kies(naam, waarde) {
    const el = veld(naam);
    if (!el || waarde == null) return false;
    el.value = String(waarde);
    if (el.value !== String(waarde)) return false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  async function wachtOp(test, ms = 10000) {
    const begin = Date.now();
    while (Date.now() - begin < ms) { if (test()) return true; await slaap(200); }
    return false;
  }
  const opties = (naam) => { const el = veld(naam); return el ? [...el.options].filter(o => o.value !== '-1') : []; };
  // Na het bouwjaar en het merk vult de site de volgende keuzelijsten met een gedeeltelijke postback. Wacht tot de lijst
  // vers is (nieuw element of andere opties), zodat een oude lijst van een eerder merk niet meetelt.
  const stand = (naam) => ({ el: veld(naam), opties: opties(naam).map(o => o.value).join(',') });
  async function wachtOpLijst(naam, voor, extra = () => true) {
    const gevuld = () => opties(naam).length > 0 && extra();
    const vers = () => veld(naam) !== voor.el || opties(naam).map(o => o.value).join(',') !== voor.opties;
    return await wachtOp(() => gevuld() && vers()) || gevuld();
  }

  function zoekMerk(v) {
    const lijst = opties('ddlMerk');
    const doel = norm(v.merk);
    let o = doel && lijst.find(x => norm(x.text) === doel);
    if (o) return o;
    const oms = String(v.oms || '').toLowerCase();
    o = lijst.filter(x => oms.startsWith(x.text.toLowerCase())).sort((a, b) => b.text.length - a.text.length)[0];
    if (o) return o;
    const eerste = norm(oms.split(/\s+/)[0]);
    const alias = ALIAS[eerste] || eerste;
    return lijst.find(x => norm(x.text) === alias) || lijst.find(x => norm(x.text.split(/\s+/)[0]) === alias) || null;
  }
  const EXTRA = ['touring', 'coupe', 'cabrio', 'cabriolet', 'gran', 'tourer', 'active', 'roadster', 'sportback', 'avant', 'variant', 'estate', 'kombi', 'combi', 'shooting', 'brake', 'allroad', 'sportwagon'];
  function basisModel(tekst) {
    const woorden = String(tekst).toLowerCase().split(/[\s]+/);
    return norm(woorden.filter(w => !EXTRA.includes(norm(w))).join(' ').replace(/[-\s]?(serie|series|klasse|class)\b/g, ''));
  }
  function zoekModel(v, merkTekst) {
    const lijst = opties('ddlModel');
    if (!lijst.length) return null;
    const oms = String(v.oms || '').toLowerCase();
    const omsZonderMerk = merkTekst && oms.startsWith(merkTekst.toLowerCase()) ? oms.slice(merkTekst.length) : oms;
    const woorden = omsZonderMerk.split(/[\s,|/*]+/).filter(Boolean);
    const kandidaten = [];
    if (v.model) kandidaten.push(basisModel(v.model));
    woorden.slice(0, 3).forEach(w => kandidaten.push(norm(w)));
    // BMW zonder X: 530e, 330 e en 118i horen bij de 5-, 3- en 1-serie.
    if (norm(merkTekst) === 'bmw'){ const m = omsZonderMerk.match(/\b(\d)\d{2}\s?[a-z]{0,2}\b/); if (m) kandidaten.push(m[1]); }
    // Een variant (Touring, Coupé, Active Tourer) alleen als die woorden ook in de advertentie staan;
    // de variant met de meeste passende woorden wint, anders het kale model.
    const omsNorm = ' ' + oms.normalize('NFD').replace(/[\u0300-\u036f]/g, '') + ' ';
    const extra = (o) => String(o.text).toLowerCase().split(/\s+/).filter(w => EXTRA.includes(norm(w))).map(norm);
    for (const k of kandidaten.filter(Boolean)) {
      const passend = lijst.filter(o => basisModel(o.text) === k && extra(o).every(w => omsNorm.includes(w)));
      if (passend.length) return passend.sort((a, b) => extra(b).length - extra(a).length || a.text.length - b.text.length)[0];
    }
    return null;
  }
  function zoekBrandstof(v) {
    const lijst = opties('ddlBrandstof');
    const t = (o) => o.text.toLowerCase();
    const regel = { benzine: (o) => /^benzine$/.test(t(o)), diesel: (o) => /^diesel$/.test(t(o)), hybride: (o) => /hybride/.test(t(o)) && !/diesel/.test(t(o)),
      hybride_diesel: (o) => /hybride/.test(t(o)) && /diesel/.test(t(o)), elektrisch: (o) => /^el[e]?[ck]tr/.test(t(o)) }[v.brandstof];
    return regel ? lijst.find(regel) || null : null;
  }
  function invulMelding(tekst) {
    let el = document.getElementById('kaap-atx-invul');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kaap-atx-invul';
      el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#1e3a8a;color:#fff;font:600 14px/1.4 system-ui,sans-serif;padding:10px 14px;border-radius:10px;max-width:360px';
      document.body.appendChild(el);
    }
    el.textContent = tekst;
  }
  async function vulIn(v) {
    if (!veld('ddlBouwjaar') || !veld('ddlMerk')) return null;
    const gedaan = [], mist = [];
    if (veld('ddlVoertuigType') && veld('ddlVoertuigType').value !== '1'){
      const jaarVoor = veld('ddlBouwjaar');
      kies('ddlVoertuigType', 1);
      await wachtOp(() => veld('ddlBouwjaar') !== jaarVoor, 3000);
    }
    const merkVoor = stand('ddlMerk');
    kies('ddlBouwdag', v.dag); kies('ddlBouwmaand', v.maand);
    kies('ddlBouwjaar', v.jaar);
    gedaan.push(`${String(v.dag).padStart(2, '0')}-${String(v.maand).padStart(2, '0')}-${v.jaar}`);
    if (!await wachtOpLijst('ddlMerk', merkVoor)){ mist.push('merk', 'model'); return { gedaan, mist }; }
    const merk = zoekMerk(v);
    if (!merk){ mist.push('merk', 'model'); return { gedaan, mist }; }
    const modelVoor = stand('ddlModel');
    kies('ddlMerk', merk.value); gedaan.push(merk.text);
    if (!await wachtOpLijst('ddlModel', modelVoor, () => veld('ddlMerk').value === merk.value)){ mist.push('model'); return { gedaan, mist }; }
    const brandstof = zoekBrandstof(v);
    if (brandstof){ kies('ddlBrandstof', brandstof.value); gedaan.push(brandstof.text); await slaap(300); } else mist.push('brandstof');
    const automaat = opties('ddlTransmissie').find(o => /autom/i.test(o.text));
    if (automaat){ kies('ddlTransmissie', automaat.value); gedaan.push(automaat.text); await slaap(300); }
    const model = zoekModel(v, merk.text);
    if (model){ kies('ddlModel', model.value); gedaan.push(model.text); } else mist.push('model');
    return { gedaan, mist };
  }
  async function startpagina() {
    if (!veld('ddlBouwjaar')) return;
    let r;
    try { r = await chrome.runtime.sendMessage({ type: 'atx-vraag' }); } catch (e) { return; }
    if (!r || !r.voertuig) return;
    try { await chrome.runtime.sendMessage({ type: 'atx-ingevuld' }); } catch (e) { /* niet erg */ }   // maar één keer invullen
    if (!r.voertuig.jaar){ invulMelding('KAAP: geen eerste toelating bij deze kandidaat; vul de zoekvelden zelf in.'); return; }
    const uit = await vulIn(r.voertuig);
    if (!uit) return;
    invulMelding(`KAAP: ${uit.gedaan.join(', ')} ingevuld.${uit.mist.length ? ' Niet gevonden: ' + uit.mist.join(', ') + '; kies dat zelf.' : ''} Klik op Zoeken en kies de uitvoering.`);
    const knop = document.getElementById('btnHandmatigZoeken');
    if (knop) try { knop.focus(); } catch (e) { /* niet erg */ }
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

  startpagina();
  kijk();
  // De pagina werkt deels zonder herladen (ASP.NET); daarom ook kijken als er iets verandert.
  let wacht = null;
  new MutationObserver(() => { clearTimeout(wacht); wacht = setTimeout(kijk, 400); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();
