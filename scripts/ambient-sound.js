/**
 * Les sons d'ambiance gérés par Vesper restent posés et réglés avec les outils de Foundry,
 * mais Foundry ne les joue plus : Vesper les joue à sa place (sinon on les entendrait deux fois).
 * Un son dont « Géré par Vesper » est décoché est joué par Foundry comme d'habitude.
 */

import { isManaged } from "./spatial-engine.js";
import { warn } from "./constants.js";

export function registerAmbientSoundClass() {
  const Base = CONFIG.AmbientSound?.objectClass;
  if (!Base || typeof Base.prototype.sync !== "function") {
    warn("AmbientSound#sync introuvable : Foundry jouera aussi les sons (risque de double lecture)");
    return false;
  }
  class VesperAmbientSound extends Base {
    async sync(isAudible, volume, options = {}) {
      if (isManaged(this.document)) return super.sync(false, 0, { ...options, fade: 0 });
      return super.sync(isAudible, volume, options);
    }
  }
  CONFIG.AmbientSound.objectClass = VesperAmbientSound;
  return true;
}
