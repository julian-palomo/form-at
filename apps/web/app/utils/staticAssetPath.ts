// Whether a request path is a file under `public/` (served by Cloudflare
// Pages' asset layer) rather than a page the app renders. Only the shape of
// the path is known here: a last segment ending in `.` plus a short
// extension, 1 to 12 characters (`.js`, `.woff2`, `.webmanifest`).
//
// The length bound is what keeps a ticket's page out of the asset layer. A
// ticket URL is `/tickets/<id>.<signature>`, and the 43-character base64url
// signature has no `-` or `_` in it one time in four; without the bound such
// a path reads as "<id>" with a 43-letter extension, the asset layer finds
// no file and answers a bare 404, and that ticket's link is dead.
const EXTENSION = /\.[a-z0-9]{1,12}$/i;

export function isStaticAssetPath(pathname: string): boolean {
  return EXTENSION.test(pathname);
}
