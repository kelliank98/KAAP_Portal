# KAAP Inkoop Radar v1.52

Eén pagina (`inkoop.html`) die je zoekcriteria vertaalt naar zoeklinks op twaalf sites, resultaten toont die de ophaler, de proxy of de KAAP-extensie heeft gevonden, en per auto een BPM-, kostprijs- en marge-indicatie geeft. Opslag in de browser (localStorage), exporteerbaar als JSON.

De wijzigingsgeschiedenis staat in de app zelf: klik op het versienummer in de kop. Die lijst is de enige bron; dit bestand herhaalt hem niet.

## Wat zit erin

| Bestand | Doel | Waar plaatsen |
| --- | --- | --- |
| `inkoop.html` | de app | hoofdmap van de repo (naast `index.html`, dat is de Factuur Generator) |
| `kaap-extensie/` | de KAAP-extensie voor Chrome (v1.0.0): haalt mobile.de en Gaspedaal op voor de app | een vaste map op je computer, laden via `chrome://extensions` |
| `test/inkoop.test.mjs`, `test/lezers.test.mjs`, `test/extensie.test.mjs`, `test/proxy.test.mjs` | geautomatiseerde tests van app, paginalezers, extensie en proxy | `test/` |
| `test/fixtures/` | bewaarde voorbeeldpagina's van de sites, waar de tests tegen draaien | `test/fixtures/` |
| `test/e2e-extensie.mjs` | test van de extensie in een echte Chrome (`npm run test:browser`) | `test/` |
| `package.json` | alleen voor de test (`npm test`), de app heeft geen pakketten nodig | hoofdmap |
| `profiles.json` | je zoekprofielen, geëxporteerd uit de app | hoofdmap |
| `results.json` | gevonden advertenties, geschreven door de ophaler | wordt door de workflow aangemaakt |
| `tools/inkoop-fetch.mjs` | de ophaler (Node 20, geen pakketten) | `tools/` |
| `tools/kaap-proxy.js` | Cloudflare Worker (v1.02) voor live zoeken vanuit de app | Cloudflare, niet in Pages |
| `tools/kaap-check.mjs` | weekcontrole (v1.02) van sites, parsers en proxy | `tools/` |
| `.github/workflows/inkoop-radar.yml` | draait de ophaler elke 2 uur | `.github/workflows/` |
| `.github/workflows/weekcontrole.yml` | draait de weekcontrole elke zondag | `.github/workflows/` |
| `KAAP-Inkoop-Radar-v1.52_2026-10-05.html` | gedateerde archiefkopie van de app | bewaren, niet plaatsen |

## Uiterlijk

Donker thema met dezelfde kleuren, kaarten en knoppen als KAAP Studio, en het KAAP-logo in de kop. Het lettertype is dat van het systeem; de app laadt geen externe stylesheets of lettertypes meer.

## Wat het wel en niet doet

- **Wel**: links bouwen voor mobile.de, AutoScout24 DE/NL/BE, Kleinanzeigen, Gaspedaal, Marktplaats, 2dehands, 2ememain, Gocar, Vroom en Bilbasen; resultaten tonen (met foto en link) van AutoScout24 DE/NL/BE, Kleinanzeigen, Marktplaats, 2dehands en 2ememain, live via de proxy of uit `results.json`; met de KAAP-extensie ook van mobile.de en Gaspedaal; nieuwe advertenties, prijsdalingen en scherp geprijsde auto's markeren; een advertentie met één klik als kandidaat overnemen, met de gegevens uit de advertentie zelf; BPM-indicatie per auto (forfaitair, of met koerslijst-afschrijving); kostprijs en marge per kandidaat; kenteken opzoeken en CO2 schatten via RDW open data; optioneel e-mail bij nieuwe advertenties.
- **Niet**: resultaten ophalen van Gocar, Vroom en Bilbasen. Daar blijft de eigen alert van de site het kanaal. Zonder de extensie geldt dat ook voor mobile.de en Gaspedaal: die weigeren elk verzoek dat niet uit een gewone browser komt (HTTP 403, nagemeten op 03-10-2026, ook via de proxy).

## Stand van zaken (03-10-2026)

Alles draait in `kelliank98/KAAP_Portal`: app op GitHub Pages, ophaler in `tools/`, workflow elke 2 uur, schrijfrechten aan, en de proxy op `https://kaap-proxy.kelliankaap.workers.dev/` (staat standaard ingevuld in de app). Nieuw in v1.44 t/m v1.47: de KAAP-extensie (door de gebruiker geïnstalleerd en getest op 03-10-2026), de knop *Naar kandidaat*, het gelijk houden van twee tabbladen, en in v1.47 twee reparaties aan mobile.de en Kleinanzeigen. De proxy is sinds 03-10-2026 afgeschermd (zie hieronder). Nog niet gedaan: de mailsecrets `MAIL_TO`, `MAIL_USERNAME`, `MAIL_PASSWORD`.

**Proxy (afgeschermd sinds 03-10-2026):**

In Cloudflare draait `tools/kaap-proxy.js` v1.02 als Worker `kaap-proxy`. Hij antwoordt alleen aan de app op GitHub Pages of aan een verzoek met de sleutel, en haalt alleen de autosites uit zijn lijst op. Nagemeten van buitenaf op 03-10-2026: zonder herkomst 401, vanaf de app 200, een andere website 401, een site buiten de lijst 403. De app en de weekcontrole (v1.02) werken zonder sleutel; er is geen `PROXY_KEY` ingesteld.

Nieuwe proxy-code plaatsen is alleen nodig als `tools/kaap-proxy.js` wijzigt:

1. Kopieer de code: open `tools/kaap-proxy.js` op GitHub en klik op het kopieer-pictogram (*Copy raw file*).
2. Cloudflare: *Workers & Pages* > `kaap-proxy` > **Edit code**. Selecteer alles, plak de nieuwe code eroverheen en klik **Deploy**.
3. Controleer in de app: *Instellingen* > **Proxy testen**. Goed is "Proxy werkt".

**Extra slot (optioneel).** Een browser kan zijn herkomst niet vervalsen, een programma wel. Wie de code in deze openbare repo leest, kan de herkomst van de app dus nabootsen en de proxy toch gebruiken, zij het alleen voor de autosites uit de lijst. Wil je dat uitsluiten:

1. Cloudflare: bij de Worker *Settings* > *Variables and Secrets* > **Add**: type **Secret**, naam `PROXY_KEY`, waarde een zelfgekozen lange sleutel. Voeg daarna een variabele `SLEUTEL_VERPLICHT` toe (type Text) met de waarde `ja` en klik **Deploy**.
2. App: *Instellingen* > *Proxy-sleutel*: vul dezelfde sleutel in en klik **Proxy testen**. Dit doe je één keer per browser.
3. GitHub: repo *Settings* > *Secrets and variables* > *Actions* > **New repository secret**, naam `PROXY_KEY`, dezelfde waarde. Anders meldt de weekcontrole dat de proxy de sleutel vraagt.

De sleutel staat dan alleen in jouw browser, in Cloudflare en in GitHub. Hij komt niet in `profiles.json`; wel in de volledige reservekopie (*Exporteer JSON*), dus zet die niet in de repo. Draai je de app lokaal (niet vanaf GitHub Pages), dan heb je de sleutel ook nodig.

Terugdraaien kan in Cloudflare bij de Worker onder *Deployments*. Let op: de versies van 13-09-2026 zijn de oude, open proxy; zet die niet terug.

## KAAP-extensie: mobile.de en Gaspedaal in de app

mobile.de en Gaspedaal laten zich alleen door een gewone browser lezen. De extensie gebruikt daarom jouw eigen Chrome: op verzoek van de app opent hij de zoekpagina in een tabblad op de achtergrond, geeft de inhoud door aan de app en sluit het tabblad weer. De app leest de pagina zelf uit; al het rekenwerk zit dus in `inkoop.html` en de extensie hoeft bijna nooit te worden bijgewerkt.

**Installeren (eenmalig, 2 minuten, alleen Chrome op de computer):**

1. Zet de map `kaap-extensie` op een vaste plek, bijvoorbeeld in Documenten. Chrome leest de extensie elke keer uit die map; verplaats of verwijder hem daarna niet.
2. Open in Chrome het adres `chrome://extensions`.
3. Zet rechtsboven **Ontwikkelaarsmodus** aan.
4. Klik op **Uitgepakte extensie laden** en kies de map `kaap-extensie`.
5. Herlaad het tabblad van de app. In de kop staat nu het groene label **extensie**.

Daarna doet de knop *Zoeken* mobile.de en Gaspedaal vanzelf mee. Testen kan bij *Instellingen > KAAP-extensie > Extensie testen*.

**Wat de extensie mag en doet:**

- Hij heeft alleen toegang tot `mobile.de` en `gaspedaal.nl`, en luistert alleen naar de app op `kelliank98.github.io/KAAP_Portal`. Een adres van een andere site weigert hij. Verhuist de app naar een ander adres, pas dan `matches` in `kaap-extensie/manifest.json` aan.
- Hoogstens drie achtergrondtabbladen tegelijk, elk hoogstens 45 seconden. Tabbladen worden altijd gesloten, ook bij een fout.
- Toont mobile.de een controlepagina ("ben je een mens?"), dan wacht de extensie 12 seconden en meldt dat daarna eerlijk. Hij lost zo'n controle niet op en gaat er niet omheen. Open mobile.de dan één keer zelf via *Op de site* en zoek opnieuw.
- mobile.de werkt met interne modelnummers. De app zoekt het nummer bij de eerste zoekopdracht zelf op in de pagina, controleert het met een tweede pagina (minstens 60% van de titels moet het model noemen) en bewaart het pas daarna als model-koppeling. Plakken hoeft dus niet meer.
- Staat er binnen je filters weinig of niets van het model, dan vult mobile.de de pagina aan met "Ähnliche Fahrzeuge" van andere modellen. Die telt de app niet mee: je ziet alleen de echte treffers, of "Geen resultaten" (v1.47, live nagemeten op 03-10-2026).
- Vindt de app het modelnummer niet (mobile.de schrijft het model anders, of de pagina van het model is niet op te halen), dan toont hij alleen de auto's die het model in de titel hebben en zegt hij dat erbij. Auto's van het hele merk verschijnen nooit als resultaat van een model.
- Gaspedaal: de app leest de eerste pagina (100 nieuwste) en het totaal aantal. De links op de kaarten gaan naar de site waar de auto staat.

**Beperkingen:** de extensie is gebouwd voor en getest in Chrome op de computer (versie 154). Brave en Edge gebruiken dezelfde techniek, maar zijn met deze versie niet getest. Hij werkt niet op telefoon of tablet en niet in Safari of Firefox. Chrome toont bij het opstarten soms de melding dat er extensies in ontwikkelaarsmodus actief zijn; die kun je wegklikken. De ophaler op GitHub (elke 2 uur) kan mobile.de en Gaspedaal niet lezen: deze twee komen alleen binnen als jij in de app op *Zoeken* klikt.

**Voorwaarden van mobile.de:** de algemene voorwaarden van mobile.de (§11) verbieden het geautomatiseerd uitlezen van de site. De officiële weg is de Search-API voor handelaren (services.mobile.de, aan te vragen via de klantenservice). De extensie leest alleen pagina's die jij zelf opvraagt, in jouw browser, in een laag tempo, maar dat verandert de voorwaarden niet. Het gebruik is je eigen afweging.

## Naar kandidaat en Gegevens ophalen

- Bij elk resultaat staat de knop **Naar kandidaat**. De app neemt over wat op de kaart staat en haalt daarna de advertentie zelf op: prijs, BTW of marge, eerste toelating, kilometerstand, brandstof, PHEV, CO2 en kenteken. Bij een Nederlands kenteken vult de RDW daarna de exacte datum en CO2 aan.
- Een link die je ergens anders vandaan hebt: plak hem bij *Link van de advertentie* in het kandidaatformulier en klik **Gegevens ophalen**.
- Werkt voor AutoScout24 DE/NL/BE (ook Smyle), Marktplaats, 2dehands, 2ememain en Kleinanzeigen via de proxy, en voor mobile.de via de extensie. Voor andere sites (ook de doorstuurlinks van Gaspedaal) neemt de app alleen over wat op de kaart staat.
- Wat de advertentie niet noemt, blijft leeg of blijft staan zoals jij het invulde. Is de advertentie weg, dan zegt de app dat.
- De bladwijzers *KAAP kandidaat* en *KAAP teller* zijn vervallen (v1.45): ze gaven bij de controle op echte advertenties vaak een verkeerde prijs of een verkeerd aantal door. Verwijder ze uit je bladwijzerbalk (rechtsklik > *Delete*); ze staan alleen daar. De aantallen die de teller ooit in de app bewaarde, ruimt de app zelf op (v1.48).

## Kandidaten bijwerken (v1.49)

- Knop **Kandidaten bijwerken** boven de kandidatenlijst. De app haalt de advertentie van elke lopende kandidaat opnieuw op (niet bij status Gekocht of Afgewezen).
- In de lijst zie je per kandidaat: **↓ € 1.500 op 05-10** (prijs gedaald), **↑** (gestegen), **niet meer online**, **prijs ongewijzigd** of **kon niet lezen** (met de reden als je de muis erop houdt).
- Een nieuwe vraagprijs gaat in *Vraagprijs* en dus in kostprijs en marge; de oude prijzen blijven bewaard. De status verandert de app niet: dat kies je zelf.
- "Niet meer online" betekent dat de site zelf zegt dat de advertentie weg is: AutoScout24, Marktplaats en 2dehands geven dan HTTP 410, en AutoScout24 en Kleinanzeigen sturen een verdwenen advertentie door naar zoekresultaten (nagemeten op 05-10-2026). Bij mobile.de herkent de app dat nog niet zeker; dan staat er "kon niet lezen".
- Werkt voor dezelfde sites als *Gegevens ophalen*: AutoScout24, Marktplaats, 2dehands, 2ememain en Kleinanzeigen via de proxy, mobile.de via de extensie.

## Verwachte verkoopprijs NL (v1.51)

- Bij elk resultaat van *Zoeken* staat onder de prijs **verkoop NL ≈ € …**. Klik op het bedrag voor de vijf auto's waarop het rust, met links; de vetgedrukte is de verkoopprijs.
- Regel, zoals de gebruiker zelf prijst (goedgekeurd op 05-10-2026 na voorbeelden): je auto staat in de top 5 goedkoopste vergelijkbare auto's op Gaspedaal, en de verkoopprijs is de **3e van die 5**.
- Vergelijkbaar: zelfde motor (motorcode in de titel, zoals 45e of 30d; anders het vermogen ±12%), zelfde brandstof, km ±30.000, en niet over de facelift heen. Eerst auto's uit hetzelfde bouwjaar; zijn dat er minder dan 5, dan aangevuld met de goedkoopste uit een jaar ouder of nieuwer. Minder dan 5 vergelijkbare: geen bedrag. Dezelfde auto die twee keer op Gaspedaal staat (zelfde bouwjaar, km en prijs) telt één keer.
- **Facelift vanaf bouwjaar** vul je in bij het zoekprofiel (bijvoorbeeld X5: 2023). Gaspedaal noemt alleen het bouwjaar, dus het faceliftjaar zelf telt als "na de facelift". Bij de X5-hybrides houdt de motorcode het al uit elkaar (45e voor, 50e na); bij een motor die na de facelift dezelfde naam houdt (zoals de 30d) is het veld nodig.
- Bron is altijd Gaspedaal, dus alleen met de KAAP-extensie. Per model de eerste drie pagina's (tot 300 auto's), zonder je filters op prijs en uitvoering, met een bouwjaar ruimer en een kilometergrens 30.000 km ruimer. Twee uur bewaard.
- Voorbeelden op echte Gaspedaal-data (500 nieuwste X5's, 05-10-2026, facelift 2023): 45e 2020/165.000 km € 36.950; 45e 2021/120.000 km € 43.749; 45e 2022/60.000 km € 53.899; 50e 2024/30.000 km € 79.695; 30d 2020/150.000 km geen bedrag (2 vergelijkbare).
- **Naar kandidaat** vult de verkoopprijs in het kandidaatformulier in. Het zijn Nederlandse vraagprijzen, inclusief BPM.

## BPM volgens Autotelex (v1.50)

- In het kandidaatformulier staat het veld **BPM volgens Autotelex (€)**, direct onder Vraagprijs (v1.51). Vul je het in, dan gaat dat bedrag in kostprijs en marge in plaats van de indicatie van de app. De indicatie staat ernaast als controle, met het verschil. In de kandidatenlijst staat een **A** achter de BPM als die van Autotelex komt.
- Leeg laten betekent: de indicatie van de app, zoals voorheen.
- Automatisch ophalen uit Autotelex kan alleen via hun API. Die is niet gratis: Autotelex noemt de kosten alleen op aanvraag, en een BPM-berekening voor import staat niet tussen hun openbaar beschreven API's (nagezocht op 05-10-2026). Daarom vul je het bedrag zelf in.

## Doelmarge in procenten (v1.50)

- *Instellingen > Doelmarge (% van de kostprijs)*, per 1%, standaard 20%. De marge kleurt groen vanaf dat percentage, oranje eronder en rood bij verlies. In de kandidatenlijst staat het percentage achter het bedrag.

## Testen

Vóór elke oplevering:

```
npm install     # eenmalig, installeert alleen jsdom
npm test
```

De tests draaien zonder netwerk en controleren 173 punten:

- `test/inkoop.test.mjs` laadt de app in jsdom: BPM-referentiegevallen per tarieftabel (benzine, diesel, PHEV, diesel-PHEV, EV vóór en na 2025, NEDC/WLTP rond 1 juli 2020), forfaitaire afschrijving, koerslijst-afschrijving, kostprijs en marge per land, prijsbenchmark, de URL en API-URL per site voor een vast profiel (BMW X5 M Sport), model-koppelingen, parserfouten, sitestatus, ophaler-status en de UI (versienummer op drie plekken gelijk, opslag in localStorage, export van `profiles.json`).
- `test/lezers.test.mjs` test de paginalezers tegen bewaarde pagina's in `test/fixtures/`: zoekresultaten van mobile.de (ook bij weinig of geen treffers), Gaspedaal en Kleinanzeigen (nieuwe opbouw), advertenties van AutoScout24 DE/NL/BE en Smyle, Marktplaats, 2dehands, Kleinanzeigen en mobile.de, het zoeken met en zonder extensie, het leren van het modelnummer, de controlepagina, *Naar kandidaat*, *Kandidaten bijwerken*, de verwachte verkoopprijs NL en het gelijk houden van twee tabbladen.
- `test/extensie.test.mjs` test de achtergrond van de extensie met een nagebootste Chrome: rechten in het manifest, welke adressen mogen, wachten, opgeven bij een controlepagina, tijdslimiet, hoogstens drie tabbladen.
- `test/proxy.test.mjs` test de toegangscontrole van de Worker, ook met `SLEUTEL_VERPLICHT`.

Een ander bestand testen: `INKOOP_HTML=pad/naar/bestand.html node --test`.

De test in een echte browser hoort niet bij `npm test`, want hij heeft Chrome en internet nodig:

```
npm run test:browser
```

Die kiest een vrije poort, start Chrome met een leeg tijdelijk profiel, laadt een tijdelijke kopie van de extensie (met als enige verschil dat die ook naar de testpagina op `127.0.0.1` luistert), en controleert de brug met de app, de adresweigering, een echte Gaspedaal-pagina, het sluiten van tabbladen en het zoeken in de app. Let op de grens van deze test: mobile.de herkent een door een testprogramma bestuurde browser en toont dan een controlepagina. De test controleert in dat geval dat de extensie dat meldt en niets omzeilt; of mobile.de in jouw eigen Chrome resultaten geeft, zie je met *Extensie testen* in Instellingen.

De BPM-referentiewaarden zijn met de hand uit de tarieftabellen uitgerekend en staan als berekening in het testbestand. Wijzig je een tabel, dan hoort daar een bron van de Belastingdienst bij en een nieuw referentiegeval. De voorbeeldpagina's in `test/fixtures/` zijn ingekorte kopieën van echte pagina's van 03-10-2026. Namen van verkopers, adressen, telefoonnummers, advertentienummers, foto-adressen en kentekens zijn vervangen door verzonnen waarden, want de repo is openbaar; doe dat ook bij een nieuwe voorbeeldpagina. Verandert een site zijn opbouw, bewaar dan een nieuwe pagina en werk de lezer en de verwachting samen bij.

## Installatie (eenmalig, ~15 minuten)

1. Upload `inkoop.html` en `profiles.json` naar de hoofdmap van de repo (GitHub: *Add file > Upload files*).
2. Upload `tools/inkoop-fetch.mjs` naar een map `tools` en `.github/workflows/inkoop-radar.yml` naar `.github/workflows` (mappen ontstaan door de padnaam bij *Create new file* in te typen).
3. Repo: *Settings > Actions > General > Workflow permissions* op **Read and write** zetten. Zonder dit kan de workflow `results.json` niet wegschrijven.
4. Open de app via GitHub Pages: `https://kelliank98.github.io/KAAP_Portal/inkoop.html`.
5. Installeer de KAAP-extensie in Chrome (zie hierboven) als je mobile.de en Gaspedaal in de app wilt zien.

## Werkt voor elk merk en model

Merk en model zijn vrije velden; het model mag leeg blijven (dan zoek je het hele merk) en mag meerdere modellen bevatten (`X3, X5`). Wat de app zelf regelt:

- **AutoScout24** gebruikt Engelse modelnamen. De app rekent om: *5 Serie* wordt `5-series`, *V-Klasse* wordt `v-class`, *RS 6* wordt `rs6`. Klopt het toch niet, dan meldt de ophaler "0 resultaten" met de naam die AutoScout24 zelf gebruikt, en plak je die model-URL één keer.
- **Marktplaats, 2dehands, 2ememain**: de ophaler zoekt het model-id zelf op in de modellijst van de site. De app rekent elke advertentie zelf na op model, bouwjaar, km, prijs en automaat, omdat deze sites een deel van hun eigen filters negeren.
- **Kleinanzeigen** heeft op 03-10-2026 een nieuwe pagina-opbouw gekregen; de app leest de oude en de nieuwe. Het zoekt het model als woord in de titel, want hun eigen modelveld is per merk anders gevuld en wordt bij een onbekende waarde stil genegeerd. Heet het model in Duitsland anders, vul dan *Model op Duitse sites* in: `5er` in plaats van `5 Serie`.
- **mobile.de** werkt met interne modelnummers. Met de extensie zoekt de app het nummer zelf op en bewaart het. Zonder extensie plak je per model één keer de URL bij Model-koppeling. Merk-ID's staan in Instellingen.
- **Gaspedaal** zet merk, model en automaat in het pad (`/bmw/x5/automatisch`, live nagemeten op 03-10-2026). Zoekwoord en brandstof rekent de app zelf na in de resultaten.

## Eerste gebruik

1. Maak per model één scherp profiel (bijv. *X5 M Sport 2020+*). Sites staan standaard aan; zet uit wat je niet wilt.
2. Installeer de KAAP-extensie; dan regelt de app mobile.de zelf. Plak alleen voor Gocar en Vroom de volledige zoek-URL, één keer per merk/model.
3. Klik op *Zoeken* en controleer per site of het resultaat klopt. Sla op sites die de ophaler niet dekt (mobile.de, Gaspedaal, Gocar, Vroom, Bilbasen) de zoekopdracht op als alert van de site zelf: dat is daar je enige melding als de app dicht is.
4. *Instellingen > Exporteer profiles.json* en vervang `profiles.json` in de repo.
5. *Actions > Inkoop-radar > Run workflow*. Na 1 à 2 minuten staat `results.json` in de repo en toont de app de resultaten onder het profiel.
6. Na elke wijziging aan een profiel: stap 4 herhalen.

## Filteren op uitvoering en opties

- Zoekwoord (bijv. *M Sport*) is primair en werkt op alle sites; het zoekt in de titel.
- Gestructureerde opties (Sportpakket, panoramadak, enz.) zijn secundair: ze vangen minder dan het zoekwoord. Maximaal 2 à 3 per profiel, elk vinkje kost echte auto's.
- Prijs minimum en kW minimum zijn de meest betrouwbare ondergrens voor goed uitgeruste auto's. kW werkt op AutoScout24, mobile.de (`pw=`) en Kleinanzeigen (`autos.power_i`, omgerekend naar PS); beide live nagemeten op 22-09-2026. Geeft een site het vermogen mee in het resultaat, dan rekent de app het ook zelf na.
- Het BTW/marge-filter werkt op mobile.de, Marktplaats, 2dehands en 2ememain; AutoScout24 en Kleinanzeigen kennen het niet. De app zegt dit onder het veld.
- **Scherp geprijsd**: in de resultaten krijgt een advertentie een label als hij 15% of meer (instelbaar) onder de mediaanprijs van hetzelfde model en bouwjaar in die zoekopdracht ligt, vanaf drie vergelijkbare auto's. Dat zijn de auto's die snel weg zijn.

## Kostprijs en marge per kandidaat

- Het blok naast het kandidaatformulier heet *Marge en kostprijs* (v1.52): bovenaan groot de marge met het percentage, daaronder de kostprijs. Van de BPM staat alleen het bedrag erin: van Autotelex als je dat invult, anders de indicatie van de app (forfaitair of met je koerslijstpercentage).

- **Kostprijs** = inkoop excl. BTW (bij een BTW-auto gedeeld door 1,19 voor DE, 1,21 voor NL/BE, 1,25 voor DK) + transport + importkosten + BPM.
- **BPM**: forfaitaire afschrijving is standaard. Vul je een percentage in bij *Afschrijving koerslijst / taxatie*, dan staan beide uitkomsten onder elkaar en gaat de koerslijst-uitkomst de kostprijs in. Voeg de koerslijst of het taxatierapport bij de aangifte.
- **BPM volgens Autotelex**: vul je die in, dan gaat dat bedrag in de kostprijs in plaats van de indicatie van de app (v1.50).
- **Marge**: vul de verwachte verkoopprijs in Nederland in (incl. BTW). Bij een BTW-auto draag je 21% over de verkoop af; bij een margeauto alleen BTW over verkoop − inkoop (margeregeling). Marge = verkoop − BTW − kostprijs. De kolom Marge in de kandidatenlijst kleurt op de doelmarge uit Instellingen (een percentage van de kostprijs, standaard 20%).

## Onderhoud

- **Bolletje in de kop** naast het versienummer: groen als de ophaler minder dan 3 uur geleden draaide, oranje tot 24 uur of bij een site met een fout, rood daarna of zonder `results.json`. Klik erop voor Instellingen.
- **Label extensie in de kop**: staat er alleen als de KAAP-extensie in deze browser actief is. Ontbreekt het na een update van Chrome of na het verplaatsen van de map, laad de extensie dan opnieuw via `chrome://extensions`.
- **Status live zoeken per site** (Instellingen): wanneer het ophalen via de proxy of de extensie voor het laatst lukte en wat de laatste fout was. Een parserfout zegt of de pagina-opbouw is gewijzigd.
- **Twee tabbladen**: staat de app in twee tabbladen open, dan neemt het ene tabblad over wat je in het andere bewaart. Een formulier dat je aan het invullen bent blijft staan.
- **Bladwijzer prijshistorie** (AutoScout24) heeft een eigen versienummer dat in zijn URL meegaat. Is de jouwe ouder, dan zegt de app dat bij gebruik en sleep je hem opnieuw.
- **Alles wissen** downloadt eerst een reservekopie.

## E-mail bij nieuwe advertenties (optioneel)

*Settings > Secrets and variables > Actions*: `MAIL_TO` (ontvanger), `MAIL_USERNAME` en `MAIL_PASSWORD` (Gmail-adres met app-wachtwoord). Zonder `MAIL_TO` wordt de mailstap overgeslagen. De eerste run mailt niet: alles is dan "nieuw".

## Beperkingen die je moet kennen

- Ophalen is scraping. Het breekt zodra een site zijn pagina verandert; de fout komt dan in het rood in de app te staan en de vorige resultaten blijven staan. Repareren kost een sessie. Weigert een site (403 of 429), dan probeert de app het na 2,5 seconde nog een keer; Kleinanzeigen blokkeert hele IP-reeksen tijdelijk en dat treft de proxy, niet jou.
- De teller van Kleinanzeigen is ruimer dan wat de pagina toont (gemeten: "1 - 25 von 30" met 13 advertenties in de pagina); de app toont wat in de pagina staat.
- Kleinanzeigen en AutoScout24: 60 nieuwste per zoekopdracht; Marktplaats/2dehands/2ememain: 50 nieuwste; Gaspedaal: 100 nieuwste; mobile.de: de eerste pagina. Voor alerts is dat ruim; voor marktanalyse niet.
- mobile.de en Gaspedaal komen alleen binnen via de extensie, dus alleen in Chrome op de computer en alleen als je zelf zoekt. De e-mail bij nieuwe advertenties dekt deze twee niet.
- BPM is een indicatie: gunstigste tarief tussen 2 maanden vóór eerste toelating en keuringsdatum, tabellen 2017 t/m 2026. De geschatte bandbreedte bij advertenties zonder CO2 is een bereik, nooit één bedrag: reserveer het hoogste.
- De paginalezers, de extensie en de bladwijzer prijshistorie hangen aan de opmaak van de sites en breken onaangekondigd. Controleer bij een kandidaat altijd de prijs en de eerste toelating tegen de advertentie voordat je biedt.
- Auctiekanalen (OPENLANE, BCA, Autorola) zitten er niet in: die vereisen een handelaarslogin en verbieden geautomatiseerd uitlezen.

## Werkregels

1. Eén bestand, localStorage-first, geen externe dependencies in de app (jsdom is alleen voor de test; de extensie is een losse map en bevat geen kennis van de sites).
2. Elke wijziging krijgt een nieuw versienummer op drie plekken (kop, `APP_VERSIE`, bovenaan `VERSIES`); nooit twee builds met hetzelfde label. De test controleert dat ze gelijk zijn. De extensie heeft een eigen versienummer in `manifest.json`.
3. URL-parameters van sites alleen wijzigen na live verificatie, en daarna de verwachting in de test bijwerken.
4. Vóór oplevering `npm test`.
5. Oplevering als zip met `inkoop.html` plus gedateerde archiefkopie.
6. BPM-tabellen en -logica alleen aanpassen met bronvermelding van de Belastingdienst.
