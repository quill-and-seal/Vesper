# Vesper

Son immersif pour **Foundry VTT v14**. Chaque joueur entend la scène **depuis son token** : les sons viennent de la bonne direction, faiblissent avec la distance comme dans la réalité, deviennent sourds derrière un mur, résonnent dans une caverne, et l'ambiance évolue toute seule avec le jour, la météo, le combat et la tension.

Aucun nouvel outil de placement : Vesper reprend les **sons d'ambiance que tu poses déjà** avec les outils de Foundry. Aucune dépendance, aucun fichier à télécharger (les réverbérations et les couches « générées » sont calculées à la volée).

Un module de l'atelier [Quill & Seal](https://github.com/quill-and-seal).

## Installation

Dans Foundry, **Modules complémentaires → Installer un module**, puis colle ce lien de manifeste :

```
https://github.com/quill-and-seal/Vesper/releases/latest/download/module.json
```

Conseillé : un **casque**. La spatialisation HRTF donne la sensation qu'un son est devant, derrière ou au-dessus de toi.

## 1. Les sons posés sur la scène

Pose tes sons d'ambiance comme d'habitude (calque **Sons** de Foundry). Vesper les joue à la place de Foundry :

- **Depuis le token** : chaque joueur entend depuis son personnage. S'il en contrôle plusieurs, chaque son est entendu depuis le plus proche. Le MJ sans token écoute depuis le centre de l'écran (il promène la carte pour écouter).
- **Direction** : un feu à droite du token est dans l'oreille droite. Tout près de la source, le son remonte au-dessus de la tête au lieu de sauter d'une oreille à l'autre.
- **Distance réaliste** : loi physique en 1/d (-6 dB à chaque doublement de distance), avec un fondu doux au bord du rayon. Les aigus se perdent avec la distance (absorption de l'air).
- **Murs** : un mur plein retire 18 dB et la plupart des aigus, une porte fermée 9 dB, un mur « limité » (tenture, palissade) 4 dB. Une porte ouverte laisse tout passer. Cinq rayons sont lancés autour de la source, donc un son **filtre par une ouverture** au lieu d'être tout ou rien. Ouvrir une porte s'entend immédiatement.

Les réglages de Foundry restent valables : rayon, volume, répétition, caché, plage d'obscurité, « Contraint par les murs » (décoché : pas d'occlusion), « Atténuation » (décochée : plein volume dans tout le rayon).

Dans la fenêtre d'un son, une section **Vesper** ajoute :

| Réglage | Effet |
|---|---|
| Géré par Vesper | Décoché, Foundry joue ce son comme avant. |
| Son directionnel | Décoché, le son est une nappe sans direction (une pluie sur toute la zone). |
| Taille de la source | Une rivière, une foule, une cascade sont « grandes » : elles faiblissent moins vite près de la source et sonnent plus large. |

## 2. L'acoustique des lieux (Régions)

Ajoute à une Région le comportement **Acoustique (Vesper)** :

- **Lieu acoustique** : petite pièce, taverne, grande salle, cathédrale, donjon de pierre, caverne, tunnel (écho en rafale), forêt, plein air, sous l'eau, ou aucune réverbération.
- **Niveau de réverbération** : vide pour le niveau conseillé du lieu.
- **Isolation** (0 à 1) : une Région isolée sépare l'intérieur de l'extérieur. Un son qui vient du dehors est étouffé, même sans murs dessinés, et les couches d'ambiance « extérieures » deviennent sourdes : on passe la porte de la taverne, l'orage devient un grondement lointain.

La réverbération est celle du lieu où se tient le token, avec un fondu quand on change de lieu. Quand deux Régions se recouvrent, la plus petite gagne (une crypte dans une cathédrale). Hors des Régions, c'est le lieu de la scène (réglable dans le paysage sonore) qui s'applique.

## 3. Le paysage sonore (ambiances dynamiques)

Bouton **Paysage sonore (Vesper)** dans le calque **Sons** (icône d'oreille). Une scène a des **couches** qui entrent et sortent en fondu selon leurs conditions :

- **Boucle** : un fichier en boucle (foule, rivière lointaine, vent).
- **Sons dispersés** : des sons ponctuels à intervalles irréguliers, à gauche, à droite, près ou loin, avec une légère variation de hauteur (oiseaux, craquements, tonnerre). Le calendrier dépend de l'heure du serveur : **tous les joueurs entendent le même coup de tonnerre au même moment**, du même côté.
- **Couche générée** (aucun fichier) : vent, pluie, nappe de tension, battement de cœur. Le vent suit la force du vent d'Ember, la pluie l'intensité de sa pluie ; la nappe devient dissonante et le cœur accélère avec la tension.

Conditions d'une couche : **jour / nuit** (obscurité de la scène), **combat**, **météo** (lue dans [Ember](https://github.com/quill-and-seal/Ember) : temps clair, pluie, orage, neige, brouillard), **intérieur / extérieur** (Régions isolées), et une plage de **tension**.

La **tension** (Calme, Inquiétant, Danger, Terreur) se règle d'un clic en haut de la fenêtre pendant la partie. Quatre modèles (forêt, tempête, taverne, donjon) posent des couches prêtes : les couches générées jouent tout de suite, il reste à choisir les fichiers des autres.

## Réglages

**Monde (MJ)** : Vesper joue les sons d'ambiance, réalisme de l'atténuation, absorption de l'air, perte des murs pleins / portes / murs limités, lieu acoustique par défaut, écoute du MJ sans token.

**Chaque joueur** : spatialisation (HRTF au casque, stéréo simple, désactivée), précision des murs, volumes de Vesper, des sons posés, du paysage sonore et de la réverbération, paysage sonore activé. Le curseur **Ambiance** de Foundry s'applique aussi à Vesper.

## API (macros, autres modules)

```js
const vesper = game.modules.get("vesper-audio").api;

// Un son depuis un point de la scène, pour tout le monde, avec distance, murs et réverbération
vesper.playAt("sounds/sort-de-feu.ogg", token.center, { radius: 20, volume: 0.9 });

// Tension de la scène (0 à 3)
await vesper.setTension(2);

// Paysage sonore
vesper.getSoundscape();
await vesper.setSoundscape({ volume: -3 });

// Diagnostic : auditeurs, lieu, voix actives (volume en dB, coupure en Hz), couches
vesper.describe();
```

## Développement

- `npm test` : tests de la géométrie, de l'acoustique, des réverbérations et du calendrier des sons dispersés.
- `node tests/browser/run.mjs` : fait tourner le module entier dans Chromium (sans Foundry, avec un faux Foundry minimal) et **mesure le son produit** : baisse avec la distance, gauche/droite, murs et portes, réverbération, isolation, conditions des couches. Variables `PLAYWRIGHT` (chemin de playwright-core) et `CHROME` si besoin.

## Limites connues

- Les sons joués par Foundry lui-même avec `playAtPosition` (certains modules, macros) ne passent pas par Vesper : utilise `vesper.playAt`.
- La diffraction est approchée par cinq rayons autour de la source : une porte ouverte loin de la ligne directe ne laisse pas encore passer le son par le chemin réel.
- Les effets « de base » et « étouffé » de Foundry sur un son sont ignorés pour les sons gérés (Vesper fait son propre filtrage).
