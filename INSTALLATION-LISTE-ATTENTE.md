# Fantasy · Places et liste d'attente (Wix ↔ app)

Ce module complète le formulaire **Contact** existant sans en changer les clés ni le fonctionnement.
Une personne sur `liste_attente` ne compte **jamais** comme une réservation.

## Ordre de mise en service (Mahin / Hector)

1. **Supabase SQL Editor** : exécuter `fantasy-places-liste-attente.sql` (script de Mahin, avec `places_evenements_calcul`, `places_evenements_site`, `places_suffisantes` et la table `liste_attente`). Il n'est **pas** dans ce dépôt.
2. Exécuter **ensuite** [fantasy-liste-attente-confirmation.sql](fantasy-liste-attente-confirmation.sql). Il ajoute/garantit `id` UUID, `adultes`, `enfants`, l'index du hash et la fonction atomique `confirmer_liste_attente`. Vérifier que `liste_attente.id` est bien un UUID.
3. **Wix** : publier le formulaire « Liste d'attente », puis communiquer son **form ID**. Configurer le secret Supabase Edge Functions `WIX_FORM_ATTENTE_ID` avec cet identifiant. Conserver `WIX_FORM_CONTACT_ID` tel quel.
4. **Supabase Edge Functions → notifier** : déployer le contenu de `notifier-index.ts`, avec les secrets Wix/Gmail et `APP_URL` (racine de l'agenda, sans `/index.html`). Le cron existant `RAPPELS` importe les nouvelles entrées Wix et expire les propositions après 48 h.
5. **Database Webhooks** : vérifier que `notifier` reçoit bien les événements `INSERT`, `UPDATE` et `DELETE` sur `public.reservations`, notamment `record` et `old_record` (avec `places`, `annulations`, `evenement_id` et `id`). Le webhook d'`INSERT` sur une réservation confirmée envoie déjà le mail habituel via `mailsReservation`; ne pas configurer un second envoi identique.
6. **Agenda** : publier `index.html`, `attente.html` et `sw.js` ensemble. Aucun onglet ni style général de l'application n'est modifié. La liste est visible sous « Réservations » → « Liste » pour les responsables.

## Parcours prévu

- Le nouveau formulaire Wix crée une ligne `liste_attente` avec `source = site` et son `wix_submission_id` unique ; le client reçoit l'e-mail Wix habituel de liste d'attente.
- Les responsables voient la demande dans la section 💜 et dans leur cloche (avec push selon préférences), sans nouvel e-mail interne.
- « Proposer les places » vérifie qu'il reste assez de places et expédie un e-mail Gmail au client avec un lien à jeton aléatoire. Seul son SHA-256 est stocké. La réponse expire après 48 h.
- `attente.html` vérifie le lien et demande au client de confirmer explicitement.
- L'Edge Function appelle `confirmer_liste_attente` : verrou de transaction par événement, relecture de `places_evenements_calcul`, création de **une seule** réservation normale (`source = liste_attente`, `confirmee_le` renseigné), mise à jour de la ligne d'attente.
- Le webhook de réservations prend en charge le mail de confirmation et d'acompte. Les responsables reçoivent une alerte.
- Les mises à jour ou suppressions de réservations qui libèrent des places déclenchent une alerte dans la cloche et un push aux responsables **s'il reste des personnes en liste d'attente**. Aucune offre ne part automatiquement aux clients.

## Vérifications avant publication

- [ ] Formulaire Contact : réservation ordinaire créée, aucune régression.
- [ ] Formulaire Liste d'attente : `adultes_attente = 2`, `enfants_attente = 1`, `bebes_attente = 1` crée **3 places** en liste, **0 place réservée**.
- [ ] Réimport de la même soumission Wix : aucun doublon (`23505`).
- [ ] Proposition : un seul e-mail reçu ; la demande passe en `proposee`, lien valable 48 h.
- [ ] Confirmation : `reservations` reçoit une ligne confirmée, demande passe en `acceptee`, `reservation_id` est renseigné, mail d'acompte reçu **une seule fois**.
- [ ] Deux clics sur un lien, ou deux liens pour les dernières places : aucune réservation en double / dépassement.
- [ ] Places devenues insuffisantes : aucune réservation créée, responsable alerté.
- [ ] Retrait et expiration : ancien lien refusé.
- [ ] Annulation partielle, diminution et suppression d'une réservation : bonne alerte aux responsables, aucune notification au client en attente.
- [ ] La Nuit Magique, les événements passés, annulés et les lignes montage / répétition / générale restent hors du parcours.

> **Attention concurrence :** le verrou SQL protège les confirmations **entre plusieurs clients de la liste d'attente**. L'import Wix Contact et les créations manuelles n'utilisent pas ce même verrou : un encodage ordinaire simultané peut encore dépasser la capacité. Le contrôle final est néanmoins réalisé immédiatement avant la création de la réservation d'attente. Pour une garantie absolue sur *toutes* les sources, il faudra centraliser aussi les réservations ordinaires dans une transaction verrouillée.

> **Attention capacité :** si la règle `capsDe()` de l'app change, adapter en même temps `places_evenements_calcul()` du script de Mahin.
