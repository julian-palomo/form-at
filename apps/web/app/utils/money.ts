/** Pence as pounds: whole pounds without decimals (800 → "£8"), otherwise two places (1050 → "£10.50"). */
export function formatPence(pence: number): string {
  const pounds = pence / 100;
  return Number.isInteger(pounds) ? `£${pounds}` : `£${pounds.toFixed(2)}`;
}
