# KAAP Inkoop-radar v1.12

Eén pagina (`inkoop.html`) die je zoekcriteria vertaalt naar zoeklinks op 11 sites, resultaten toont die de ophaler heeft gevonden, en per auto een BPM- en kostprijsindicatie geeft. Opslag in de browser (localStorage), exporteerbaar als JSON.

## Wat zit erin

| Bestand | Doel | Waar plaatsen |
| --- | --- | --- |
| `inkoop.html` | de app | hoofdmap van de repo (naast `index.html`) |
| `profiles.json` | je zoekprofielen (bevat je BMW X3-profiel) | hoofdmap |
| `results.json` | gevonden advertenties, geschreven door de ophaler | wordt door de workflow aangemaakt |
| `tools/inkoop-fetch.mjs` | de ophaler (Node 20, geen pakketten) | `tools/` |
| `.github/workflows/inkoop-radar.yml` | draait de ophaler elke 2 uur | `.github/workflows/` |
| `KAAP-Inkoop-Radar-v1.12.html` | archiefkopie van de app | bewaren, niet plaatsen |

## Wat het wel en niet doet

- **Wel**: links bouwen voor mobile.de, AutoScout24 DE/NL/BE, Kleinanzeigen, Gaspedaal, Marktplaats, 2dehands, 2ememain, Gocar, Vroom en Bilbasen; resultaten tonen (met link) van AutoScout24 DE/NL/BE, Kleinanzeigen, Marktplaats, 2dehands en 2ememain; nieuwe advertenties markeren; BPM-indicatie per auto (AutoScout24 levert CO2 mee, dus daar automatisch); optioneel e-mail bij nieuwe advertenties.
- **Niet**: resultaten ophalen van mobile.de, Gaspedaal, Gocar, Vroom en Bilbasen (die blokkeren geautomatiseerd ophalen). Daar blijft de eigen alert van de site het kanaal. De app haalt zelf niets op; dat doet de ophaler in GitHub.

## Stand van zaken (13-09-2026)

Alles hieronder draait al in `kelliank98/KAAP_Portal`: app v1.07 op GitHub Pages, ophaler v1.06 in `tools/`, workflow elke 2 uur, schrijfrechten aan, en de proxy op `https://kaap-proxy.kelliankaap.workers.dev/` (ingesteld in de app). Nog niet ingesteld: de mailsecrets `MAIL_TO`, `MAIL_USERNAME`, `MAIL_PASSWORD`. Deze zip is de reservekopie; opnieuw installeren hoeft alleen na een ongeluk.

## Installatie (eenmalig, ~15 minuten)

1. Upload `inkoop.html` en `profiles.json` naar de hoofdmap van de repo (GitHub: *Add file > Upload files*).
2. Upload `tools/inkoop-fetch.mjs` naar een map `tools` en `.github/workflows/inkoop-radar.yml` naar `.github/workflows` (mappen ontstaan door de padnaam bij *Create new file* in te typen).
3. Repo: *Settings > Actions > General > Workflow permissions* op **Read and write** zetten. Zonder dit kan de workflow `results.json` niet wegschrijven.
4. Open de app via GitHub Pages: `https://kelliank98.github.io/KAAP-Portal/inkoop.html`.

## Werkt voor elk merk en model

Merk en model zijn vrije velden; het model mag leeg blijven (dan zoek je het hele merk). Wat de app zelf regelt:

- **AutoScout24** gebruikt Engelse modelnamen. De app rekent om: *5 Serie* wordt `5-series`, *V-Klasse* wordt `v-class`, *RS 6* wordt `rs6`. Klopt het toch niet, dan meldt de ophaler "0 resultaten" met de naam die AutoScout24 zelf gebruikt, en plak je die model-URL één keer.
- **Marktplaats, 2dehands, 2ememain**: de ophaler zoekt het model-id zelf op in de modellijst van de site. Zo werd *GLE* herkend als `gle-klasse`, *Range Rover Sport* als `Range Rover (sport)`, *RS 6* als `RS6`. Je hoeft dus niets meer te plakken.
- **Kleinanzeigen** zoekt het model als woord in de titel, want hun eigen modelveld is per merk anders gevuld en wordt bij een onbekende waarde stil genegeerd (dan krijg je het hele merk terug). Heet het model in Duitsland anders, vul dan *Model op Duitse sites* in: `5er` vindt 5 advertenties waar `5 Serie` er 0 vindt.
- **mobile.de** blijft het enige waar je per model één keer de URL moet plakken; hun zoekmachine werkt met interne modelnummers.

## Eerste gebruik

1. Maak per model één scherp profiel (bijv. *X5 M Sport 2020+*). Sites staan standaard aan; zet uit wat je niet wilt.
2. Koppel modellen waar de app het niet zelf kan: mobile.de (altijd), Marktplaats/2dehands (model-nummer), en plak voor Gocar/Vroom de volledige zoek-URL. Eén keer per merk/model.
3. Open elke link één keer, controleer het resultaat en sla op de site de zoekopdracht op als alert (voor sites die de ophaler niet dekt is dat je enige melding).
4. *Instellingen > Exporteer profiles.json* en vervang `profiles.json` in de repo.
5. *Actions > Inkoop-radar > Run workflow*. Na 1 à 2 minuten staat `results.json` in de repo en toont de app de resultaten onder het profiel.
6. Na elke wijziging aan een profiel: stap 4 herhalen.

## E-mail bij nieuwe advertenties (optioneel)

*Settings > Secrets and variables > Actions*: `MAIL_TO` (ontvanger), `MAIL_USERNAME` en `MAIL_PASSWORD` (Gmail-adres met app-wachtwoord). Zonder `MAIL_TO` wordt de mailstap overgeslagen. De eerste run mailt niet: alles is dan "nieuw".

## Beperkingen die je moet kennen

- Ophalen is scraping. Het breekt zodra een site zijn pagina verandert; de fout komt dan in het rood in de app te staan (`Ophalen mislukt`) en de vorige resultaten blijven staan. Repareren kost een sessie.
- Kleinanzeigen: 60 nieuwste per zoekopdracht; AutoScout24: 60 nieuwste; Marktplaats/2dehands/2ememain: 30 nieuwste. Voor alerts is dat ruim; voor marktanalyse niet.
- BPM is een indicatie: forfaitaire afschrijving, gunstigste tarief tussen 2 maanden vóór eerste toelating en keuringsdatum, tabellen 2017 t/m 2026. Koerslijst of taxatie kan lager uitkomen. Voor CO2 van Marktplaats/Kleinanzeigen-auto's vul je de waarde zelf in bij Kandidaten.
- 2ememain is dezelfde database als 2dehands (getest: identieke aantallen en dezelfde advertentie-nummers), alleen met een Franse interface. Staat standaard uit.
- Auctiekanalen (OPENLANE, BCA, Autorola) zitten er niet in: die vereisen een handelaarslogin en verbieden geautomatiseerd uitlezen in hun voorwaarden.

## Wijzigingen v1.12

- Het versienummer in de kop is aanklikbaar en opent de volledige wijzigingsgeschiedenis.

## Wijzigingen v1.11

- Weigert een site het verzoek (403 of 429), dan probeert de app het na 2,5 seconde nog een keer en legt daarna in gewone taal uit wat er speelt. Kleinanzeigen blokkeert hele IP-reeksen tijdelijk; dat treft de proxy-servers, niet jouw eigen verbinding. Gebruik zolang de knop *Op de site*.

## Wijzigingen v1.09 en v1.10

- Knop **Zelf uitrekenen** op elk buitenlands resultaat zonder CO2: neemt titel, link, land, prijs, kilometerstand, datum eerste toelating en brandstof over naar het BPM-formulier; alleen de CO2 vul je zelf in.
- **Geschatte BPM-bandbreedte** bij advertenties zonder CO2, berekend uit vergelijkbare auto's in dezelfde zoekopdracht (zelfde brandstof en bouwjaar, minstens drie waarnemingen). Getoond als een bereik, nooit als één bedrag: de CO2-spreiding binnen een model is gemeten op 12 tot 28 procent. Hou het hoogste bedrag aan als reservering. Zijn er geen vergelijkbare auto's, dan verschijnt er niets.
- Ophaler legt het prijsverloop vast (laatste zes wijzigingen) en toont hoelang een advertentie al in beeld is.

## Wijzigingen v1.08

- Meerdere modellen per zoekopdracht: `X3, X5` maakt links en resultaten per model, apart getoond en apart bijgehouden.
- Advertenties tonen hoelang ze al in beeld zijn, en bij een prijsdaling ook het verschil en het verloop (laatste 6 wijzigingen).
- Per zoekopdracht worden nu 50 in plaats van 30 advertenties opgehaald bij Marktplaats, 2dehands en 2ememain.
- `radar-lokaal.command` voor macOS toegevoegd, met launchd-bestand voor elke 2 uur.

## Wijzigingen v1.07.1

- `kaap-proxy.js` zonder commentaarblok en alleen ASCII, omdat een half geplakt commentaar de Worker liet vallen over `/*`.

## Wijzigingen v1.07

- **Zoeken** opent geen tabbladen meer. Browsers blokkeerden alles na het eerste tabblad, waardoor je alleen op mobile.de belandde.
- Met een eigen proxy toont **Zoeken** de resultaten direct in de app, met foto, per site gegroepeerd.
- Nieuw bestand `tools/kaap-proxy.js` plus uitleg hierboven.

## Wijzigingen v1.12

- Het versienummer in de kop is aanklikbaar en opent de volledige wijzigingsgeschiedenis.

## Wijzigingen v1.11

- Weigert een site het verzoek (403 of 429), dan probeert de app het na 2,5 seconde nog een keer en legt daarna in gewone taal uit wat er speelt. Kleinanzeigen blokkeert hele IP-reeksen tijdelijk; dat treft de proxy-servers, niet jouw eigen verbinding. Gebruik zolang de knop *Op de site*.

## Wijzigingen v1.09 en v1.10

- Knop **Zelf uitrekenen** op elk buitenlands resultaat zonder CO2: neemt titel, link, land, prijs, kilometerstand, datum eerste toelating en brandstof over naar het BPM-formulier; alleen de CO2 vul je zelf in.
- **Geschatte BPM-bandbreedte** bij advertenties zonder CO2, berekend uit vergelijkbare auto's in dezelfde zoekopdracht (zelfde brandstof en bouwjaar, minstens drie waarnemingen). Getoond als een bereik, nooit als één bedrag: de CO2-spreiding binnen een model is gemeten op 12 tot 28 procent. Hou het hoogste bedrag aan als reservering. Zijn er geen vergelijkbare auto's, dan verschijnt er niets.
- Ophaler legt het prijsverloop vast (laatste zes wijzigingen) en toont hoelang een advertentie al in beeld is.

## Wijzigingen v1.08

- Meerdere modellen per zoekopdracht: `X3, X5` maakt links en resultaten per model, apart getoond en apart bijgehouden.
- Advertenties tonen hoelang ze al in beeld zijn, en bij een prijsdaling ook het verschil en het verloop (laatste 6 wijzigingen).
- Per zoekopdracht worden nu 50 in plaats van 30 advertenties opgehaald bij Marktplaats, 2dehands en 2ememain.
- `radar-lokaal.command` voor macOS toegevoegd, met launchd-bestand voor elke 2 uur.

## Wijzigingen v1.07.1

- `kaap-proxy.js` zonder commentaarblok en alleen ASCII, omdat een half geplakt commentaar de Worker liet vallen over `/*`.

## Wijzigingen v1.07

- **Zoeken** opent geen tabbladen meer. Browsers blokkeren alles na de eerste pop-up, waardoor je alleen op mobile.de belandde. De knop zet nu de zoekopdrachten per site klaar en springt ernaartoe; je klikt zelf welke site je wilt. *Open alle in tabbladen* bestaat nog, en zegt het nu als de browser tabbladen tegenhoudt.

## Wijzigingen v1.06

- Resultaten zijn kaarten met een voorbeeldfoto per advertentie; foto en titel linken naar de advertentie.

## Wijzigingen v1.05

- Zoeken zonder bewaren is nu de hoofdweg: knop **Zoeken**, het tabblad heet *Zoeken*, bewaren heet *Bewaren voor meldingen*.
- Een niet-bewaarde zoekopdracht overleeft het sluiten van de app.
- Het resultatenblok legt uit dat het bij bewaarde zoekopdrachten hoort in plaats van een bestandsfout te tonen.

## Wijzigingen v1.04

- Bij 0 resultaten zegt de ophaler nu of het aan de modelnaam ligt of aan een te strakke filtercombinatie (met het aantal auto's van dat model op de site als ijkpunt).

## Wijzigingen v1.03

- Zoekwoorden, uitsluitingen en opties worden per merk onthouden en zijn met één klik te hergebruiken.
- Het resultatenbestand wordt op meerdere plekken gezocht (hoofdmap, `inkoop/`, bovenliggende map); de gevonden plek wordt onthouden. Staat het er nog niet, dan legt de app uit dat de ophaler nog moet draaien in plaats van een HTTP-foutmelding te tonen.
- Bug verholpen: bij het bewaren van een profiel werden alle aangevinkte vakjes op de pagina (ook sites, brandstof en carrosserie) in de optielijst meegeschreven.

## Wijzigingen v1.02

- Werkt nu voor elk merk/model, niet alleen de modellen waarvoor de slug toevallig klopte. Zie *Werkt voor elk merk en model*.
- Model mag leeg (hele merk). Nieuw veld: *Model op Duitse sites*.
- Marktplaats/2dehands/2ememain negeren sinds kort een deel van hun eigen attribuutfilters (waargenomen 12-09-2026: dezelfde API-URL gaf 's ochtends 1.334 en 's middags 121.895 treffers). De ophaler zoekt daarom op zoekwoord en **rekent elke advertentie zelf na** op merk, model, uitvoering, bouwjaar, km, prijs en automaat. Wat niet klopt wordt weggegooid en je krijgt een melding hoeveel.
- Kleinanzeigen: 403-fouten worden opnieuw geprobeerd met wachttijd (hun snelheidslimiet), en een profiel zonder model zoekt nu op merk in plaats van per ongeluk op het prijsfilter.

## Wijzigingen v1.01

- 2ememain.be toegevoegd (standaard uit).
- Bug verholpen: het vinkje *Plug-in hybride* stuurde op Marktplaats, 2dehands en 2ememain een tweede, slecht ingevuld kenmerk mee waardoor het aanbod kunstmatig kromp (X5-test: 31 in plaats van 1 op 2dehands, 262 in plaats van 243 op Marktplaats).

- Elke wijziging krijgt een nieuw versienummer (v1.02 enz.).
