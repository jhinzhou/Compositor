type Point = [number, number]

/** Native CloneStamp.swift: round the source offset once at stroke start. */
export function cloneStrokeOffset(source: Point | undefined, point: Point, aligned: boolean, previous?: Point): Point | undefined {
  if (!source) return undefined
  if (aligned && previous) return [...previous]
  const round = (value: number) => value < 0 ? -Math.round(-value) : Math.round(value)
  return [round(source[0] - point[0]), round(source[1] - point[1])]
}

/** An unaligned stroke moves its source while painting and resets it on release. */
export function cloneSamplePoint(source: Point | undefined, hover: Point | undefined, aligned: boolean, previous?: Point, activeStroke?: Point): Point | undefined {
  if (!source || !hover) return undefined
  const offset = activeStroke ?? (aligned ? previous : undefined)
  return offset ? [hover[0] + offset[0], hover[1] + offset[1]] : [...source]
}
