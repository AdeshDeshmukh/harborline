export function isSolanaAddress(value: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(0);
  for (const character of value) number = number * BigInt(58) + BigInt(alphabet.indexOf(character));
  let bytes = value.match(/^1*/)?.[0].length ?? 0;
  while (number > BigInt(0)) { bytes++; number >>= BigInt(8); }
  return bytes === 32;
}
