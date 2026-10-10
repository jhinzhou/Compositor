export interface PendingOpacityDigit { digit: number; time: number }
/** Native typeOpacityDigit: a single digit names a decade; a second within 600ms names percent. */
export function opacityDigit(digit: number, time: number, pending?: PendingOpacityDigit): { value: number; pending?: PendingOpacityDigit } {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9 || !Number.isFinite(time)) throw Error('Invalid opacity digit.')
  if (pending && time >= pending.time && time - pending.time < 600) return { value: Math.max(1, pending.digit * 10 + digit) / 100 }
  return { value: digit === 0 ? 1 : digit / 10, pending: { digit, time } }
}
