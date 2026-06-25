/**
 * Truncates a Stellar G-address for display.
 * Returns first 6 characters + "..." + last 4 characters.
 * @param address Full Stellar G-address (56 chars)
 * @returns Truncated address string
 */
export function truncateAddress(address: string): string {
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
