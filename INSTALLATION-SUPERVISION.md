# Fantasy App — Mise en service des 4 améliorations Gestion

Cette mise à jour ajoute **Gardien**, **Incidents**, **E-mails**, **Bilan mensuel** sans modifier les bilans existants.

## 1. Base de données (opération à faire dans Supabase)

Ouvrir **Supabase > SQL Editor**, coller le contenu de **fantasy-supervision.sql**, puis exécuter le script. Le script est idempotent.

Trois tables sont ajoutées :
- `fantasy_suivi_incidents` : statuts et suites à donner des incidents issus des bilans existants (les notes originales sont conservées dans `bilans`);
- `fantasy_emails_journal` : résultat technique des **futurs** envois Gmail et Resend, uniquement consultable par les responsables ;
- `fantasy_diagnostics` : erreurs JavaScript signalées depuis les sessions connectées, consultables par les responsables.

Les accès sont protégés par les règles Supabase (RLS). Les rapports de bilan ne deviennent pas publics.

## 2. Activer le suivi des e-mails

Dans **Supabase > Edge Functions > notifier**, déployer le contenu intégral mis à jour de **notifier-index.ts** (ne pas remplacer la fonction par un extrait).

- Les e-mails clients continuent de partir par Gmail.
- Les notifications administratives et équipe restent sur Resend.
- Le journal enregistre `accepte` quand le fournisseur a accepté la demande et `echec` quand il a refusé ou que l'envoi a échoué.
- `accepte` **ne signifie pas** livré, lu ni boîte principale (un e-mail peut finir dans les indésirables).
- Les e-mails envoyés avant le déploiement ne sont pas ajoutés rétroactivement.

Aucun nouveau secret d'environnement n'est nécessaire.

## 3. Contrôles dans Fantasy App

1. Actualiser l'application (le service worker utilise la nouvelle version de cache).
2. Dans **Gestion > Gardien**, vérifier les alertes sur les fiches et les erreurs signalées.
3. Dans **Gestion > Incidents**, ouvrir un bilan avec incident ou satisfaction « moyen/mécontent », attribuer une personne, définir une action, puis enregistrer « En cours » et « Résolu ».
4. Dans **Gestion > E-mails**, faire un envoi de test avec une adresse contrôlée, vérifier que le fournisseur l'accepte, et ne pas en déduire qu'il a été livré.
5. Dans **Gestion > Bilan mensuel**, choisir un mois puis copier le résumé.

## Limites connues

- Le Gardien repère des anomalies dans les fiches chargées, certains échecs techniques et les erreurs JavaScript capturées **après** son chargement. Il n'est ni une surveillance de serveur permanente ni une garantie de détection de toutes les pannes.
- Le tableau des e-mails affiche les 500 lignes les plus récentes accessibles en base.
- Le récapitulatif mensuel est une synthèse des données saisies dans l'application, pas un document comptable audité. Certaines prestations ou frais peuvent être manquants.
- Sans exécution de `fantasy-supervision.sql`, les panneaux concernés affichent des erreurs de configuration. Les envois des clients restent actifs, mais leur historique central ne peut pas être enregistré.
