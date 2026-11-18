# Suivi des devis clients — Fantasy Kids Events

Cette fonctionnalité concerne les devis envoyés depuis les fiches **Animation** de l'agenda (`devis.html`).
Elle ne modifie pas la numérotation des devis professionnels PDF dans `factures.html`.

## Activation (dans cet ordre)

1. Dans **Supabase → SQL Editor**, exécuter le contenu de `supabase_suivi_devis_clients.sql`.
   Le script ajoute les champs de réponse, les dates de relance, un historique et deux fonctions protégées par le lien du devis. Il préserve les dossiers déjà existants.
2. Dans **Supabase → Edge Functions → notifier**, déployer la nouvelle version du fichier `notifier-index.ts` en remplacement du code actuel. Conserver les secrets déjà configurés.
3. Actualiser l'application sur le téléphone (le cache PWA est passé en `fk-agenda-v131`).

## Parcours à vérifier

- Envoyer un **devis test** depuis la fiche Animation en attente. Le message doit proposer un lien vers une page contenant « Accepter », « Demander une modification » et « Refuser ».
- Depuis ce lien test, demander une modification : le texte doit être obligatoire et la fiche ne doit **pas** passer à Confirmé.
- Dans **Gestion → Devis clients**, vérifier l'état « Modification demandée », le message et la date. La cloche des responsables reçoit une alerte ; le push est envoyé si activé.
- Préparer une nouvelle proposition puis l'envoyer depuis la fiche : cela réouvre la réponse du client.
- Sur un autre devis test, refuser : vérifier le statut, le motif facultatif et l'historique. La prestation n'est pas annulée automatiquement.
- Sur un autre devis test, accepter : l'ancien circuit de confirmation et d'acompte continue à fonctionner.
- Sur un devis sans réponse, le bouton **Relancer le client** envoie un nouveau mail et enregistre la date ainsi que le nombre de relances.
- Le planificateur habituel `RAPPELS` affiche un rappel aux responsables à 3 jours puis 5 jours sans réponse. Il ne relance pas le client automatiquement.

**Attention :** publier les pages HTML sans avoir exécuté le SQL laisse les nouvelles réponses indisponibles. Déployer le SQL et la fonction `notifier` pour activer le circuit complet.
