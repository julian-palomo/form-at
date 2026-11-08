import type { SalesTier } from "~/data/sales";
import { fmtPounds } from "~/utils/fmt";

// The sale at a glance: per tier, tickets sold against the cap and what's
// held by open checkouts; then tickets sold, tickets left online and gross.
// Every number that couldn't be read shows `—`, never `0`.

interface SalesTotalsProps {
  tiers: SalesTier[] | null;
  /** Paid orders' totals; null when the orders couldn't be read. */
  grossPence: number | null;
}

export function SalesTotals({ tiers, grossPence }: SalesTotalsProps) {
  const sold = tiers ? tiers.reduce((sum, t) => sum + t.paid, 0) : null;
  const left = tiers ? tiers.reduce((sum, t) => sum + t.left, 0) : null;

  return (
    <section aria-label="totals" className="space-y-4">
      <dl className="grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["sold", sold == null ? null : String(sold)],
            ["left online", left == null ? null : String(left)],
            ["gross", grossPence == null ? null : fmtPounds(grossPence)],
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
