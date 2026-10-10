/** Native v1.4.8 limits distinguish one working surface from retained document rasters. */
export const LIMITS = { maxSide: 30_000, maxSurfacePixels: 200_000_000, maxPixels: 800_000_000, maxDocuments: 8, maxLayers: 10_000, maxAssetBytes: 512 * 1024 * 1024, maxManifestBytes: 4 * 1024 * 1024 }
export function documentPixelBudget(physicalMemoryBytes:number):number{return Math.min(800_000_000,Math.max(LIMITS.maxSurfacePixels,Math.floor(physicalMemoryBytes/16)))}
