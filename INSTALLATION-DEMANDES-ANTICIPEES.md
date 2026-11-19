# 💜 Demandes anticipées — mise en service

Le parcours s'applique aux **nouvelles demandes d'animation** dont la date
d'ouverture (date de prestation moins trois mois calendaires) est dans le futur.
Il ne convertit pas rétroactivement les anciennes fiches et **ne modifie
jamais** les statuts, devis, acomptes ou confirmations existants.

## Étapes (à effectuer par Jordan dans Supabase)

1. Dans **SQL Editor**, exécuter l'intégralité de
   `supabase_demandes_anticipees.sql`. La migration crée les tables, les droits,
   le déclencheur de détection et les deux fonctions sécurisées de réponse.
2. Dans **Edge Functions > notifier**, mettre le code à jour avec la version
   complète de `notifier-index.ts`, puis **Deploy**.
3. Contrôler les secrets existants de `notifier` :
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `GMAIL_USER`,
   `GMAIL_APP_PASSWORD`. `APP_URL` doit être l'URL HTTPS de Fantasy App,
   sans barre oblique finale (par exemple `https://...`).
4. Vérifier que l'appel planifié `RAPPELS` vers `notifier` s'exécute toujours
   **toutes les 5 minutes**. Le nouveau parcours réutilise cette tâche :
   **aucun rappel ne fonctionne si cette planification n'est pas active**.
5. Vérifier que `anticipation.html` est accessible sur le même domaine que
   l'application (le fichier est présent dans le dépôt et le cache PWA).

## Fonctionnement

| Situation | Effet |
|---|---|
| Nouvelle demande > 3 mois | Fiche « En attente » inchangée + suivi violet « Demande anticipée ». |
| Premier passage du planificateur (après 9 h, heure belge) | Accusé de réception au client via Gmail professionnel. |
| Trois mois calendaires avant la prestation | Mail d'intérêt avec deux liens vers `anticipation.html`. |
| Client intéressé | Suivi « Demande reconfirmée » + cloche admin + push au prochain passage. **Aucune réservation confirmée.** |
| Client non intéressé | Suivi « Demande abandonnée » conservé, plus de relance. |
| 7 jours après le mail d'ouverture | Rappel si aucune réponse. |
| 14 jours après le mail d'ouverture | Suivi « Sans réponse », sans bloquer l'agenda. |
| Date de prestation modifiée | Recalcul des trois mois et nouvelle version des liens. |
| Prestation confirmée / annulée depuis la fiche | Suivi clôturé, rappels interrompus. |

Les mails automatiques sont enregistrés dans `demandes_anticipees_emails`.
Une contrainte d'unicité interdit les doublons par étape et version. Une
campagne interrompue après le début d'un SMTP n'est **pas renvoyée
automatiquement** : vérifier le journal avant toute relance manuelle.

L'import Wix déjà présent dans `notifier` alimente ce parcours **uniquement si**
`WIX_API_KEY` et `WIX_SITE_ID` sont réellement configurés et si le formulaire
concerné correspond à l'import existant. Sinon, seules les demandes manuelles
sont prises en charge.

## Vérification sans envoyer de mail à un vrai client

1. Créer une animation de test **plus de trois mois à l'avance**, avec une
   adresse e-mail que tu contrôles. Vérifier l'encadré violet et la date.
2. Vérifier dans `demandes_anticipees` la ligne avec `statut='anticipee'` et
   la bonne `date_ouverture` (exemple : 20/06/2027 → 20/03/2027).
3. Après activation voulue des e-mails, inspecter le journal et le mail de test.
4. Pour tester la réponse, utiliser uniquement le lien reçu dans **ta** boîte,
   et vérifier « Demande reconfirmée » dans l'agenda. Un clic ne doit jamais
   déclencher un devis, un acompte ou une confirmation.

**Important :** déposer ces fichiers sur GitHub n'exécute aucun SQL, ne
déploie aucune fonction Supabase et n'envoie aucun e-mail.
