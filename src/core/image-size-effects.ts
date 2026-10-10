import {EditorError} from '../shared/contracts'
import {validateLayerEffects,type LayerEffects} from '../shared/layer-effects'

/** Native LayerEffects.scaled: only pixel distances change, including disabled
 * styles. Nonuniform image resizing uses the geometric mean of its two scales. */
export function scaleImageSizeEffects(input:unknown,sx:number,sy:number):LayerEffects {
 if(!Number.isFinite(sx)||!Number.isFinite(sy)||sx<=0||sy<=0)throw new EditorError('INVALID_ARGUMENT','Image effect scaling needs positive finite factors.')
 const effects=structuredClone(validateLayerEffects(input)),factor=Math.sqrt(sx*sy)
 if(effects.stroke)effects.stroke.size=Math.min(500,effects.stroke.size*factor)
 for(const key of ['shadow','innerShadow'] as const){const shadow=effects[key];if(shadow){shadow.distance=Math.min(5000,shadow.distance*factor);shadow.blur=Math.min(500,shadow.blur*factor)}}
 for(const key of ['outerGlow','innerGlow'] as const){const glow=effects[key];if(glow)glow.size=Math.min(500,glow.size*factor)}
 return validateLayerEffects(effects)
}
