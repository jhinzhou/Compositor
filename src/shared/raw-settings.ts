/** Pure RAW import settings shared by renderer and isolated codec worker orchestration. */
export interface RawImportSettings { whiteBalance: 'camera' | 'auto'; exposureEV: number; autoBright: boolean; halfSize: boolean; highlightMode: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9; noiseReductionThreshold:number }
export const DEFAULT_RAW_SETTINGS: RawImportSettings = { whiteBalance: 'camera', exposureEV: 0, autoBright: true, halfSize: false, highlightMode: 0, noiseReductionThreshold:0 }
export function normalizeRawSettings(input: Partial<RawImportSettings> = {}): RawImportSettings {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['whiteBalance','exposureEV','autoBright','halfSize','highlightMode','noiseReductionThreshold'].includes(key)))throw new Error('Invalid RAW import settings')
  const s = { ...DEFAULT_RAW_SETTINGS, ...input }
  if (!['camera', 'auto'].includes(s.whiteBalance) || !Number.isFinite(s.exposureEV) || s.exposureEV < -5 || s.exposureEV > 5 || !Number.isInteger(s.highlightMode)||s.highlightMode<0||s.highlightMode>9||!Number.isFinite(s.noiseReductionThreshold)||s.noiseReductionThreshold<0||s.noiseReductionThreshold>1000 || typeof s.halfSize !== 'boolean' || typeof s.autoBright !== 'boolean') throw new Error('Invalid RAW import settings')
  return s
}
