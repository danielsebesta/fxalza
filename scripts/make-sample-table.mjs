// Builds data/sample/ceny.html: every sampled product with the fetched price in every price list.
//   node scripts/make-sample-table.mjs
import { readFileSync, writeFileSync } from "node:fs";

const prices = JSON.parse(readFileSync(new URL("../data/sample/prices.json", import.meta.url), "utf8"));
const LISTS = [
  ["Basic", "p__26752"],
  ["Bronze", "p_pg5_44266"],
  ["Silver", "p_pg3_36eef"],
  ["Gold", "p_pg4_e6c95"],
  ["ISIC", "p_pg3is1_2b2fc"],
  ["B2B", "p_pg6_6ce49"],
  ["Gold+B2B", "p_pg2_a25f3"],
  ["Silver+B2B", "p_pg1cd1_af922"],
  ["Gold+ISIC", "p_pg4is1_24abf"],
  ["Bronze+ISIC", "p_pg5is1_16aa0"],
];

const slug = (url) => (/alza\.cz\/([^/]+?)(?:-d\d+)?\.htm/.exec(url) ?? [])[1] ?? "";
const words = (s) => s.replace(/-/g, " ");

const rows = prices.map((p) => [
  p.id,
  words(slug(p.url)),
  words((/alza\.cz\/(.+)\/\d+\.htm/.exec(p.category) ?? [])[1] ?? "").replace("/", " / "),
  p.url,
  LISTS.map(([name]) => {
    const e = p.prices[name];
    return e ? [e.price, e.label, e.groupType, e.priceType, e.promos?.length ?? 0] : null;
  }),
]);

const data = JSON.stringify({ lists: LISTS, fetched: [prices[0].fetchedAt, prices.at(-1).fetchedAt], rows }).replace(/</g, "\\u003c");

const html = `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fxalza – ceny ve všech ceníkách</title>
<style>
  :root { --bg:#fff; --fg:#1b1f24; --muted:#5b6570; --line:#d9dee3; --card:#f5f7f9; --accent:#0a6bd6; --best:#18794e; --warn:#b4540a; }
  @media (prefers-color-scheme: dark) { :root { --bg:#16191d; --fg:#e6e9ec; --muted:#98a2ad; --line:#2d333a; --card:#1f2328; --accent:#6cb0ff; --best:#58c48c; --warn:#f0a35e; } }
  * { box-sizing:border-box; }
  :root { color-scheme: light dark; }
  html, body { height:100%; overflow:hidden; }
  body { height:100dvh; margin:0; background:var(--bg); color:var(--fg); font:12px/1.25 system-ui,"Segoe UI",sans-serif; display:flex; flex-direction:column; }
  header { padding:4px 8px; border-bottom:1px solid var(--line); display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
  h1 { font-size:13px; margin:0; }
  .sub { color:var(--muted); margin:0; font-size:11px; }
  .tools { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  input[type=search] { padding:2px 6px; width:220px; border:1px solid var(--line); border-radius:4px; background:var(--card); color:var(--fg); font:inherit; }
  label { color:var(--muted); display:flex; gap:4px; align-items:center; }
  .wrap { flex:1 1 0; min-height:0; overflow-y:scroll; overflow-x:auto; scrollbar-width:auto; }
  table { border-collapse:collapse; width:100%; font-variant-numeric:tabular-nums; }
  th, td { padding:1px 5px; border-bottom:1px solid var(--line); text-align:right; white-space:nowrap; }
  th { position:sticky; top:0; background:var(--card); z-index:2; cursor:pointer; vertical-align:bottom; font-weight:600; }
  th small { display:block; font:9px ui-monospace,Consolas,monospace; color:var(--muted); font-weight:400; }
  th.l, td.l { text-align:left; }
  td.name { white-space:normal; min-width:160px; width:30%; }
  td.name span { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; word-break:break-word; }
  td.id { color:var(--muted); }
  td.id a { color:var(--accent); text-decoration:none; }
  td small { color:var(--muted); font-size:10px; margin-left:3px; }
  td.best { color:var(--best); font-weight:600; }
  td.none { color:var(--muted); }
  tr:hover td { background:var(--card); }
  .count { color:var(--muted); }
</style>
</head>
<body>
<header>
  <h1>Ceny ve všech ceníkách</h1>
  <div class="tools">
    <input type="search" id="q" placeholder="Hledat podle názvu, ID nebo kategorie">
    <label><input type="checkbox" id="onlyClub"> jen produkty s klubovou cenou</label>
    <span class="count" id="count"></span>
  </div>
  <p class="sub" id="sub"></p>
</header>
<div class="wrap"><table><thead id="head"></thead><tbody id="body"></tbody></table></div>
<script id="data" type="application/json">${data}</script>
<script>
  const D = JSON.parse(document.getElementById("data").textContent);
  const fmt = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 });
  const lists = D.lists;
  let sortKey = null, sortDir = 1;
  const f = D.fetched.map((t) => new Date(t).toLocaleString("cs-CZ"));
  document.getElementById("sub").textContent = D.rows.length + " produktů · staženo " + f[0] + " – " + f[1] + " · Kč, sleva proti Basic, zeleně nejnižší";

  const head = document.getElementById("head");
  head.innerHTML = "<tr>" +
    '<th class="l" data-k="id">ID</th><th class="l" data-k="name">Produkt</th>' +
    lists.map(([n, p], i) => '<th data-k="' + i + '">' + n + "<small>" + p + "</small></th>").join("") + "</tr>";

  const hasClub = (r) => r[4].slice(1).some((e) => e && e[2] !== 0 && r[4][0] && e[0] < r[4][0][0] - 0.004);

  function render() {
    const q = document.getElementById("q").value.trim().toLowerCase();
    const only = document.getElementById("onlyClub").checked;
    let rows = D.rows.filter((r) => (!q || (r[0] + " " + r[1] + " " + r[2]).toLowerCase().includes(q)) && (!only || hasClub(r)));
    if (sortKey !== null) {
      const val = (r) => sortKey === "id" ? Number(r[0]) : sortKey === "name" ? r[1] : (r[4][sortKey] ? r[4][sortKey][0] : Infinity);
      rows = rows.slice().sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sortDir; });
    }
    document.getElementById("count").textContent = rows.length + " z " + D.rows.length;
    document.getElementById("body").innerHTML = rows.map((r) => {
      const basic = r[4][0] ? r[4][0][0] : null;
      const min = Math.min(...r[4].map((e) => (e && e[0] != null ? e[0] : Infinity)));
      const cells = r[4].map((e, i) => {
        if (!e || e[0] == null) return '<td class="none">–</td>';
        const club = i > 0 && e[2] !== 0 && basic !== null && e[0] < basic - 0.004;
        const pct = club ? " (−" + Math.floor((basic - e[0]) / basic * 100) + " %)" : "";
        const best = e[0] === min && min < basic - 0.004;
        const title = (e[1] || "bez popisku") + " · skupina " + e[2] + " · typ " + e[3] + (e[4] ? " · akční ceny: " + e[4] : "");
        return '<td class="' + (best ? "best" : "") + '" title="' + title.replace(/"/g, "&quot;") + '">' + fmt.format(e[0]) + (pct ? "<small>" + pct + "</small>" : "") + "</td>";
      }).join("");
      const name = r[1].replace(/&/g, "&amp;").replace(/</g, "&lt;");
      return '<tr><td class="l id"><a href="' + r[3] + '" target="_blank" rel="noopener">' + r[0] + '</a></td><td class="l name" title="' + name + '"><span>' + name + '</span></td>' + cells + "</tr>";
    }).join("");
  }
  head.addEventListener("click", (e) => {
    const th = e.target.closest("th"); if (!th) return;
    const k = th.dataset.k === "id" || th.dataset.k === "name" ? th.dataset.k : Number(th.dataset.k);
    sortDir = sortKey === k ? -sortDir : 1; sortKey = k; render();
  });
  document.getElementById("q").addEventListener("input", render);
  document.getElementById("onlyClub").addEventListener("change", render);
  render();
</script>
</body>
</html>
`;

writeFileSync(new URL("../data/sample/ceny.html", import.meta.url), html);
console.log(`data/sample/ceny.html written: ${rows.length} products, ${(html.length / 1024).toFixed(0)} kB`);
