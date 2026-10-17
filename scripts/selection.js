/**
 * Source sélectionnée, partagée entre la carte (calque Vesper) et le panneau.
 * Cliquer un logo la sélectionne ; le panneau affiche alors ses réglages, et inversement.
 */

const listeners = new Set();
let current = null;

export const selection = {
  get id() {
    return current;
  },

  /** Sélectionne une source (id d'un son d'ambiance), ou rien (null). */
  set(id) {
    const next = id ?? null;
    if (next === current) return;
    current = next;
    for (const fn of listeners) {
      try {
        fn(current);
      } catch (err) {
        console.warn("Vesper | sélection", err);
      }
    }
  },

  /** Prévenu à chaque changement ; renvoie la fonction qui se désabonne. */
  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
};
