import type { SalesTier, SalesTotalsData } from "~/data/sales";
import { fmtPounds } from "~/utils/fmt";

// The sale at a glance: tickets sold, tickets left online and gross; then per
// tier, tickets sold against the cap, what open checkouts hold, and what's
// left. Every count is in tickets, not orders. Anything that couldn't be read
// shows `—`, never `0`.

interface SalesTotalsProps {
  tiers: SalesTier[] | null;
  totals: SalesTotalsData;
}

export function SalesTotals({ tiers, totals }: SalesTotalsProps) {
  return (
    <section aria-label="totals" className="space-y-4">
      <dl className="grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["sold", totals.sold == null ? null : String(totals.sold)],
            ["left online", totals.left == null ? null : String(totals.left)],
            ["gross", totals.grossPence == null ? null : fmtPounds(totals.grossPence)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="border border-grey/30 py-3">
            <dt className="text-xs text-grey tracking-widest">{label}</dt>
            <dd className="font-display text-2xl text-white">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>

      {tiers == null ? (
        <p className="t-body text-grey">Couldn't read the tiers.</p>
      ) : (
        <ul className="divide-y divide-grey/10 border-y border-grey/10">
          {tiers.map((tier) => (
            <li key={tier.id} className="flex items-baseline justify-between gap-4 py-2">
              <span className="text-base text-white">{tier.name}</span>
              <span className="text-sm text-grey">
                <span className="text-white">{tier.paid}</span> / {tier.cap}
                {tier.held > 0 && <span> · {tier.held} held</span>}
                <span> · {tier.left} left</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
