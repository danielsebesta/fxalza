// Dočasný pokus: pošle požadavek na Alzu z Cloudflare a vrátí odpověď i se stavem. Jen s tajným tokenem a jen na hosty Alzy.
const HOSTS = /^(www|webapi)\.alza\.(cz|sk|hu|de|at|co\.uk)$/;
export default {
  async fetch(req, env) {
    if (!env.TOKEN || req.headers.get("x-token") !== env.TOKEN) return new Response("no", { status: 401 });
    const target = new URL(req.url).searchParams.get("url");
    let u;
    try { u = new URL(target); } catch { return new Response("bad url", { status: 400 }); }
    if (u.protocol !== "https:" || !HOSTS.test(u.hostname)) return new Response("host not allowed", { status: 400 });
    const r = await fetch(u.toString(), {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        accept: req.headers.get("accept") ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "cs-CZ,cs;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });
    const h = new Headers({ "content-type": r.headers.get("content-type") ?? "text/plain", "x-upstream-status": String(r.status), "x-cf-mitigated": r.headers.get("cf-mitigated") ?? "" });
    return new Response(r.body, { status: 200, headers: h });
  },
};
