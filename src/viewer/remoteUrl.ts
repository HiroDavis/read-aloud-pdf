/**
 * The narrowest host permission that lets the reader fetch one remote PDF:
 * its own scheme + host (+ port, if non-default), never `<all_urls>`.
 * Returns null for anything that isn't a well-formed http(s) URL — local
 * `file:` PDFs are governed by Chrome's separate "Allow access to file URLs"
 * toggle, and other schemes are never fetched.
 */
export function pdfOriginPattern(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // URL() lets "*" through in hostnames, and in a match pattern that's a
  // wildcard (https://*.example/*). Allow only DNS names (IDN arrives
  // punycoded), IPv4, or bracketed IPv6.
  if (!/^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])$/i.test(url.hostname)) return null;
  // `host` keeps a non-default port; match patterns accept it and it narrows the grant.
  return `${url.protocol}//${url.host}/*`;
}
