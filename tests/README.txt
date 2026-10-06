Testset KAAP Factuur-App (Node.js + jsdom)

  cd tests
  npm init -y && npm install jsdom
  node test.mjs ../factuur.html

71 tests: versielabel, fiscale kern (BTW/marge/rest-BPM/afleverpakket),
specificatie en totalen, export/import in bundelformaat, back-upmap,
sluitwaarschuwing, concept, nummering, voorraadafleiding, periodefilter,
datumcontrole, nummerslot, extra kosten in overzichten, sorteren en CSV,
klantentab, Drive-hersync, ingebouwd lettertype Montserrat met terugval, lege inruil niet op papier, paginaverdeling bij printen, naam linksboven,
logo op de factuur (standaard, eigen logo, Drive en back-ups) en het
doorsturen van index.html naar factuur.html.
