export default {
  async fetch(request) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const sites = [
      "marktplaats.nl", "2dehands.be", "2ememain.be",
      "autoscout24.nl", "autoscout24.de", "autoscout24.be",
      "kleinanzeigen.de", "mobile.de", "gaspedaal.nl", "bilbasen.dk"
    ];

    const doel = new URL(request.url).searchParams.get("url");
    if (!doel) return new Response("Gebruik ?url=<adres>", { status: 400, headers: cors });

    let u;
    try { u = new URL(doel); } catch (e) { return new Response("Ongeldig adres", { status: 400, headers: cors }); }
    if (u.protocol !== "https:") return new Response("Alleen https", { status: 400, headers: cors });

    const ok = sites.some(d => u.hostname === d || u.hostname.endsWith("." + d));
    if (!ok) return new Response("Site niet toegestaan: " + u.hostname, { status: 403, headers: cors });

    const r = await fetch(u.toString(), {
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
