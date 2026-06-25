/**
 * Truncates a Stellar G-address for display.
 * Returns first 6 chars + "..." + last 4 chars.
 * @param address - Full Stellar G-address (56 chars)
 */
export function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
