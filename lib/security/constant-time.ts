/* Constant-time string comparison for guarded endpoints (e.g. bearer secrets).

   Same pattern as proxy.ts (SHA-256 digests compared with an XOR accumulator),
   extracted into a dependency-free, unit-testable helper. Timing does not
   reveal where/whether the two inputs differ. Never logs the inputs. */

export async function constantTimeEqual(
  supplied: string,
  expected: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [suppliedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const suppliedBytes = new Uint8Array(suppliedDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  let diff = 0;
  for (
    let i = 0;
    i < suppliedBytes.length && i < expectedBytes.length;
    i += 1
  ) {
    diff |= suppliedBytes[i] ^ expectedBytes[i];
  }
  return diff === 0 && suppliedBytes.length === expectedBytes.length;
}