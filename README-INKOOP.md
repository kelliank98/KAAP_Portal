# KAAP Inkoop Radar v1.43

Eén pagina (`inkoop.html`) die je zoekcriteria vertaalt naar zoeklinks op twaalf sites, resultaten toont die de ophaler of de proxy heeft gevonden, en per auto een BPM-, kostprijs- en marge-indicatie geeft. Opslag in de browser (localStorage), exporteerbaar als JSON.

De wijzigingsgeschiedenis staat in de app zelf: klik op het versienummer in de kop. Die lijst is de enige bron; dit bestand herhaalt hem niet.

## Wat zit erin

| Bestand | Doel | Waar plaatsen |
| --- | --- | --- |
| `inkoop.html` | de app | hoofdmap van de repo (naast `index.html`, dat is de Factuur Generator) |
| `test/inkoop.test.mjs`, `test/proxy.test.mjs` | geautomatiseerde tests van app en proxy | `test/` |
| `package.json` | alleen voor de test (`npm test`), de app heeft geen pakketten nodig | hoofdmap |
| `profiles.json` | je zoekprofielen, geëxporteerd uit de app | hoofdmap |
| `results.json` | gevonden advertenties, geschreven door de ophaler | wordt door de workflow aangemaakt |
| `tools/inkoop-fetch.mjs` | de ophaler (Node 20, geen pakketten) | `tools/` |
| `tools/kaap-proxy.js` | Cloudflare Worker (v1.01) voor live zoeken vanuit de app | Cloudflare, niet in Pages |
| `tools/kaap-check.mjs` | weekcontrole van sites, parsers en proxy | `tools/` |
| `.github/workflows/inkoop-radar.yml` | draait de ophaler elke 2 uur | `.github/workflows/` |
| `.github/workflows/weekcontrole.yml` | draait de weekcontrole elke zondag | `.github/workflows/` |
| `KAAP-Inkoop-Radar-v1.43_2026-09-27.html` | gedateerde archiefkopie van de app | bewaren, niet plaatsen |

## Uiterlijk

Donker thema met dezelfde kleuren, kaarten en knoppen als KAAP Studio, en het KAAP-logo in de kop. Het lettertype is dat van het systeem; de app laadt geen externe stylesheets of lettertypes meer.

## Wat het wel en niet doet

- **Wel**: links bouwen voor mobile.de, AutoScout24 DE/NL/BE, Kleinanzeigen, Gaspedaal, Marktplaats, 2dehands, 2ememain, Gocar, Vroom en Bilbasen; resultaten tonen (met foto en link) van AutoScout24 DE/NL/BE, Kleinanzeigen, Marktplaats, 2dehands en 2ememain, live via de proxy of uit `results.json`; nieuwe advertenties, prijsdalingen en scherp geprijsde auto's markeren; BPM-indicatie per auto (forfaitair, of met koerslijst-afschrijving); kostprijs en marge per kandidaat; kenteken opzoeken en CO2 schatten via RDW open data; optioneel e-mail bij nieuwe advertenties.
- **Niet**: resultaten ophalen van mobile.de, Gaspedaal, Gocar, Vroom en Bilbasen (die blokkeren geautomatiseerd ophalen). Daar blijft de eigen alert van de site het kanaal, en de bladwijzer *KAAP teller* om het aantal treffers terug te melden.

## Stand van zaken (22-09-2026)

Alles draait in `kelliank98/KAAP_Portal`: app op GitHub Pages, ophaler in `tools/`, workflow elke 2 uur, schrijfrechten aan, en de proxy op `https://kaap-proxy.kelliankaap.workers.dev/` (staat standaard ingevuld in de app). Nog niet ingesteld: de mailsecrets `MAIL_TO`, `MAIL_USERNAME`, `MAIL_PASSWORD`.

**Na v1.36 eenmalig doen (proxy afschermen):**

1. Cloudflare: de nieuwe `tools/kaap-proxy.js` in de Worker plakken en deployen.
2. Cloudflare: *Settings > Variables* een variabele `PROXY_KEY` aanmaken met een zelfgekozen sleutel (een lang wachtwoord).
3. GitHub: *Settings > Secrets and variables > Actions* een secret `PROXY_KEY` met dezelfde waarde, anders faalt de kolom "App (via proxy)" van de weekcontrole.
4. In de app op GitHub Pages hoeft niets: die wordt op herkomst toegelaten. Draai je de app lokaal, vul dan de sleutel in bij *Instellingen > Proxy-sleutel*.

Zolang stap 1 en 2 niet zijn gedaan, werkt de oude Worker gewoon door (zonder afscherming).

## Testen

Vóór elke oplevering:

```
npm install     # eenmalig, installeert alleen jsdom
npm test
```

De tests draaien zonder netwerk en controleren 76 punten. `test/inkoop.test.mjs` laadt de app in jsdom: BPM-referentiegevallen per tarieftabel (benzine, diesel, PHEV, diesel-PHEV, EV vóór en na 2025, NEDC/WLTP rond 1 juli 2020), forfaitaire afschrijving, koerslijst-afschrijving, kostprijs en marge per land, prijsbenchmark, de URL en API-URL per site voor een vast profiel (BMW X5 M Sport), model-koppelingen, parserfouten, sitestatus, ophaler-status, bladwijzerversie en de UI (versienummer op drie plekken gelijk, opslag in localStorage, export van `profiles.json`). `test/proxy.test.mjs` test de toegangscontrole van de Worker. Een ander bestand testen: `INKOOP_HTML=pad/naar/bestand.html node --test`.

De BPM-referentiewaarden zijn met de hand uit de tarieftabellen uitgerekend en staan als berekening in het testbestand. Wijzig je een tabel, dan hoort daar een bron van de Belastingdienst bij en een nieuw referentiegeval.

## Installatie (eenmalig, ~15 minuten)

1. Upload `inkoop.html` en `profiles.json` naar de hoofdmap van de repo (GitHub: *Add file > Upload files*).
2. Upload `tools/inkoop-fetch.mjs` naar een map `tools` en `.github/workflows/inkoop-radar.yml` naar `.github/workflows` (mappen ontstaan door de padnaam bij *Create new file* in te typen).
3. Repo: *Settings > Actions > General > Workflow permissions* op **Read and write** zetten. Zonder dit kan de workflow `results.json` niet wegschrijven.
4. Open de app via GitHub Pages: `https://kelliank98.github.io/KAAP_Portal/inkoop.html`.

## Werkt voor elk merk en model

Merk en model zijn vrije velden; het model mag leeg blijven (dan zoek je het hele merk) en mag meerdere modellen bevatten (`X3, X5`). Wat de app zelf regelt:

- **AutoScout24** gebruikt Engelse modelnamen. De app rekent om: *5 Serie* wordt `5-series`, *V-Klasse* wordt `v-class`, *RS 6* wordt `rs6`. Klopt het toch niet, dan meldt de ophaler "0 resultaten" met de naam die AutoScout24 zelf gebruikt, en plak je die model-URL één keer.
- **Marktplaats, 2dehands, 2ememain**: de ophaler zoekt het model-id zelf op in de modellijst van de site. De app rekent elke advertentie zelf na op model, bouwjaar, km, prijs en automaat, omdat deze sites een deel van hun eigen filters negeren.
- **Kleinanzeigen** zoekt het model als woord in de titel, want hun eigen modelveld is per merk anders gevuld en wordt bij een onbekende waarde stil genegeerd. Heet het model in Duitsland anders, vul dan *Model op Duitse sites* in: `5er` in plaats van `5 Serie`.
- **mobile.de** blijft het enige waar je per model één keer de URL moet plakken; hun zoekmachine werkt met interne modelnummers. Merk-ID's staan in Instellingen.

## Eerste gebruik

1. Maak per model één scherp profiel (bijv. *X5 M Sport 2020+*). Sites staan standaard aan; zet uit wat je niet wilt.
2. Koppel modellen waar de app het niet zelf kan: mobile.de (altijd), en plak voor Gocar/Vroom de volledige zoek-URL. Eén keer per merk/model.
3. Open elke link één keer, controleer het resultaat en sla op de site de zoekopdracht op als alert (voor sites die de ophaler niet dekt is dat je enige melding).
4. *Instellingen > Exporteer profiles.json* en vervang `profiles.json` in de repo.
5. *Actions > Inkoop-radar > Run workflow*. Na 1 à 2 minuten staat `results.json` in de repo en toont de app de resultaten onder het profiel.
6. Na elke wijziging aan een profiel: stap 4 herhalen.

## Filteren op uitvoering en opties

- Zoekwoord (bijv. *M Sport*) is primair en werkt op alle sites; het zoekt in de titel.
- Gestructureerde opties (Sportpakket, panoramadak, enz.) zijn secundair: ze vangen minder dan het zoekwoord. Maximaal 2 à 3 per profiel, elk vinkje kost echte auto's.
- Prijs minimum en kW minimum zijn de meest betrouwbare ondergrens voor goed uitgeruste auto's. kW werkt op AutoScout24, mobile.de (`pw=`) en Kleinanzeigen (`autos.power_i`, omgerekend naar PS); beide live nagemeten op 22-09-2026.
- Het BTW/marge-filter werkt op mobile.de, Marktplaats, 2dehands en 2ememain; AutoScout24 en Kleinanzeigen kennen het niet. De app zegt dit onder het veld.
- **Scherp geprijsd**: in de resultaten krijgt een advertentie een label als hij 15% of meer (instelbaar) onder de mediaanprijs van hetzelfde model en bouwjaar in die zoekopdracht ligt, vanaf drie vergelijkbare auto's. Dat zijn de auto's die snel weg zijn.

## Kostprijs en marge per kandidaat

- **Kostprijs** = inkoop excl. BTW (bij een BTW-auto gedeeld door 1,19 voor DE, 1,21 voor NL/BE, 1,25 voor DK) + transport + importkosten + BPM.
- **BPM**: forfaitaire afschrijving is standaard. Vul je een percentage in bij *Afschrijving koerslijst / taxatie*, dan staan beide uitkomsten onder elkaar en gaat de koerslijst-uitkomst de kostprijs in. Voeg de koerslijst of het taxatierapport bij de aangifte.
- **Marge**: vul de verwachte verkoopprijs in Nederland in (incl. BTW). Bij een BTW-auto draag je 21% over de verkoop af; bij een margeauto alleen BTW over verkoop − inkoop (margeregeling). Marge = verkoop − BTW − kostprijs. De kolom Marge in de kandidatenlijst kleurt op de doelmarge uit Instellingen.

## Onderhoud

- **Bolletje in de kop** naast het versienummer: groen als de ophaler minder dan 3 uur geleden draaide, oranje tot 24 uur of bij een site met een fout, rood daarna of zonder `results.json`. Klik erop voor Instellingen.
- **Status live zoeken per site** (Instellingen): wanneer het ophalen via de proxy voor het laatst lukte en wat de laatste fout was. Een parserfout zegt of de pagina-opbouw is gewijzigd.
- **Bladwijzers** hebben een eigen versienummer dat in hun URL meegaat. Is de jouwe ouder, dan zegt de app dat bij gebruik en sleep je hem opnieuw.
- **Alles wissen** downloadt eerst een reservekopie.

## E-mail bij nieuwe advertenties (optioneel)

*Settings > Secrets and variables > Actions*: `MAIL_TO` (ontvanger), `MAIL_USERNAME` en `MAIL_PASSWORD` (Gmail-adres met app-wachtwoord). Zonder `MAIL_TO` wordt de mailstap overgeslagen. De eerste run mailt niet: alles is dan "nieuw".

## Beperkingen die je moet kennen

- Ophalen is scraping. Het breekt zodra een site zijn pagina verandert; de fout komt dan in het rood in de app te staan en de vorige resultaten blijven staan. Repareren kost een sessie. Weigert een site (403 of 429), dan probeert de app het na 2,5 seconde nog een keer; Kleinanzeigen blokkeert hele IP-reeksen tijdelijk en dat treft de proxy, niet jou.
- Kleinanzeigen en AutoScout24: 60 nieuwste per zoekopdracht; Marktplaats/2dehands/2ememain: 50 nieuwste. Voor alerts is dat ruim; voor marktanalyse niet.
- BPM is een indicatie: gunstigste tarief tussen 2 maanden vóór eerste toelating en keuringsdatum, tabellen 2017 t/m 2026. De geschatte bandbreedte bij advertenties zonder CO2 is een bereik, nooit één bedrag: reserveer het hoogste.
- De bladwijzers (kandidaat, teller, prijshistorie) en de extensie hangen aan de opmaak van de sites en breken onaangekondigd.
- Auctiekanalen (OPENLANE, BCA, Autorola) zitten er niet in: die vereisen een handelaarslogin en verbieden geautomatiseerd uitlezen.

## Werkregels

1. Eén bestand, localStorage-first, geen externe dependencies in de app (jsdom is alleen voor de test).
2. Elke wijziging krijgt een nieuw versienummer op drie plekken (kop, `APP_VERSIE`, bovenaan `VERSIES`); nooit twee builds met hetzelfde label. De test controleert dat ze gelijk zijn.
3. URL-parameters van sites alleen wijzigen na live verificatie, en daarna de verwachting in de test bijwerken.
4. Vóór oplevering `npm test`.
5. Oplevering als zip met `inkoop.html` plus gedateerde archiefkopie.
6. BPM-tabellen en -logica alleen aanpassen met bronvermelding van de Belastingdienst.
