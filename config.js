// ============================================================
//  CONFIGURATION — Fantasy Kids Events · Agenda
// ============================================================
//  Collez ici les 2 valeurs de votre projet Supabase
//  (Supabase → Project Settings → API).
//
//  Tant que ces deux champs sont vides, l'app tourne en
//  « MODE DÉMO » : les événements sont gardés uniquement
//  sur l'appareil, rien n'est partagé avec l'équipe.
// ============================================================

window.APP_CONFIG = {
  SUPABASE_URL: "https://shyrdgepnvqszevbowmc.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_IytqseiwZObbXD6Lqu-h3Q_AsIrQJM2",  // la clé "anon" / "publishable" (longue chaîne)

  // Clé publique des notifications (générée avec cles-notifications.html)
  VAPID_PUBLIC_KEY: "BM9cxWevKr3Y9FqoJ7liEqQCrmEiPrRD6u9VzglUx4qhtJkauxDLt7wVNjM2DGiYNXFCBzXienAvLmRToJPOSCc",

  // Prix d'un tatouage paillettes par enfant (€)
  TATOUAGE_PRIX: 2,

  // Pour le message de confirmation envoyé aux clients
  IBAN: "BE39068904272019",                         // ex : "BE12 3456 7890 1234"
  BENEFICIAIRE: "Mahin Jordan",

  // Nom affiché en haut de l'app
  NOM_APP: "Fantasy Kids Events",
};
