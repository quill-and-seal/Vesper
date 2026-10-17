# Changelog

## 0.2.0

- Moteur de sons procéduraux : sons calculés en direct à partir de couches (bruit, oscillateur, événements aléatoires), de filtres et de modulations, avec des paramètres liés à l'intensité.
- Modèles livrés : feu de camp, torche, rivière, gouttes, grillons (nouveaux), vent, pluie, nappe de tension et battement de cœur (refaits avec le moteur).
- Sons procéduraux posés sur la carte : « Son procédural » dans la fenêtre d'un son d'ambiance, avec distance, murs et réverbération ; intensité automatique (vent, pluie, tension) ou fixée.
- Atelier sonore : créer, dupliquer, écouter en direct et partager ses propres sons.
- Modèle de paysage « Campement » ; la forêt et le donjon utilisent les grillons et les gouttes générés.

## 0.1.0

Première version.

- Sons d'ambiance de Foundry rendus par Vesper depuis le token : direction HRTF ou stéréo, atténuation physique, absorption de l'air.
- Occlusion par les murs : pertes et filtrage par type de mur, portes ouvertes ou fermées, fuite par les ouvertures (cinq rayons).
- Comportement de Région « Acoustique » : onze lieux acoustiques générés, fondu entre lieux, isolation intérieur / extérieur.
- Paysage sonore par scène : boucles, sons dispersés synchronisés entre joueurs, couches générées (vent, pluie, tension, cœur), conditions jour/nuit, combat, météo d'Ember, intérieur/extérieur, tension.
- Champs Vesper dans la fenêtre d'un son d'ambiance, API `playAt` pour tous les joueurs.
