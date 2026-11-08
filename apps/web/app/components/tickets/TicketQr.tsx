import { encode } from "uqr";

// The QR of a ticket token, as inline SVG from `uqr`'s module matrix. Drawn
// in the browser from the token alone, so the offline view needs no network
// and no stored image. Loaded with `lazy()` by TicketCard: `uqr` is only
// needed on the ticket pages. The default export is what lazy() needs.
//
// Error correction M (15%) survives a scratched or dimmed phone screen. The
// 4-module border is the quiet zone the spec asks for; it is drawn white by
// the wrapper's background, so the QR scans on a dark page.

export const QR_QUIET_ZONE = 4;

export default function TicketQr({ value }: { value: string }) {
  const qr = encode(value, { ecc: "M", border: QR_QUIET_ZONE });
  const path = qr.data
    .map((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : "")).join(""))
    .join("");
  return (
    <svg
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      role="img"
      aria-label="ticket QR code"
      shapeRendering="crispEdges"
      className="block w-full h-full"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}
