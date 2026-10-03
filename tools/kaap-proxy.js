// KAAP proxy v1.02 (Cloudflare Worker)
// Haalt een pagina op namens de Inkoop Radar, zodat de browser niet tegen CORS aanloopt.
//
// Toegang: de Worker antwoordt alleen aan
//   1. de app op een toegestane herkomst (standaard https://kelliank98.github.io), of
//   2. een verzoek met de juiste sleutel: ?k=<PROXY_KEY>
// Zonder een van beide: 401. En alleen de autosites uit de lijst hieronder worden opgehaald.
//
// Let op: een browser kan zijn herkomst niet vervalsen, een programma wel. Regel 1 houdt dus
// andere websites en toevallige bezoekers tegen, maar niet iemand die deze code leest en de
// herkomst nabootst. Wil je dat ook uitsluiten, zet dan SLEUTEL_VERPLICHT aan (nieuw in v1.02):
// dan heeft ook de app de sleutel nodig (Instellingen > Proxy-sleutel).
//
// Variabelen in Cloudflare (Settings > Variables and Secrets):
//   PROXY_KEY          zelf gekozen sleutel (type Secret). Dezelfde waarde komt als secret PROXY_KEY
//                      in GitHub (voor de weekcontrole) en, bij SLEUTEL_VERPLICHT of lokaal gebruik,
//                      in de app bij Instellingen > Proxy-sleutel.
//   SLEUTEL_VERPLICHT  optioneel: "ja" = de sleutel is altijd nodig, ook vanaf de toegestane herkomst.
//   TOEGESTAAN         optioneel, komma-lijst van herkomsten (voor de sleutelvrije toegang en voor CORS),
//                      standaard https://kelliank98.github.io
//   BETAALD_KEY / BETAALD_URL / BETAALD_HOSTS   optioneel, betaalde IP's (zie onder).

export default {
  async fetch(request, env) {
    const herkomst = request.headers.get("Origin") || (() => {
      const r = request.headers.get("Referer");
      try { return r ? new URL(r).origin : ""; } catch (e) { return ""; }
    })();
    const toegestaan = ((env && env.TOEGESTAAN) || "https://kelliank98.github.io")
      .split(",").map(x => x.trim()).filter(Boolean);
    const cors = {
      "Access-Control-Allow-Origin": toegestaan.includes(herkomst) ? herkomst : toegestaan[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
      "Cache-Control": "no-store"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const params = new URL(request.url).searchParams;
    const sleutel = params.get("k") || "";
    const sleutelOk = !!(env && env.PROXY_KEY) && sleutel === env.PROXY_KEY;
    const verplicht = /^(1|ja|true|aan)$/i.test(String((env && env.SLEUTEL_VERPLICHT) || "").trim());
    const herkomstOk = toegestaan.includes(herkomst) && !verplicht;
    if (!herkomstOk && !sleutelOk) {
      const reden = (env && env.PROXY_KEY) ? "sleutel ontbreekt of klopt niet" : "PROXY_KEY is nog niet ingesteld in Cloudflare";
      return new Response("Geen toegang: " + reden, { status: 401, headers: cors });
    }

    const sites = [
      "marktplaats.nl", "2dehands.be", "2ememain.be",
      "autoscout24.nl", "autoscout24.de", "autoscout24.be",
      "kleinanzeigen.de", "mobile.de", "gaspedaal.nl", "bilbasen.dk"
    ];

    const doel = params.get("url");
    if (!doel) return new Response("Gebruik ?url=<adres>", { status: 400, headers: cors });

    let u;
    try { u = new URL(doel); } catch (e) { return new Response("Ongeldig adres", { status: 400, headers: cors }); }
    if (u.protocol !== "https:") return new Response("Alleen https", { status: 400, headers: cors });

    const ok = sites.some(d => u.hostname === d || u.hostname.endsWith("." + d));
    if (!ok) return new Response("Site niet toegestaan: " + u.hostname, { status: 403, headers: cors });

    // Betaalde IP's (optioneel). Zet in Cloudflare onder Variables:
    //   BETAALD_KEY    je sleutel bij de dienst
    //   BETAALD_URL    sjabloon, bijv. https://api.scraperapi.com/?api_key={key}&url={url}
    //   BETAALD_HOSTS  kleinanzeigen.de,mobile.de   (leeg = voor alle sites)
    // Zonder BETAALD_KEY verandert er niets: alles loopt zoals nu.
    const betaaldVoor = (host) => {
      if (!env || !env.BETAALD_KEY || !env.BETAALD_URL) return false;
      const lijst = (env.BETAALD_HOSTS || "").split(",").map(x => x.trim()).filter(Boolean);
      return lijst.length === 0 || lijst.some(d => host === d || host.endsWith("." + d));
    };

    const haalAdres = betaaldVoor(u.hostname)
      ? env.BETAALD_URL.replace("{key}", env.BETAALD_KEY).replace("{url}", encodeURIComponent(u.toString()))
      : u.toString();

    const r = await fetch(haalAdres, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "nl-NL,nl;q=0.9,de;q=0.8,en;q=0.7"
      },
      redirect: "follow"
    });

    const tekst = await r.text();
    return new Response(tekst, {
      status: r.status,
      headers: Object.assign({}, cors, { "Content-Type": r.headers.get("content-type") || "text/plain; charset=utf-8" })
    });
  }
};
