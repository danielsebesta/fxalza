export interface Parsed {
  id: string;
  path: string;
}

// Anything after the canonical ".../slug-d123.htm" (or the bare id forms) means the user changed the link on purpose.
export function hasCacheBustSuffix(pathname: string): boolean {
  return !/(?:-d\d{1,12}(?:\.htm)?|\/d?\d{1,12})\/?$/i.test(pathname);
}

// Some Alza links carry the product id only in ?dq=<id> and have no -d<id> in the path (e.g. /gaming/grand-theft-auto-v-gta-5?dq=6496142).
export function parseProductPath(pathname: string, dq?: string | null): Parsed | null {
  const slug = pathname.match(/^(\/[A-Za-z0-9._~%/-]*?-d(\d{1,12}))(?:\.[A-Za-z0-9]+)?\/?$/i);
  if (slug) return { id: slug[2]!, path: `${slug[1]}.htm` };
  const bare = pathname.match(/^\/d?(\d{1,12})\/?$/i);
  if (bare) return { id: bare[1]!, path: `/-d${bare[1]}.htm` };
  const last = [...pathname.matchAll(/-d(\d{1,12})(?!\d)/gi)].pop();
  if (!last) return pathname.length > 1 && dq && /^\d{1,12}$/.test(dq) ? { id: dq, path: `/-d${dq}.htm` } : null;
  const head = pathname.slice(0, last.index + last[0].length);
  return { id: last[1]!, path: /^\/[A-Za-z0-9._~%/-]*$/.test(head) ? `${head}.htm` : `/-d${last[1]}.htm` };
}
