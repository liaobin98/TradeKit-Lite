// Opaque deterministic identity, so deletion markers do not retain names,
// addresses or bank details. FNV-1a 128 is an identity hash, not encryption.
export function catalogIdentity(value: string) {
  if (/^catalog-[0-9a-f]{32}$/.test(value)) return value;
  let hash = 0x6c62272e07bb014262b821756295c58dn;
  const mask = (1n << 128n) - 1n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x1000000000000000000013bn) & mask;
  }
  return `catalog-${hash.toString(16).padStart(32, '0')}`;
}
