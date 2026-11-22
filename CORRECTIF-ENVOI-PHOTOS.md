# Correctif : envoi vérifié des photos clients — Fantasy App

## Pourquoi ce correctif
L'ancien bouton "Envoyer les photos" modifiait simplement `evenements.photos_envoyees` ; un webhook Supabase essayait d'envoyer le mail **après**, sans prévenir l'application en cas d'échec. Un faux message "Mail envoyé !" pouvait donc apparaître.

## Installation — ordre conseillé
1. **GitHub** : `index.html` et `sw.js` sont publiés dans la branche principale.
2. **Supabase > Edge Functions > notifier > Code** : remplacer le code par le fichier complet `notifier-index.ts` de la branche `main`, puis **Deploy**. Le redéploiement de la fonction est INDISPENSABLE, la mise à jour GitHub seule ne peut pas envoyer les mails.
3. Actualiser Fantasy App (si nécessaire fermer/réouvrir l'app PWA pour charger le cache v149).
4. Ouvrir une fiche d'animation terminée : coller le lien https des photos, et cliquer sur **Envoyer le mail des photos**. Attendre la réponse, ne pas multiplier les clics.
5. L'application attend explicitement `{ok:true,mailAccepte:true,statut:"accepte_par_gmail"}` du serveur et n'affiche de succès qu'alors. Si le notifier n'a pas été mis à jour, elle refuse de déclarer le mail envoyé.

## Si les photos sont déjà marquées envoyées à tort
Ouvrir la fiche, laisser le lien visible et utiliser le bouton **Renvoyer le mail des photos**. Le message est explicitement renvoyé au client et le statut est remis à jour après acceptation Gmail. Si vous souhaitez simplement effacer le faux statut sans envoyer, utiliser **Corriger le statut sans envoyer**.

## Ce qui change
- L'envoi de photos est déclenché une seule fois par l'action directe `PHOTOS_CLIENT_SEND`, plus par le webhook de modification d'événement. Le serveur vérifie que la requête vient du responsable autorisé.
- Le statut n'est validé qu'après la réponse du serveur SMTP Gmail. Un échec laisse la fiche ouverte avec un message d'erreur explicite.
- Le retour indique aussi le compte expéditeur configuré par `GMAIL_USER`. **Vérifier les éléments envoyés de ce compte**, qui peut différer du compte Gmail consulté.
- Le journal des e-mails (`fantasy_emails_journal`) sera alimenté si `fantasy-supervision.sql` a déjà été exécuté. Le journal est facultatif pour l'envoi.
- La notification "accepté par Gmail" n'est pas une preuve de livraison au destinataire ou de présence en boîte principale.

## Précaution
Si le client a pu recevoir le précédent message malgré son absence dans les éléments envoyés du compte consulté, une relance explicite peut créer un doublon. Vérifier d'abord le compte `GMAIL_USER`, et confirmer avec le client en cas d'incertitude. Aucun envoi automatique n'est relancé par cette migration.
