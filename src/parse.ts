export interface Parsed {
  id: string;
  path: string;
}

export function parseProductPath(pathname: string): Parsed | null {
  const slug = pathname.match(/^(\/[A-Za-z0-9._~%/-]*?-d(\d{1,12}))(?:\.[A-Za-z0-9]+)?\/?$/i);
  if (slug) return { id: slug[2]!, path: `${slug[1]}.htm` };
  const bare = pathname.match(/^\/d?(\d{1,12})\/?$/i);
  if (bare) return { id: bare[1]!, path: `/-d${bare[1]}.htm` };
  const any = pathname.match(/-d(\d{1,12})(?!\d)/i);
  return any ? { id: any[1]!, path: `/-d${any[1]}.htm` } : null;
}
