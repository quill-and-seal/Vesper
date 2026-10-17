# Changelog

## 0.3.0

- Outil « Poser » dans la case Vesper, avec une palette : sons procéduraux, sons de l'atelier ou fichier audio, rayon et volume par défaut.
- Carte du champ sonore au survol d'une source : dégradé chaud là où le son arrive direct, froid là où il arrive étouffé par un mur, anneaux à -6, -12, -24 et -36 dB. Calculée avec le moteur du jeu (distance, murs, portes, isolation des Régions), elle suit la source en direct pendant qu'on la déplace.
- Bouton « Tout afficher » : la carte de toutes les sources de la scène à la fois.
- Repères des sources sur le calque Vesper : clic ou clic droit pour ouvrir leurs réglages, glisser pour les déplacer (Maj : au centre de la case).
- Correction : deux murs qui se rejoignent en coin ne laissent plus passer le son par une fente invisible.

## 0.2.3

- Feu de camp plus doux, sur le modèle d'une cheminée : crépitements plus rares, plus petits et plus chauds (médiums plutôt qu'aigus), moins de rafales ; bûches qui éclatent plus rares et plus sourdes. Crête divisée par deux environ.
- Torche : grésillements adoucis de la même façon.

## 0.2.2

- Couches « seulement de près » : une couche d'un son procédural peut ne s'entendre qu'à moins d'une certaine distance de la source, et monte quand on s'approche.
- Feu de camp et torche : le grondement ne s'entend plus que collé au feu (moins d'une case pour le feu, un peu plus d'une demi-case pour la torche) ; de plus loin, seuls les crépitements restent.
- Atelier sonore : réglage « Seulement de près » par couche et curseur « Distance d'écoute » pour l'essayer.

## 0.2.1

- Vesper a sa propre case dans la barre de gauche (icône d'oreille), avec le paysage sonore et l'atelier sonore ; le groupe Sons de Foundry n'est plus modifié.
- Feu de camp et torche : plus de souffle qui faisait penser à du vent. Le grondement est grave et sourd, les crépitements ressortent mieux.
- Les modèles de paysage Forêt et Campement n'ajoutent plus de couche de vent (la Tempête la garde).

## 0.2.0

- Moteur de sons procéduraux : sons calculés en direct à partir de couches (bruit, oscillateur, événements aléatoires), de filtres et de modulations, avec des paramètres liés à l'intensité.
- Modèles livrés : feu de camp, torche, rivière, gouttes, grillons (nouveaux), vent, pluie, nappe de tension et battement de cœur (refaits avec le moteur).
- Sons procéduraux posés sur la carte : « Son procédural » dans la fenêtre d'un son d'ambiance, avec distance, murs et réverbération ; intensité automatique (vent, pluie, tension) ou fixée.
- Atelier sonore : créer, dupliquer, écouter en direct et partager ses propres sons.
- Modèle de paysage « Campement » ; la forêt et le donjon utilisent les grillons et les gouttes générés.
- D'autres changement à venir.

## 0.1.0

Première version.

- Sons d'ambiance de Foundry rendus par Vesper depuis le token : direction HRTF ou stéréo, atténuation physique, absorption de l'air.
- Occlusion par les murs : pertes et filtrage par type de mur, portes ouvertes ou fermées, fuite par les ouvertures (cinq rayons).
- Comportement de Région « Acoustique » : onze lieux acoustiques générés, fondu entre lieux, isolation intérieur / extérieur.
- Paysage sonore par scène : boucles, sons dispersés synchronisés entre joueurs, couches générées (vent, pluie, tension, cœur), conditions jour/nuit, combat, météo d'Ember, intérieur/extérieur, tension.
- Champs Vesper dans la fenêtre d'un son d'ambiance, API `playAt` pour tous les joueurs.
