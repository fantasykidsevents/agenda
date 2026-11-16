# Fantasy Kids Events — demandes de costumes et perruques

Version préparée le 16 novembre 2026. Les données existantes sont conservées.

## 1. Activer les demandes dans Supabase

Dans le projet Supabase associé à l'agenda, ouvrir **SQL Editor** et exécuter :

1. `costumes-attributions.sql` **si cette migration n'a pas encore été installée**.
2. `demandes-tenues.sql` (nouvelle table, droits d'accès, fonctions et stockage privé des photos).

Ne pas exécuter de migration à moitié : attendre la confirmation de succès de chaque fichier.

Le nouveau formulaire fonctionne dans l'application une fois ces fonctions installées :

Si un membre voit « `column reference "responsable" is ambiguous` » en enregistrant
son costume ou sa perruque, **réexécuter la version corrigée de `demandes-tenues.sql`**
dans SQL Editor. La correction ne supprime ni les costumes, ni les attributions,
ni les demandes déjà enregistrées.

- `enregistrer_demande_tenue` : choix personnel, demande Fantasy, absence de perruque et signalement.
- `traiter_demande_tenue` : suivi « À traiter / En cours / Résolue » par un responsable.

La table `costume_demandes` est réservée au membre concerné et aux responsables (lecture uniquement) ; les modifications passent par les fonctions sécurisées. Les photos sont dans le bucket privé `signalements-tenues`.

## 2. Notifier les téléphones (complément facultatif)

Les demandes et les changements de suivi sont déjà consignés par la base dans la **cloche de l'agenda**, sans réglage supplémentaire.

Pour ajouter les **notifications push des téléphones**, mettre à jour la fonction Supabase **Edge Functions → notifier** avec le fichier `notifier-index.ts` puis créer un **Database Webhook** sur la table `public.costume_demandes`, événements **INSERT** et **UPDATE**, dirigé vers la même fonction `notifier` (réutiliser les mêmes options et en-têtes de sécurité que les webhooks existants de l'agenda). La nouvelle branche ne duplique pas les messages de la cloche.

Un webhook déjà configuré pour `public.costumes` ne surveille pas automatiquement `public.costume_demandes`.

## 3. Essais avec deux comptes différents

1. Dans une prestation où Cyrielle interprète Elsa, ouvrir **Mes tenues** depuis son compte.
2. Vérifier que « Je souhaite utiliser un costume Fantasy » est proposé, même sans costume personnel enregistré.
3. Choisir **costume Fantasy**, motif **ne sera pas prêt à temps**, écrire une précision et ajouter une photo ; enregistrer.
4. Choisir séparément **perruque personnelle**, **perruque Fantasy** ou **pas de perruque** ; enregistrer.
5. Avec le compte Jordan, ouvrir la cloche puis **Tenues de la prestation** ; vérifier le souhait et la photo. Passer le statut à **En cours** puis **Résolue**.
6. Vérifier que Cyrielle voit le nouveau statut et peut modifier ses choix.
7. Attribuer une pièce Fantasy précise et vérifier qu'aucun autre membre ne peut la réserver sur une prestation qui se chevauche.

Si l'écran affiche « Nouveau formulaire pas encore activé », l'étape 1 n'a pas été terminée. L'ancien système d'attribution reste utilisable pendant ce temps.
