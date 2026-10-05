Testset KAAP Factuur-App (Node.js + jsdom)

  cd tests
  npm init -y && npm install jsdom
  node test.mjs ../index.html

50 tests: versielabel, fiscale kern (BTW/marge/rest-BPM/afleverpakket),
specificatie en totalen, export/import in bundelformaat, back-upmap,
sluitwaarschuwing, concept, nummering, voorraadafleiding, periodefilter,
datumcontrole, nummerslot, extra kosten in overzichten, sorteren en CSV,
klantentab, Drive-hersync, lettertype-terugval, naam linksboven
en ongewijzigd factuurlogo.
