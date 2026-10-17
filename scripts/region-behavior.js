/**
 * Comportement de Région « Acoustique (Vesper) » : la Région donne son lieu acoustique
 * (réverbération) à qui s'y tient, et peut isoler l'intérieur de l'extérieur.
 *
 * Déclaré dans module.json (documentTypes.RegionBehavior.acoustics) : nom complet « vesper-audio.acoustics ».
 */

import { warn } from "./constants.js";
import { REVERB_PRESETS } from "./audio/reverb-presets.js";
import { ACOUSTICS_BEHAVIOR } from "./world.js";

function placeChoices() {
  const out = {};
  for (const id of Object.keys(REVERB_PRESETS)) out[id] = `VESPER.Place.${id}`;
  return out;
}

export function registerRegionBehavior() {
  const Base = foundry.data?.regionBehaviors?.RegionBehaviorType;
  const fields = foundry.data?.fields;
  if (!Base || !fields || !CONFIG.RegionBehavior) return false;
  try {
    class AcousticsBehavior extends Base {
      static LOCALIZATION_PREFIXES = ["VESPER.RegionBehavior"];

      static defineSchema() {
        return {
          place: new fields.StringField({ required: true, blank: false, initial: "room", choices: placeChoices }),
          // Vide : niveau conseillé pour ce lieu
          wet: new fields.NumberField({ required: false, nullable: true, initial: null, min: 0, max: 1, step: 0.01 }),
          // 0 : ouvert ; 1 : bien fermé (les sons du dehors sont très étouffés, ceux du dedans ne sortent presque pas)
          isolation: new fields.NumberField({ required: true, initial: 0, min: 0, max: 1, step: 0.05 })
        };
      }

      /** Rien à écouter : Vesper lit la Région à chaque mise à jour. */
      static events = {};
    }
    CONFIG.RegionBehavior.dataModels[ACOUSTICS_BEHAVIOR] = AcousticsBehavior;
    if (CONFIG.RegionBehavior.typeIcons) CONFIG.RegionBehavior.typeIcons[ACOUSTICS_BEHAVIOR] = "fa-solid fa-ear-listen";
    return true;
  } catch (err) {
    warn("Comportement de Région « Acoustique » indisponible", err);
    return false;
  }
}
