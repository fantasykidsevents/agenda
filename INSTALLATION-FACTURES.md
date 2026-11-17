# Facturation Fantasy Kids Events — installation

Le module est accessible depuis **Gestion → Factures clients**, uniquement aux responsables.

## 1. Installer les tables Supabase

1. Ouvrir le projet Supabase de l'agenda.
2. Aller dans **SQL Editor**, créer une nouvelle requête.
3. Copier l'intégralité du fichier [`supabase_facturation.sql`](supabase_facturation.sql), puis cliquer sur **Run**.
4. Vérifier la présence de `factures_fantasy` et `factures_fantasy_compteurs` dans le **Table Editor**.

La requête ne supprime pas de factures existantes. Elle ajoute les politiques de sécurité, les fonctions d'émission et les tables nécessaires.

## 2. Si des factures 2026 existent déjà (TRÈS IMPORTANT)

La numérotation suit le format du modèle historique : `2026/001`, `2026/002`, etc.
Si des factures de l'année 2026 ont déjà été émises **hors application**, il faut impérativement reprendre la suite de la numérotation avant d'en émettre une dans Fantasy.

Exemple : la dernière facture papier de 2026 est `2026/017`. Exécuter dans SQL Editor :

```sql
insert into public.factures_fantasy_compteurs (annee, dernier_numero)
values (2026, 17)
on conflict (annee) do update set dernier_numero = 17;
```

**Remplacer `17` par le dernier numéro réel.** Ne pas exécuter cet exemple tel quel sans vérifier les factures déjà émises. Si aucune facture n'a encore été émise en 2026, ne rien initialiser : la première portera le numéro `2026/001`.

## 3. Utilisation

- Dans **Gestion → Factures clients**, cliquer sur **Nouvelle facture**.
- Choisir une prestation de l'agenda (ou une facture libre) ; les informations client et le prix pourront être modifiés.
- Vérifier systématiquement les déplacements : le prix de l'agenda peut déjà les inclure.
- Compléter l'adresse du client, les coordonnées de l'émetteur, les lignes, la mention TVA et la date d'échéance.
- **Enregistrer le brouillon**, puis **Émettre et numéroter** quand tout est correct.
- **Imprimer / PDF** ouvre l'impression de l'appareil ; choisir *Enregistrer au format PDF*.
- Cliquer sur **Marquer payée** lorsque le paiement est effectivement reçu.

La facture émise est verrouillée. Peppol et les envois automatiques par e-mail ne sont pas inclus dans cette version.

## 4. Mise en garde

Le formulaire préremplit des coordonnées reprises du modèle transmis ; **vérifier qu'elles sont encore légalement exactes** avant toute émission. Les valeurs sont mémorisées localement sur l'appareil du responsable.

Ce système gère les factures classiques PDF ; il ne valide pas la conformité d'un flux de facturation électronique ni les obligations fiscales applicables à la situation de l'entreprise.
