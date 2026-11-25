// ============================================================
//  Fantasy Kids Events · fonction « notifier »
//  Envoie une notification téléphone + un e-mail aux animateurs
//  quand on les ajoute à une animation, quand elle change
//  (date, heure, adresse, rôle, enceinte) ou quand elle est annulée,
//  quand du matériel manquant est signalé (+ responsables),
//  et un rappel 1h avant le début (déclenché toutes les 5 min).
//
//  À coller dans Supabase → Edge Functions → nom : notifier
// ============================================================
import webpush from "npm:web-push@3.6.7";
import nodemailer from "npm:nodemailer@6.9.16";
import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k) => Deno.env.get(k) || "";
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const APP_URL = env("APP_URL").replace(/\/+$/, "");
const EMAIL_PRO = env("FANTASY_PRO_EMAIL") || "fantasykidsevents@gmail.com";
// Les alertes importantes vont sur la boîte professionnelle habituelle.
const EMAIL_GESTION = EMAIL_PRO;

const PUSH_OK = !!(env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY"));
if (PUSH_OK) {
  webpush.setVapidDetails(
    env("VAPID_SUBJECT") || "mailto:" + (env("GMAIL_USER") || "contact@example.com"),
    env("VAPID_PUBLIC_KEY"),
    env("VAPID_PRIVATE_KEY"),
  );
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- utilitaires ----------
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// "Cyrielle (Elsa), Margot (accompagnatrice)" -> [{nom, role}]
function equipeDe(ev) {
  return (ev?.animateurs || "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = x.match(/^(.*?)\s*\((.*)\)\s*$/);
    return m ? { nom: m[1].trim(), role: m[2].trim() } : { nom: x, role: "" };
  });
}

// L'heure des animations est saisie en heure belge (pas en UTC).
// Le planificateur lance RAPPELS toutes les cinq minutes : ce test évite
// tout rappel avant cinq minutes après l'heure réelle de fin prévue.
function maintenantBelgiqueMs() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).filter((p) => p.type !== "literal").map((p) => [p.type, +p.value]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}
function rappelFinEligible(ev, maintenantMs) {
  if (!ev.date || (!ev.heure_fin && !ev.heure_debut)) return false;
  const [y, m, d] = ev.date.slice(0, 10).split("-").map(Number);
  const horaire = ev.heure_fin || ev.heure_debut;
  const [h, min] = horaire.slice(0, 5).split(":").map(Number);
  let finMs = Date.UTC(y, m - 1, d, h, min);
  if (!ev.heure_fin) finMs += 90 * 60_000;
  else if (ev.heure_debut && ev.heure_fin.slice(0, 5) < ev.heure_debut.slice(0, 5)) finMs += 24 * 60 * 60_000;
  return maintenantMs >= finMs + 5 * 60_000;
}
// Le rappel tatouages intervient à mi-animation (heure belge), jamais après
// l'heure de fin. Si la durée manque, on considère une animation de 90 min.
function rappelTatouagesMilieuEligible(ev, maintenantMs) {
  if (!ev.date || !ev.heure_debut) return false;
  const [y, m, d] = ev.date.slice(0, 10).split("-").map(Number);
  const [h, min] = ev.heure_debut.slice(0, 5).split(":").map(Number);
  const debutMs = Date.UTC(y, m - 1, d, h, min);
  let finMs = debutMs + 90 * 60_000;
  if (ev.heure_fin) {
    const [fh, fm] = ev.heure_fin.slice(0, 5).split(":").map(Number);
    finMs = Date.UTC(y, m - 1, d, fh, fm);
    if (finMs <= debutMs) finMs += 24 * 60 * 60_000;
  }
  const milieuMs = debutMs + (finMs - debutMs) / 2;
  return maintenantMs >= milieuMs && maintenantMs < finMs;
}
const estAccompagnateur = (role) => /^(acc|accompagn)/i.test(String(role || "").trim());
const tatouagesDemandes = (ev) => {
  const option = ev?.options?.tatouage;
  return option === true || Number(option) > 0 || /^(oui|yes|true)$/i.test(String(option || ""));
};
const tatouagesACompleter = (ev) => ev.date >= "2026-11-15" && tatouagesDemandes(ev) &&
  (ev.tatouages_nb == null || (Number(ev.tatouages_nb) > 0 && !ev.tatouages_paiement));
const validationSoldeManquante = (ev) => soldeAuClient(ev) > 0 && !ev.solde_encaisse;
// Supprime les rappels déjà réglés de la cloche de TOUS les membres concernés.
async function classerRappels(evId, type) {
  const { error } = await sb.from("notifications_app")
    .update({ lue_le: new Date().toISOString() })
    .eq("evenement_id", String(evId)).eq("type", type).is("lue_le", null);
  if (error) console.error("Rangement des rappels", type, evId, error.message);
}
async function classerFinSiTerminee(ev) {
  if (!ev || validationSoldeManquante(ev) || tatouagesACompleter(ev)) return;
  const { data, error } = await sb.from("bilans").select("id").eq("evenement_id", ev.id).limit(1);
  if (error) { console.error("Vérification bilan", error.message); return; }
  if (data?.length) await classerRappels(ev.id, "fin");
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function quand(ev) {
  const [y, m, d] = ev.date.split("-").map(Number);
  const jour = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("fr-BE", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });
  const h = (t) => (t ? t.slice(0, 5).replace(":", "h") : "");
  const heure = ev.heure_debut ? ` à ${h(ev.heure_debut)}${ev.heure_fin ? " – " + h(ev.heure_fin) : ""}` : "";
  return jour + heure;
}

const titreDe = (ev) => ev.titre || ev.theme || (ev.enfant ? `Anniversaire de ${ev.enfant}` : "Animation");

const TEXTES = {
  nouvelle: { emoji: "🎭", titre: "Nouvelle animation" },
  modifiee: { emoji: "✏️", titre: "Animation modifiée" },
  annulee:  { emoji: "❌", titre: "Animation annulée" },
  retire:   { emoji: "👋", titre: "Vous n'êtes plus sur cette animation" },
  paie:     { emoji: "💶", titre: "Votre prestation a été payée" },
  rappel:   { emoji: "⏰", titre: "C'est bientôt !" },
  rappel_veille: { emoji: "📅", titre: "C'est demain !" },
  materiel: { emoji: "⚠️", titre: "Matériel manquant signalé" },
  fin:      { emoji: "🏁", titre: "À faire après l'animation" },
  tatouages_milieu: { emoji: "🦋", titre: "Tatouages : pensez à encaisser !" },
  demande:  { emoji: "📩", titre: "Nouvelle demande de réservation (site)" },
  encaisse: { emoji: "💶", titre: "Solde encaissé" },
  nonpaye:  { emoji: "⚠️", titre: "Solde NON payé" },
  acompte:  { emoji: "💰", titre: "Acompte pas encore reçu" },
  fiche:    { emoji: "📝", titre: "Fiche anniversaire reçue" },
  fiche_manuelle: { emoji: "📨", titre: "Fiche anniversaire à envoyer vous-même" },
  meteo:    { emoji: "🌧️", titre: "Pluie prévue – animation en extérieur" },
  materiel_j3: { emoji: "⚠️", titre: "Matériel manquant – animation dans 3 jours" },
  materiel_j1: { emoji: "🚨", titre: "Matériel manquant – animation DEMAIN" },
};
const ENCEINTES = { jbl_bleu: "🔵 JBL bleu", jbl_rouge: "🔴 JBL rouge" };
const TATOUAGE_PRIX = Number(Deno.env.get("TATOUAGE_PRIX") || 2);
const soldeAuClient = (ev) => (+ev.solde || 0) + (+ev.supplement || 0);
const extrasTxt = (ev) => ev.supplement ? `supplément${ev.supplement_note ? " " + ev.supplement_note : ""}` : "";

// ---------- envoi ----------
let mailer = null;
function getMailer() {
  if (!env("GMAIL_USER") || !env("GMAIL_APP_PASSWORD")) return null;
  if (!mailer) mailer = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: env("GMAIL_USER"), pass: env("GMAIL_APP_PASSWORD").replace(/\s/g, "") },
  });
  return { transport: mailer, adresse: env("GMAIL_USER") };
}

// Suivi central des tentatives d'envoi. La création du journal ne peut jamais
// provoquer un second envoi ni empêcher la transmission d'un e-mail.
async function journaliserEmail(
  to: string, sujet: string, canal: "client" | "interne",
  statut: "accepte" | "echec", erreur: unknown = null, providerId = ""
) {
  const fournisseur = canal === "client" ? "gmail" : "resend";
  // Ne stocker ni pièces jointes, ni corps du message, ni données d'authentification.
  const raison = erreur
    ? String((erreur as { code?: string; message?: string })?.code ||
             (erreur as { message?: string })?.message || erreur)
        .replace(/https?:\/\/\S+/gi, "[url]")
        .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email]")
        .replace(/(?:bearer|token|apikey|api_key|password)[=: ]+\S+/gi, "[secret]")
        .slice(0, 240)
    : null;
  try {
    const { error } = await sb.from("fantasy_emails_journal").insert({
      canal, fournisseur, destinataire: String(to || "").slice(0, 254),
      sujet: String(sujet || "").slice(0, 250), statut,
      code_erreur: raison, identifiant_fournisseur: String(providerId || "").slice(0, 120) || null
    });
    if (error && error.code !== "42P01" && error.code !== "PGRST205")
      console.warn("Journal e-mails non enregistré :", error.message);
  } catch (e) {
    console.warn("Journal e-mails momentanément indisponible :", (e as Error)?.message || String(e));
  }
}
async function envoyerEmail(to, sujet, html, texte, pj = [], options: { canal?: "client" | "interne" } = {}) {
  const canal = options.canal || "interne";
  try {
    if (canal === "client") {
      // Les messages aux clients restent envoyés par Gmail et apparaissent dans
      // ses éléments envoyés. L'acceptation SMTP n'est pas une preuve de réception.
      const config = getMailer();
      if (!config) throw new Error("Envoi au client impossible : compte Gmail professionnel non configuré.");
      const response = await config.transport.sendMail({
        from: '"Fantasy Kids Events" <' + config.adresse + '>',
        to, subject: sujet, html, text: texte,
        attachments: pj.map((a) => ({ filename: a.filename, content: a.content })),
      });
      await journaliserEmail(to, sujet, canal, "accepte", null, String(response?.messageId || ""));
      return;
    }
    // Notifications internes via Resend exclusivement (sans repli sur Gmail).
    const cleResend = env("RESEND_API_KEY");
    const expediteur = env("EMAIL_FROM_AUTO") || env("EMAIL_FROM");
    if (!cleResend || !expediteur)
      throw new Error("Notification interne non envoyée : Resend n'est pas configuré (aucun repli sur Gmail).");
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + cleResend, "Content-Type": "application/json" },
      body: JSON.stringify({ from: expediteur, to, subject: sujet, html, text: texte,
        reply_to: env("EMAIL_REPLY_TO") || env("GMAIL_USER") || "fantasykidsevents@gmail.com",
        ...(pj.length ? { attachments: pj.map((a) => ({
          filename: a.filename,
          content: btoa(Array.from(a.content, (c) => String.fromCharCode(c)).join(""))
        })) } : {}) }),
    });
    if (!r.ok) throw new Error("Resend HTTP " + r.status + " : " + (await r.text()).slice(0, 250));
    const data = await r.json().catch(() => ({}));
    await journaliserEmail(to, sujet, canal, "accepte", null, String(data?.id || ""));
  } catch (erreur) {
    await journaliserEmail(to, sujet, canal, "echec", erreur);
    throw erreur;
  }
}

// Préférences individuelles : les cases non encore enregistrées restent cochées.
// Elles ne concernent jamais les mails transactionnels envoyés AUX CLIENTS.
const CATEGORIES = {
  nouvelle: "prestation", modifiee: "prestation", annulee: "prestation", retire: "prestation",
  rappel: "rappels", rappel_veille: "rappels", fin: "rappels", tatouages_milieu: "rappels",
  paie: "paiements",
  materiel: "materiel", materiel_j3: "materiel", materiel_j1: "materiel",
  meteo: "meteo",
  demande: "administration", encaisse: "administration", nonpaye: "administration",
  acompte: "administration", fiche: "administration", fiche_manuelle: "administration",
};
const categorieDe = (type) => CATEGORIES[type] || "autres";
// Les courriels d'administration destinés au responsable peuvent être reçus
// dans une autre boîte, sans modifier son identifiant de connexion ni les
// notifications de la cloche/push. Vide = comportement précédent.
let routageAdminCache: null | { origine: string; destination: string; expire: number } = null;
async function adresseMailAdministration(email: string) {
  if (!email) return email;
  if (!routageAdminCache || routageAdminCache.expire < Date.now()) {
    const { data, error } = await sb.from("reglages").select("cle,valeur")
      .in("cle", ["notifications_admin_email", "notifications_admin_origine"]);
    if (error) {
      console.error("Routage des mails administratifs :", error.message);
      return email;
    }
    const param = Object.fromEntries((data || []).map((x) => [x.cle, x.valeur]));
    routageAdminCache = {
      origine: String(param.notifications_admin_origine || "").trim().toLowerCase(),
      destination: String(param.notifications_admin_email || "").trim().toLowerCase(),
      expire: Date.now() + 30000
    };
  }
  const r = routageAdminCache;
  return r.origine === email.trim().toLowerCase() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.destination)
    ? r.destination : email;
}

// Une décision du client sur un devis est importante : elle part aussi par
// e-mail au responsable, indépendamment des préférences des rappels courants.
// Le mail passe par Resend, sans ajouter de message dans « Envoyés » de Gmail.
async function mailDecisionDevis(titre: string, details: string, evenementId: string) {
  // Adresse confirmée explicitement par Jordan : ne pas rediriger vers une
  // préférence ou une variable d'environnement pouvant changer le destinataire.
  const destinataire = "fantasykidsevents@gmail.com";
  const lien = `${APP_URL || "."}/index.html?ev=${encodeURIComponent(evenementId)}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:540px;margin:auto;color:#241b34">
    <div style="height:6px;background:linear-gradient(90deg,#00b4ff,#8a3cf7,#d63fd0)"></div>
    <h2>${esc(titre)}</h2><p style="white-space:pre-line;line-height:1.6">${esc(details)}</p>
    <p><a href="${lien}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#793bd3;color:#fff;text-decoration:none">Ouvrir la fiche dans Fantasy</a></p>
    <p style="font-size:12px;color:#6b6385">Notification automatique Fantasy Kids Events</p></div>`;
  await envoyerEmail(destinataire, `${titre} – Fantasy Kids Events`, html,
    `${titre}\n\n${details}\n\nOuvrir la fiche : ${lien}`, [], { canal: "interne" });
  return destinataire;
}
const categoriePush = (tag = "") => {
  if (/^(chat|ment)-/i.test(tag)) return "chat";
  if (/costume|stock|checklist|materiel|repar|piece-perso/i.test(tag)) return "materiel";
  if (/pointage|point|sortie/i.test(tag)) return "rappels";
  if (/resa|devis|bilan|vente|caisse|resume-matin|recap/i.test(tag)) return "administration";
  return "autres";
};
async function canauxChoisis(email, categorie) {
  if (!email) return { email: false, push: false };
  const { data, error } = await sb.from("preferences_notifications").select("choix")
    .eq("email", String(email).trim().toLowerCase()).maybeSingle();
  if (error) {
    console.error("Préférences de notifications :", error.message);
    // En cas d'incident, on n'envoie pas d'alerte non sollicitée :
    // la cloche personnelle reste enregistrée indépendamment de ces choix.
    return { email: false, push: false };
  }
  const choix = data?.choix?.[categorie] || {};
  // Le chat n'envoyait jusqu'ici que des pushs : pas de nouveaux e-mails
  // en rafale tant que chacun n'a pas explicitement coché cette option.
  return { email: choix.email === undefined ? categorie !== "chat" : choix.email === true,
    push: choix.push !== false };
}
async function garderDansCloche(email, payload, categorie, evId = null, cleUnique = null) {
  if (!email) return { deja: false };
  const { error } = await sb.from("notifications_app").insert({
    destinataire_email: String(email).trim().toLowerCase(),
    titre: String(payload.title || "🔔 Notification Fantasy"),
    message: String(payload.body || ""),
    type: categorie,
    evenement_id: evId == null ? null : String(evId),
    lien: String(payload.url || "") || null,
    cle_unique: cleUnique,
  });
  if (error?.code === "23505") return { deja: true };
  if (error) console.error("Boîte de notifications :", error.message);
  return { deja: false };
}

async function envoyerPush(email, payload, options = {}) {
  if (!email) return 0;
  const categorie = options.categorie || categoriePush(payload?.tag);
  // Alertes importantes : la cloche garde la trace, même si le push est désactivé.
  // Messages du chat : uniquement push/e-mail selon les préférences ; les non-lus
  // sont déjà visibles dans l'onglet Chat, sans encombrer la cloche.
  if (!options.dejaEnCloche && !options.sansCloche)
    await garderDansCloche(email, payload, categorie, options.evId ?? null);
  const pushVoulu = options.autorisePush === undefined
    ? (await canauxChoisis(email, categorie)).push : options.autorisePush;
  if (!pushVoulu) return 0;
  if (!PUSH_OK) return 0;
  const { data: subs } = await sb.from("push_subscriptions").select("*").ilike("email", email);
  let n = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 24 },
      );
      n++;
    } catch (e) {
      // abonnement expiré -> on le supprime
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await sb.from("push_subscriptions").delete().eq("id", s.id);
      } else console.error("push", e?.statusCode, e?.body || e);
    }
  }
  return n;
}

async function prevenir(email, prenom, type, ev, role, options: { sansEmail?: boolean } = {}) {
  if (!email) return { pushs: 0, mail: "pas d'e-mail" };
  const T = TEXTES[type];
  const titresPro = { nouvelle: "Nouveau contrat pro", modifiee: "Contrat pro modifié", annulee: "Contrat pro annulé", retire: "Vous n'êtes plus sur ce contrat pro" };
  const titreNotif = ev.type_evenement === "contrat_pro" ? (titresPro[type] || T.titre) : T.titre;
  const emojiNotif = ev.type_evenement === "contrat_pro" && titresPro[type] ? "💼" : T.emoji;
  const titre = titreDe(ev);
  const estFicheDuJour = type === "fin" || type === "tatouages_milieu";
  const url = `${APP_URL || "."}/index.html?ev=${ev.id}${estFicheDuJour ? "&signal=1" : ""}`;
  const enceinte = ENCEINTES[ev.enceinte] || "";
  const euros = (n) => `${Number(n || 0).toFixed(2).replace(".", ",").replace(",00", "")} €`;
  let body = `${titre}\n${quand(ev)}${role ? `\nRôle : ${role === "acc" ? "accompagnateur" : role}` : ""}`;
  if (type === "rappel_veille") {
    let h = "";
    try { const x = JSON.parse(ev.equipe_detail || "[]").find((y) => norm(y.prenom) === norm(prenom)); if (x && (x.debut || x.fin)) h = `${(x.debut || "…").slice(0, 5).replace(":", "h")} – ${(x.fin || "…").slice(0, 5).replace(":", "h")}`; } catch (_) { /* */ }
    const evt = ["evenement", "repetition", "contrat_pro"].includes(ev.type_evenement);
    body = `${titre}\n${quand(ev)}${role ? `\n${evt ? "Ton poste" : "Rôle"} : ${role === "acc" ? "accompagnateur" : role}` : ""}${evt ? (h ? `\n🕐 Tes horaires : ${h}` : "\n🕐 Toute la journée") : ""}${ev.adresse ? `\n📍 ${ev.adresse}` : ""}`;
  }
  if (type === "rappel") body = `${titre}\n${quand(ev)}${ev.adresse ? `\n📍 ${ev.adresse}` : ""}${enceinte ? `\n🔊 ${enceinte}` : ""}`;
  if (type === "fin") {
    const taches = [ev.__bilanManquant ? "remplir le bilan" : "", ev.__soldeManquant ? "confirmer la réception du solde (liquide, virement ou Payconiq), ou le signaler non payé" : "",
      ev.__tatouagesManquants ? "compter les enfants tatoués et confirmer le paiement des tatouages (2 € par enfant)" : ""].filter(Boolean);
    body = `${titre}\nÀ faire : ${taches.join(" et ")}.\nTouchez ici pour ouvrir la fiche du jour et vérifier aussi le matériel.`;
  }
  if (type === "tatouages_milieu") {
    body = ev.tatouages_nb == null
      ? `${titre}\nL'animation est à mi-parcours : compte les enfants qui ont reçu un tatouage pailleté (${TATOUAGE_PRIX} € chacun), puis fais régler le total aux parents avant de partir. Note le nombre et le paiement dans la fiche du jour.`
      : `${titre}\n${ev.tatouages_nb} tatouage${ev.tatouages_nb > 1 ? "s" : ""} compté${ev.tatouages_nb > 1 ? "s" : ""} : pense à faire payer ${euros(Number(ev.tatouages_nb) * TATOUAGE_PRIX)} avant de partir et à confirmer le mode de paiement.`;
  }
  const MODES = { cash: "liquide", virement: "virement", payconiq: "Payconiq", non: "non payé" };
  if (type === "encaisse" || type === "nonpaye")
    body = `${ev.solde_encaisse_par || "?"} : ${euros(soldeAuClient(ev))} (${MODES[ev.solde_encaisse] || ""})${extrasTxt(ev) ? "\ndont " + extrasTxt(ev) : ""}\n${titre} · ${quand(ev)}`;
  if (type === "materiel_j3" || type === "materiel_j1") body = `${titre} · ${quand(ev)}\nToujours manquant :\n${ev.__manquants}`;
  if (type === "fiche") body = `${ev.__fiche?.enfant_prenom || ev.enfant || ""}${ev.__fiche?.enfant_age ? ", " + ev.__fiche.enfant_age + " ans" : ""} · ${ev.__fiche?.nb_enfants || "?"} enfants\n${titre} · ${quand(ev)}${ev.__dateDiff ? "\n⚠️ Date indiquée par le parent : " + ev.__dateDiff : ""}`;
  if (type === "fiche_manuelle") body = `Pas d'e-mail pour ce client : envoyez le lien de la fiche par WhatsApp / Messenger depuis l'animation.\n${titre} · ${quand(ev)}`;
  if (type === "meteo") body = `${ev.__meteo}\n${titre} · ${quand(ev)}\nPensez à un plan B avec le parent.`;
  if (type === "acompte") body = `${euros(ev.__acompte)} à recevoir – animation dans ${ev.__jours} jour${ev.__jours > 1 ? "s" : ""}\n${titre} · ${quand(ev)}\n${ev.parent || ""}${ev.telephone ? " · " + ev.telephone : ""}`;
  if (type === "demande") body = `${ev.parent || ""}${ev.telephone ? " · " + ev.telephone : ""}\n${titre}\n${quand(ev)}`;
  if (type === "materiel") body = `${ev.__nouveau_manquant || ev.materiel_manquant}\n${titre} · ${quand(ev)}`;
  if (type === "paie") body = `Votre paiement de ${euros(ev.__montant)} est enregistré ✅\n${titre} · ${quand(ev)}`;

  const lien = estFicheDuJour ? `./index.html?ev=${ev.id}&signal=1` : `./index.html?ev=${ev.id}`;
  // La cloche fonctionne même si la personne a refusé les notifications téléphone.
  // La clé évite d'envoyer deux fois le même avis de paiement (même prestation / même jour).
  const boite = await garderDansCloche(email, { title: `${emojiNotif} ${titreNotif}`, body, url: lien },
    type, ev.id, type === "paie" ? ev.__paiementCle : null);
  if (boite.deja && type === "paie")
    return { email, prenom, type, ignore: "notification de paiement déjà envoyée" };
  const categorie = categorieDe(type);
  const canaux = await canauxChoisis(email, categorie);
  const pushs = await envoyerPush(email, {
    title: `${emojiNotif} ${titreNotif}`, body, url: lien, tag: `${type}-${ev.id}`,
  }, { categorie, dejaEnCloche: true, autorisePush: canaux.push });
  // En pleine prestation, une alerte dans la cloche + un push suffit :
  // ne pas envoyer d'e-mail supplémentaire à l'accompagnateur.
  if (type === "tatouages_milieu") return { email, prenom, type, pushs, mail: "non (rappel sur téléphone)" };
  if (options.sansEmail) return { email, prenom, type, pushs, mail: "centralisé dans la boîte Fantasy" };
  // Jordan suit les tâches habituelles dans l'app : pas de doublon par mail.
  // Les incidents critiques continuent d'arriver dans sa boîte principale.
  if (norm(prenom) === "jordan" && ev.id !== "test" && !["nonpaye", "materiel_j1"].includes(type))
    return { email, prenom, type, pushs, mail: "dans l'application (sans e-mail)" };
  if (!canaux.email) return { email, prenom, type, pushs, mail: "désactivé dans les préférences" };

  const lignes = [
    ...(type === "paie" ? [["💶 Paiement enregistré", euros(ev.__montant)]] : []),
    ...(type === "materiel" ? [["⚠️ Nouveau", ev.__nouveau_manquant], ["📋 Tout ce qui manque", ev.materiel_manquant]] : []),
    ...(type === "encaisse" || type === "nonpaye" ? [["💶 Solde", `${euros(soldeAuClient(ev))} – ${MODES[ev.solde_encaisse] || ""}`],
      ["🧾 Détail (hors tatouages)", `solde ${euros(ev.solde)}${ev.supplement ? ` + ${euros(ev.supplement)}${ev.supplement_note ? " (" + ev.supplement_note + ")" : ""}` : ""}`],
      ["👤 Par", ev.solde_encaisse_par]] : []),
    ...(type === "materiel_j3" || type === "materiel_j1" ? [["⚠️ Toujours manquant", ev.__manquants]] : []),
    ...(type === "fiche" ? [
      ["⚠️ Attention", ev.__dateDiff ? "le parent a indiqué une autre date : " + ev.__dateDiff : ""],
      ["👤 Client", `${ev.__fiche?.client_nom || ""} · ${ev.__fiche?.telephone || ""}`],
      ["🎂 Enfant", `${ev.__fiche?.enfant_prenom || ""}, ${ev.__fiche?.enfant_age || "?"} ans`],
      ["👧 Enfants présents", `${ev.__fiche?.nb_enfants || "?"}${(ev.__fiche?.tranches || []).length ? " (" + ev.__fiche.tranches.join(", ") + ")" : ""}`],
      ["🏠 Lieu", `${ev.__fiche?.lieu || ""}${ev.__fiche?.lieu_autre ? " – " + ev.__fiche.lieu_autre : ""} · espace dégagé : ${ev.__fiche?.espace || "?"}`],
      ["🚗 Accès", ev.__fiche?.acces],
      ["🧸 Mascotte", ev.__fiche?.mascotte === "Oui" ? `Oui · pièce discrète pour se changer : ${ev.__fiche?.piece_mascotte || "?"}` : ev.__fiche?.mascotte],
      ["⚠️ Allergies / infos", ev.__fiche?.allergies],
      ["📸 Photos", ev.__fiche?.photos],
    ] : []),
    ...(type === "meteo" ? [["🌧️ Prévision", ev.__meteo], ["👤 Client", `${ev.parent || ""}${ev.telephone ? " · " + ev.telephone : ""}`]] : []),
    ...(type === "acompte" ? [["💰 Acompte", euros(ev.__acompte)], ["👤 Client", `${ev.parent || ""}${ev.telephone ? " · " + ev.telephone : ""}`]] : []),
    ...(type === "demande" ? [["👤 Client", `${ev.parent || ""}${ev.telephone ? " · " + ev.telephone : ""}`], ["📝 Détails", ev.notes]] : []),
    ["📅 Quand", quand(ev)],
    ["🎭 Votre rôle", role === "acc" ? "Accompagnateur (acc)" : role],
    ["✨ Thème", ev.theme],
    ["🎂 Enfant", ev.enfant ? `${ev.enfant}${ev.age ? `, ${ev.age} ans` : ""}` : ""],
    ["📍 Adresse", ev.adresse],
    ["👥 Équipe", ev.animateurs],
    ["🔊 Enceinte", enceinte],
    ["🎒 Matériel", ev.materiel],
    ...(type !== "materiel" && ev.materiel_manquant ? [["⚠️ Manquant", ev.materiel_manquant]] : []),
  ].filter(([, v]) => v);

  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1f1735">
    <div style="height:6px;border-radius:3px;background:linear-gradient(90deg,#00b4ff,#a020ff,#d63fd0,#ff7f7f)"></div>
    <p style="font-size:16px">Bonjour ${esc(prenom)},</p>
    <h2 style="margin:0 0 6px">${emojiNotif} ${esc(titreNotif)}</h2>
    <h3 style="margin:0 0 14px;color:#8a3cf7">${esc(titre)}</h3>
    <table style="font-size:15px;border-collapse:collapse">
      ${lignes.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b6385;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:4px 0;white-space:pre-line">${esc(v)}</td></tr>`).join("")}
    </table>
    ${ev.adresse ? `<p><a href="https://maps.google.com/?q=${encodeURIComponent(ev.adresse)}">Ouvrir l'itinéraire</a></p>` : ""}
    ${APP_URL ? `<p><a href="${url}" style="display:inline-block;background:#8a3cf7;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold">${type === "fin" ? "Signaler le matériel manquant" : "Voir dans l'agenda"}</a></p><p style="color:#6b6385;font-size:13px;margin-top:6px">📱 Le plus simple : ouvre l’app <b>Fantasy</b> sur ton écran d’accueil (un lien dans un mail s’ouvre toujours dans le navigateur).</p>` : ""}
    <p style="color:#6b6385;font-size:13px">Fantasy Kids Events</p></div>`;

  const texte = `Bonjour ${prenom},\n\n${titreNotif}\n${titre}\n\n` +
    lignes.map(([k, v]) => `${k} : ${v}`).join("\n") + (APP_URL ? `\n\nVoir dans l'agenda : ${url}` : "");

  let mail = "envoyé";
  try {
    const boite = norm(prenom) === "jordan" && ev.type_evenement === "contrat_pro"
      ? EMAIL_PRO : categorie === "administration" && norm(prenom) === "jordan"
      ? EMAIL_GESTION : await adresseMailAdministration(email);
    mail = (await envoyerEmail(boite, `${emojiNotif} ${titreNotif} – ${titre} (${quand(ev)})`, html, texte, [],
      { canal: "interne" })) || "envoyé";
  }
  catch (e) { mail = "erreur : " + (e?.message || e); console.error("email", e); }
  return { email, prenom, type, pushs, mail };
}

// ---------- import des demandes du site Wix ----------
const WIX_FORM_ID = env("WIX_FORM_ID") || "cc4bc268-f8b9-4269-b00b-101d7703fc6d";
const DUREES = { "30 min": 30, "1 h": 60, "1 h 30": 90, "2 h": 120 };
function plusMinutes(hhmmss, min) {
  const [h, m] = hhmmss.split(":").map(Number);
  const t = h * 60 + m + min;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
async function importerDemandes() {
  if (!env("WIX_API_KEY") || !env("WIX_SITE_ID")) return [];
  const { data: p } = await sb.from("parametres").select("valeur").eq("cle", "import_depuis").maybeSingle();
  const depuis = p?.valeur || env("WIX_IMPORT_DEPUIS") || new Date(Date.now() - 24 * 3600e3).toISOString();
  const r = await fetch("https://www.wixapis.com/form-submission-service/v4/submissions/namespace/query", {
    method: "POST",
    headers: { Authorization: env("WIX_API_KEY"), "wix-site-id": env("WIX_SITE_ID"), "Content-Type": "application/json" },
    body: JSON.stringify({ query: {
      filter: { namespace: "wix.form_app.form", formId: WIX_FORM_ID },
      sort: [{ fieldName: "createdDate", order: "DESC" }],
      cursorPaging: { limit: 50 },
    } }),
  });
  if (!r.ok) throw new Error("Wix " + r.status + " : " + (await r.text()));
  const { submissions = [] } = await r.json();
  const aTraiter = submissions.filter((s) => s.createdDate > depuis).reverse();
  let dernier = depuis;
  const crees = [];
  for (const s of aTraiter) {
    if (s.createdDate > dernier) dernier = s.createdDate;
    const v = s.submissions || {};
    if (!v.date_souhaitee_6yyz11) continue;
    let perso = String(v.personnage_souhaite_u2u8hh || "").split("·").pop().trim();
    if (/^je ne sais/i.test(perso)) perso = "personnage à définir";
    const parts = String(v.formule_l88xfq || "").split("·").map((x) => x.trim()).filter(Boolean);
    const prixTxt = parts.find((x) => /€/.test(x));
    const prix = prixTxt ? Number(prixTxt.replace(/[^\d,.]/g, "").replace(",", ".")) : null;
    const formule = parts.filter((x) => !/€/.test(x)).join(" · ");
    const duree = DUREES[parts[1]] || null;
    const debut = v.heure_souhaitee_h3k9 ? String(v.heure_souhaitee_h3k9).slice(0, 5) : null;
    const notes = [
      "📩 Demande reçue via le site",
      v.type_d_evenement_bzwyq4 && `Type : ${v.type_d_evenement_bzwyq4}`,
      v.personnage_souhaite_u2u8hh && `Personnage souhaité : ${v.personnage_souhaite_u2u8hh}`,
      v.nombre_d_enfants_3fecqa && `Nombre d'enfants : ${v.nombre_d_enfants_3fecqa}`,
      v.option_souhaitee_a9ff && v.option_souhaitee_a9ff !== "Pas d'option" && `Option : ${v.option_souhaitee_a9ff}`,
      v.un_petit_mot_sur_votre_enfant_prenom_age_tt3x8b && `À propos de l'enfant : ${v.un_petit_mot_sur_votre_enfant_prenom_age_tt3x8b}`,
      v.e_mail_05euw2 && `E-mail : ${v.e_mail_05euw2}`,
      v.code_parrain_p7k2 && `Code parrain : ${v.code_parrain_p7k2}`,
    ].filter(Boolean).join("\n");
    const ev = {
      titre: `Demande site – ${perso}${formule ? " – " + formule.split(" · ")[0] : ""}`,
      date: v.date_souhaitee_6yyz11,
      heure_debut: debut,
      heure_fin: debut && duree ? plusMinutes(debut, duree) : null,
      adresse: v.commune_de_la_fete_y94vix || null,
      theme: formule || null,
      parent: v.prenom_et_nom_3ul7zr || null,
      telephone: v.telephone_scnklg || null,
      email: v.e_mail_05euw2 || null,
      statut: "en_attente",
      notes,
      options: perso ? { personnages_client: perso } : null,
      source: "site",
      wix_submission_id: s.id,
    };
    const { data, error } = await sb.from("evenements").insert(ev).select().single();
    if (error) { if (error.code === "23505") continue; throw error; }   // déjà importée
    if (prix) await sb.from("evenements_prive").insert({ id: data.id, prix });
    crees.push(data);
  }
  await sb.from("parametres").upsert({ cle: "import_depuis", valeur: dernier });
  return crees;
}

// ---------- 🎟️ Réservations d'événements depuis le formulaire « Contact » du site (sujet « Bal de Noël »…) ----------
const WIX_FORM_CONTACT_ID = env("WIX_FORM_CONTACT_ID") || "f6b5b9f3-65bb-48e0-9982-ab6ec0549ab0";
const SUJETS_AUTRES = ["question sur une animation", "bon cadeau", "école, crèche ou entreprise", "partenariat ou presse", "autre"];
function lireMessageResa(t) {
  const o: Record<string, unknown> = {}, txt = String(t || "");
  const tel = txt.match(/(?:\+32|0032|0)\s?4\d{2}[\s./-]?\d{2}[\s./-]?\d{2}[\s./-]?\d{2}/); if (tel) o.telephone = tel[0].replace(/\s+/g, " ").trim();
  let places = 0; const rx = /(\d+)\s*(places?|personnes?|pers\b|adultes?|enfants?|ados?)/gi; let m;
  while ((m = rx.exec(txt))) { const apres = txt.slice(m.index + m[0].length, m.index + m[0].length + 22); if (!/^\s*(de\s*)?(moins de|-|<)\s*3\s*ans/i.test(apres)) places += +m[1]; }
  if (places) o.places = places;
  const bb = txt.match(/(\d+)\s*(bébés?|bebes?|bambins?|enfants? de moins de 3)/i) || txt.match(/(\d+)\s*(?:de\s*)?(?:moins de|-)\s*3\s*ans/i); if (bb) o.bebes = +bb[1];
  return o;
}
function reductionResa(r: any, prix: number, places: number) {
  const brut = Math.max(0, prix * places), m = Math.max(0, Number(r.promo_montant) || 0);
  if (!r.code_promo_id || !places || !m) return 0;
  const n = r.promo_type === "par_place" ? m * places : r.promo_type === "total" ? m : r.promo_type === "pourcent" ? brut * m / 100 : 0;
  return Math.round(Math.min(brut, n) * 100) / 100;
}
async function importerResaSite() {
  if (!env("WIX_API_KEY") || !env("WIX_SITE_ID")) return [];
  const { data: p } = await sb.from("parametres").select("valeur").eq("cle", "import_resa_depuis").maybeSingle();
  const depuis = p?.valeur || new Date(Date.now() - 24 * 3600e3).toISOString();
  const r = await fetch("https://www.wixapis.com/form-submission-service/v4/submissions/namespace/query", {
    method: "POST",
    headers: { Authorization: env("WIX_API_KEY"), "wix-site-id": env("WIX_SITE_ID"), "Content-Type": "application/json" },
    body: JSON.stringify({ query: { filter: { namespace: "wix.form_app.form", formId: WIX_FORM_CONTACT_ID }, sort: [{ fieldName: "createdDate", order: "DESC" }], cursorPaging: { limit: 50 } } }),
  });
  if (!r.ok) throw new Error("Wix " + r.status + " : " + (await r.text()));
  const { submissions = [] } = await r.json();
  let dernier = depuis; const crees = [];
  const auj = new Date().toISOString().slice(0, 10);
  const { data: evs } = await sb.from("evenements").select("id,titre,date,type_evenement,statut").eq("type_evenement", "evenement").gte("date", auj).neq("statut", "annule").order("date");
  for (const s of submissions.filter((x) => x.createdDate > depuis).reverse()) {
    if (s.createdDate > dernier) dernier = s.createdDate;
    const v = s.submissions || {}, sujet = String(v.sujet_contact || "").trim();
    if (!sujet || SUJETS_AUTRES.includes(sujet.toLowerCase())) continue;
    // l'événement dont le titre contient le sujet (ex. « Bal de Noël »), hors montage
    const n = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const ev = (evs || []).find((e) => n(e.titre).includes(n(sujet)) && !/montage|repetition|generale/.test(n(e.titre)));
    if (!ev || /nuit\s*magique/.test(n(ev.titre))) continue;
    const msg = String(v.message_contact || ""), lu = lireMessageResa(msg);
    // Champs « nombre » ajoutés au formulaire Wix (clé contenant adulte / enfant / bebe ou 3_ans)
    let ad = 0, enf = 0, bb = 0, champs = false;
    for (const [k, val] of Object.entries(v)) {
      const kk = n(k), x = parseInt(String(val ?? "").replace(/\D/g, ""), 10); if (!Number.isFinite(x)) continue;
      if (/bebe|moins|3_?ans|under/.test(kk)) { bb += x; champs = true; }
      else if (/adulte/.test(kk)) { ad += x; champs = true; }
      else if (/enfant/.test(kk)) { enf += x; champs = true; }
    }
    if (champs) { lu.places = ad + enf; lu.bebes = bb; }
    const detail = champs ? `👨 ${ad} adulte${ad > 1 ? "s" : ""} · 🧒 ${enf} enfant${enf > 1 ? "s" : ""}${bb ? ` · 👶 ${bb} de moins de 3 ans` : ""}\n` : "";
    const tel = Object.entries(v).find(([k]) => /tel|phone|gsm/.test(n(k)))?.[1];
    if (tel && !lu.telephone) lu.telephone = String(tel);
    const o = { evenement_id: ev.id, nom: v.nom_contact || "?", email: v.email_contact || null, telephone: lu.telephone || null, source: "site",
      places: lu.places || 1, bebes: lu.bebes || 0, adultes: champs ? ad : null, enfants: champs ? enf : null, notes: `🌐 Via le site${lu.places ? "" : " (nombre de places à vérifier)"} : ${detail}${msg}`.slice(0, 1500), wix_submission_id: s.id };
    const code = String(v.code_promo_contact || "").trim().toUpperCase();
    if (code) {
      const jour = new Intl.DateTimeFormat("sv-SE", {timeZone:"Europe/Brussels",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(s.createdDate));
      const { data: promo, error: errPromo } = await sb.from("codes_promo").select("id,code_normalise,type_reduction,montant,evenement_id,actif,debut,fin").eq("code_normalise",code).maybeSingle();
      if (errPromo) throw errPromo;
      const valide = !!promo && code.length >= 3 && code.length <= 30 && promo.actif && (!promo.evenement_id || promo.evenement_id===ev.id) && (!promo.debut || promo.debut<=jour) && (!promo.fin || promo.fin>=jour);
      Object.assign(o,{code_promo:code.slice(0,30),promo_demande_le:s.createdDate,...(valide?{code_promo_id:promo.id,promo_type:promo.type_reduction,promo_montant:promo.montant}:{})});
    }
    const { error } = await sb.from("reservations").insert(o);
    if (error) { if (error.code === "23505") continue; throw error; }
    crees.push({ ...o, titre: ev.titre });
  }
  await sb.from("parametres").upsert({ cle: "import_resa_depuis", valeur: dernier });
  return crees;
}

// ---------- 💜 Formulaire Wix « Liste d'attente » : jamais dans reservations ----------
// L'identifiant n'est connu qu'après publication du formulaire Wix. En son
// absence l'import est simplement désactivé ; le formulaire Contact reste intact.
async function importerListeAttente() {
  const formId = env("WIX_FORM_ATTENTE_ID");
  if (!formId || !env("WIX_API_KEY") || !env("WIX_SITE_ID")) return [];
  const { data: param, error: errParam } = await sb.from("parametres")
    .select("valeur").eq("cle", "import_attente_depuis").maybeSingle();
  if (errParam) throw errParam;
  const depuis = param?.valeur || new Date(Date.now() - 24 * 3600e3).toISOString();
  const rep = await fetch("https://www.wixapis.com/form-submission-service/v4/submissions/namespace/query", {
    method: "POST",
    headers: { Authorization: env("WIX_API_KEY"), "wix-site-id": env("WIX_SITE_ID"), "Content-Type": "application/json" },
    body: JSON.stringify({ query: { filter: { namespace: "wix.form_app.form", formId },
      sort: [{ fieldName: "createdDate", order: "DESC" }], cursorPaging: { limit: 50 } } }),
  });
  if (!rep.ok) throw new Error("Wix liste d'attente " + rep.status + " : " + (await rep.text()));
  const { submissions = [] } = await rep.json();
  const auj = new Date().toISOString().slice(0, 10);
  const { data: evs, error: errEvs } = await sb.from("evenements")
    .select("id,titre,theme,theme_app,date,type_evenement,statut").eq("type_evenement", "evenement")
    .gte("date", auj).neq("statut", "annule").order("date");
  if (errEvs) throw errEvs;
  const normaliser = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let dernier = depuis;
  const crees = [];
  for (const s of submissions.filter((x) => x.createdDate > depuis).reverse()) {
    const v = s.submissions || {};
    const sujet = String(v.evenement_attente || "").trim();
    const ev = (evs || []).find((e) => sujet && normaliser(e.titre).includes(normaliser(sujet)) &&
      e.theme_app !== "nuit" &&
      !/montage|repetition|generale|nuit\s*magique/.test(normaliser(`${e.titre} ${e.theme || ""}`)));
    const adultes = Number(v.adultes_attente), enfants = Number(v.enfants_attente), bebes = Number(v.bebes_attente || 0);
    if (!ev || !Number.isInteger(adultes) || adultes < 1 ||
      !Number.isInteger(enfants) || enfants < 0 || !Number.isInteger(bebes) || bebes < 0 ||
      !String(v.nom_attente || "").trim() || !String(v.email_attente || "").trim() ||
      !String(v.telephone_attente || "").trim()) {
      // Ne pas perdre la soumission : l'import suivant pourra réessayer.
      console.warn("Liste d'attente Wix à vérifier", s.id, sujet);
      break;
    }
    const o = { evenement_id: ev.id, evenement_texte: sujet,
      nom: String(v.nom_attente).trim(), email: String(v.email_attente).trim(),
      telephone: String(v.telephone_attente).trim(), adultes, enfants,
      places: adultes + enfants, bebes, notes: String(v.message_attente || "").slice(0, 1500),
      source: "site", wix_submission_id: s.id };
    const { error } = await sb.from("liste_attente").insert(o);
    if (error && error.code !== "23505") throw error;
    if (!error) crees.push({ ...o, titre: ev.titre });
    if (s.createdDate > dernier) dernier = s.createdDate;
  }
  if (dernier !== depuis) {
    const { error } = await sb.from("parametres")
      .upsert({ cle: "import_attente_depuis", valeur: dernier });
    if (error) throw error;
  }
  return crees;
}

// ---------- « Dates prises » sur le site : 🟠 en attente / 🔴 confirmé ----------
async function wix(method, path, body) {
  const r = await fetch("https://www.wixapis.com" + path, {
    method,
    headers: { Authorization: env("WIX_API_KEY"), "wix-site-id": env("WIX_SITE_ID"), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Wix ${method} ${path} ${r.status} : ${await r.text()}`);
  return r.status === 204 ? {} : r.json();
}
async function syncDateSite(d) {
  if (!d || !env("WIX_API_KEY") || !env("WIX_SITE_ID") || d < aujourdhui()) return null;
  const { data: evs } = await sb.from("evenements").select("id,statut,site_affichage").eq("date", d);
  const ids=(evs||[]).filter(e=>e.statut==="en_attente").map(e=>e.id);
  let anticipes = new Set<string>();
  if (ids.length) {
    const {data:suivis,error:errSuivi}=await sb.from("demandes_anticipees")
      .select("evenement_id,statut").in("evenement_id",ids);
    if (!errSuivi) anticipes=new Set((suivis||[]).filter(x=>x.statut!=="cloturee").map(x=>String(x.evenement_id)));
  }
  // Une simple demande d'intérêt ne prend aucune date dans « Dates prises ».
  const visibles = (evs || []).filter((e) => e.statut !== "annule" && e.site_affichage !== "cache" && !anticipes.has(String(e.id)));
  const complet = visibles.some((e) => (e.statut === "confirme" || e.statut === "termine") && e.site_affichage !== "partiel")
    || visibles.some((e) => e.site_affichage === "complet" && e.statut !== "en_attente");
  const { data: lien } = await sb.from("dates_site").select("*").eq("date", d).maybeSingle();
  if (!visibles.length) {
    if (lien) {
      try { await wix("DELETE", `/wix-data/v2/items/${lien.wix_item_id}?dataCollectionId=DatesPrises`); } catch (e) { console.error(e); }
      await sb.from("dates_site").delete().eq("date", d);
    }
    return "libre";
  }
  const data = complet ? { date: d, partiel: false } : { date: d, partiel: true, title: "Selon les personnages choisis" };
  if (lien) {
    await wix("PUT", `/wix-data/v2/items/${lien.wix_item_id}`, { dataCollectionId: "DatesPrises", dataItem: { data } });
    return complet ? "complet" : "partiel";
  }
  // Une date ajoutée à la main sur le site ? On n'y touche pas.
  const ex = await wix("POST", "/wix-data/v2/items/query", { dataCollectionId: "DatesPrises", query: { filter: { date: d }, paging: { limit: 1 } } });
  if ((ex.dataItems || []).length) return "manuel";
  const cree = await wix("POST", "/wix-data/v2/items", { dataCollectionId: "DatesPrises", dataItem: { data } });
  await sb.from("dates_site").insert({ date: d, wix_item_id: cree.dataItem.id });
  return complet ? "complet" : "partiel";
}

// ---------- 📨 Fiche anniversaire envoyée au parent à la confirmation ----------
function jeton() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function assurerFiche(evId) {
  const { data: f } = await sb.from("fiches").select("*").eq("evenement_id", evId).maybeSingle();
  if (f) return f;
  const { data, error } = await sb.from("fiches").insert({ evenement_id: evId, token: jeton() }).select().single();
  if (error) throw error;
  return data;
}
// ---------- 💌 Mails au client : animation (confirmation + acompte → acompte reçu + fiche) ----------
const BANDE = `<div style="height:6px;border-radius:3px;background:linear-gradient(90deg,#00b4ff,#a020ff,#d63fd0,#ff7f7f)"></div>`;
const SIGNATURE = `<p style="font-size:15px">Une question ? Répondez simplement à ce mail, on est là pour vous 💜</p>
    <p style="font-size:15px">Avec toute notre magie ✨<br><b>L'équipe Fantasy Kids Events</b><br><span style="color:#8a80a6;font-size:13px">Là où les rêves d'enfants prennent vie 🏰</span></p>`;
const bonjour = (nom) => `<p style="font-size:16px">Bonjour${nom ? " " + esc(String(nom).replace(/\s*\(.*\)\s*$/, "")) : ""},</p>`;
const boite = (couleur, fond, html) => `<div style="border:2px solid ${couleur};border-radius:14px;padding:12px 16px;margin:14px 0;background:${fond}">${html}</div>`;
function blocVirement(montant, comm, titre) {
  const IBAN = env("IBAN"), BENEF = env("BENEFICIAIRE") || "Fantasy Kids Events";
  return boite("#a020ff", "#f8f2ff", `<p style="font-size:16px;margin:0 0 6px"><b>💳 ${titre} : ${euros0(montant)}</b></p>
    ${IBAN ? `<p style="font-size:15px;margin:0">Par virement sur le compte <b>${esc(IBAN)}</b> (${esc(BENEF)})<br>Communication : <b>${esc(comm)}</b></p>`
           : `<p style="font-size:15px;margin:0">Nous vous envoyons les informations de paiement très vite.</p>`}`);
}
const texteVirement = (montant, comm, titre) => { const IBAN = env("IBAN"), BENEF = env("BENEFICIAIRE") || "Fantasy Kids Events";
  return `💳 ${titre} : ${euros0(montant)}\n${IBAN ? `Virement sur ${IBAN} (${BENEF}) – communication : ${comm}` : "Nous vous envoyons les informations de paiement très vite."}`; };
async function lirePrive(id) {
  let pv = null;
  for (let i = 0; i < 3 && !pv; i++) {
    ({ data: pv } = await sb.from("evenements_prive").select("prix,acompte,acompte_paye,deplacement_client,km_detail,notes_privees").eq("id", id).maybeSingle());
    if (!pv) await new Promise((r) => setTimeout(r, 1500));
  }
  return pv || {};
}
const commAnim = (ev) => `${ev.enfant || String(ev.parent || "").split(" ")[0] || "Anniversaire"} ${String(ev.date || "").split("-").reverse().join("/")}`.trim();
// Le choix commercial vient de la fiche du client, jamais des noms de l'équipe.
const personnagesChoisis = (ev) => String(ev.options?.personnages_client || "").trim();
const recapAnim = (ev) => `<table style="font-size:15px;border-collapse:collapse;margin:8px 0 14px">
      <tr><td style="padding:3px 12px 3px 0;color:#6b6385">📅 Quand</td><td>${esc(quand(ev))}</td></tr>
      ${ev.adresse ? `<tr><td style="padding:3px 12px 3px 0;color:#6b6385">📍 Où</td><td>${esc(ev.adresse)}</td></tr>` : ""}
      ${ev.theme ? `<tr><td style="padding:3px 12px 3px 0;color:#6b6385">✨ Formule</td><td>${esc(ev.theme)}</td></tr>` : ""}
      ${personnagesChoisis(ev) ? `<tr><td style="padding:3px 12px 3px 0;color:#6b6385">🎭 Personnage(s)</td><td><b>${esc(personnagesChoisis(ev))}</b></td></tr>` : ""}
    </table>`;

// 1️⃣ Animation confirmée : demande d'acompte (sans la fiche). Pas d'acompte à payer → on envoie directement la fiche.
async function mailConfirmationAnimation(ev) {
  if (!ev.email) return "pas d'e-mail";
  const pv = await lirePrive(ev.id), acompte = +(pv.acompte || 0), prix = +(pv.prix || 0);
  if (!(acompte > 0) || pv.acompte_paye) return await envoyerFicheParent(ev, true, pv);
  const enfant = ev.enfant ? ` de ${ev.enfant}` : "", comm = commAnim(ev);
  const solde = prix > acompte ? prix - acompte : 0;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1f1735">${BANDE}
    <h2 style="margin:18px 0 6px">✨ Youpi, c'est confirmé !</h2>
    ${bonjour(ev.parent)}
    <p style="font-size:16px">Quelle joie ! Merci de nous confier un moment aussi précieux 💖 Toute l'équipe a déjà hâte de faire briller les yeux${ev.enfant ? ` de <b>${esc(ev.enfant)}</b>` : " des enfants"} et de transformer cet anniversaire en souvenir inoubliable 🎂✨</p>
    ${recapAnim(ev)}
    ${prix ? `<p style="font-size:16px;margin:0 0 4px">💶 <b>Prix total : ${euros0(prix)}</b></p>` : ""}
    ${blocVirement(acompte, comm, "Acompte à verser pour bloquer la date")}
    ${solde ? `<p style="font-size:15px">💰 <b>Solde restant : ${euros0(solde)}</b>, à régler le jour de la fête.</p>` : ""}
    <p style="font-size:15px">Dès réception de l'acompte, la date est <b>officiellement réservée rien que pour vous</b> 🔒 et nous vous envoyons la <b>fiche anniversaire</b> pour connaître tous les petits secrets de la star du jour 🪄</p>
    ${SIGNATURE}</div>`;
  const texte = `Bonjour,\n\nVotre animation est confirmée : ${quand(ev)}${ev.adresse ? " – " + ev.adresse : ""}.\n${ev.theme ? `Formule : ${ev.theme}\n` : ""}${personnagesChoisis(ev) ? `Personnage(s) choisi(s) : ${personnagesChoisis(ev)}\n` : ""}${prix ? `Prix total : ${euros0(prix)}\n` : ""}\n${texteVirement(acompte, comm, "Acompte à verser pour bloquer la date")}\n${solde ? `\nSolde restant : ${euros0(solde)}, à régler le jour de la fête.\n` : ""}\nDès réception de l'acompte, nous vous envoyons la fiche anniversaire à remplir.\n\nÀ très bientôt !\nL'équipe Fantasy Kids Events`;
  await envoyerEmail(ev.email, `✨ Animation confirmée${enfant} – acompte à verser`, html, texte, [], { canal: "client" });
  return "confirmation + acompte envoyés";
}

// 2️⃣ Acompte reçu (ou rien à verser) : merci + solde + fiche anniversaire + invitations
async function envoyerFicheParent(ev, forcer = false, pvDonne = null) {
  const f = await assurerFiche(ev.id);
  if (!forcer && (f.envoyee_le || f.recue_le)) return "déjà envoyée";
  if (!ev.email || !APP_URL) return "pas d'e-mail";
  const lien = `${APP_URL}/fiche.html?t=${f.token}`;
  const enfant = ev.enfant ? ` de ${ev.enfant}` : "";
  const pv = pvDonne || await lirePrive(ev.id), acompte = +(pv.acompte || 0), prix = +(pv.prix || 0);
  const recu = pv.acompte_paye && acompte > 0, solde = prix > (recu ? acompte : 0) ? prix - (recu ? acompte : 0) : 0;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1f1735">${BANDE}
    <h2 style="margin:18px 0 6px">${recu ? "💖 Merci, la magie est en route !" : "✨ Youpi, c'est confirmé !"}</h2>
    ${bonjour(ev.parent)}
    <p style="font-size:16px">${recu ? `Nous avons bien reçu votre acompte de <b>${euros0(acompte)}</b>, merci beaucoup ! 🙏 La date est maintenant <b>officiellement réservée</b> pour l'anniversaire${esc(enfant)} : nos personnages commencent déjà à préparer leurs plus beaux costumes 👑🎂` : `Quelle joie ! Merci de nous confier un moment aussi précieux 💖 Toute l'équipe a déjà hâte de faire briller les yeux${ev.enfant ? ` de <b>${esc(ev.enfant)}</b>` : " des enfants"} 🎂✨`}</p>
    ${recapAnim(ev)}
    ${solde ? boite("#1fa463", "#eefaf3", `<p style="font-size:16px;margin:0">💰 <b>Solde restant : ${euros0(solde)}</b></p><p style="font-size:14px;margin:4px 0 0;color:#3d5a4a">À régler le jour de la fête.</p>`) : ""}
    <p style="font-size:16px">Pour que la fête soit 100 % magique et personnalisée, dites-nous tout sur la star du jour : ses passions, son personnage préféré, les prénoms des copains… 🌟 <b>La petite fiche prend environ 3 minutes.</b></p>
    <p><a href="${lien}" style="display:inline-block;background:linear-gradient(110deg,#00b4ff,#a020ff,#d63fd0);color:#fff;padding:14px 22px;border-radius:12px;text-decoration:none;font-weight:bold;font-size:16px">🪄 Remplir la fiche anniversaire</a></p>
    <p style="color:#6b6385;font-size:13px">Si le bouton ne fonctionne pas, copiez ce lien : ${lien}</p>
    <div style="border-radius:14px;padding:12px 16px;margin:16px 0;background:#fff4fb;border:1px solid #f5c6e6">
      <p style="font-size:16px;margin:0 0 6px"><b>💌 Et pour les invités ?</b></p>
      <p style="font-size:15px;margin:0 0 10px">Créez une jolie invitation féerique aux couleurs de la fête, en quelques clics sur notre site. Les copains vont adorer ! 🎈</p>
      <a href="https://www.fantasykidsevents.be/invitation.html" style="display:inline-block;background:#ff7f9f;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:bold;font-size:15px">🎉 Créer mon invitation</a></div>
    ${SIGNATURE}</div>`;
  const texte = `Bonjour,\n\n${recu ? `Nous avons bien reçu votre acompte de ${euros0(acompte)} : la date est réservée.` : "Votre animation est confirmée."}\n${quand(ev)}${ev.adresse ? " – " + ev.adresse : ""}${ev.theme ? `\nFormule : ${ev.theme}` : ""}${personnagesChoisis(ev) ? `\nPersonnage(s) choisi(s) : ${personnagesChoisis(ev)}` : ""}${solde ? `\nSolde restant : ${euros0(solde)}, à régler le jour de la fête.` : ""}\n\nPour préparer une fête magique, merci de remplir cette petite fiche (3 minutes) :\n${lien}\n\n💌 Créez vos invitations d'anniversaire sur notre site :\nhttps://www.fantasykidsevents.be/invitation.html\n\nÀ très bientôt !\nL'équipe Fantasy Kids Events`;
  await envoyerEmail(ev.email, recu ? `✅ Acompte reçu – la fiche anniversaire${enfant}` : `✨ Préparons l'anniversaire magique${enfant} !`, html, texte, [], { canal: "client" });
  await sb.from("fiches").update({ envoyee_le: new Date().toISOString() }).eq("evenement_id", ev.id);
  return "fiche envoyée";
}

// ---------- 🎟️ Mails au client : réservation d'événement (Bal de Noël…) ----------
async function mailsReservation(type, r, avant) {
  if (!r || !r.email) return "pas d'e-mail";
  const { data: ev } = await sb.from("evenements").select("id,titre,date,heure_debut,adresse,resa_prix").eq("id", r.evenement_id).maybeSingle();
  if (!ev) return "événement introuvable";
  const P = +(ev.resa_prix || 0), places = +r.places || 0, brut = Math.round(P * places * 100) / 100, remise = reductionResa(r,P,places), total = Math.max(0,Math.round((brut-remise)*100)/100), moitie = Math.round(total / 2 * 100) / 100;
  const recu = +r.acompte_recu || 0, recuAvant = +(avant?.acompte_recu || 0);
  const vientConfirmee = !!r.confirmee_le && (type === "INSERT" || !avant?.confirmee_le);
  const acompteOk = brut > 0 && recu >= moitie - 0.005, acompteVientOk = acompteOk && (type === "INSERT" || recuAvant < moitie - 0.005);
  if (!r.confirmee_le || !(vientConfirmee || acompteVientOk)) return "rien à envoyer";
  const comm = `${String(r.nom || "").trim()} ${ev.titre || ""}`.trim().slice(0, 60);
  const bebes = +r.bebes ? ` + ${r.bebes} enfant${r.bebes > 1 ? "s" : ""} de moins de 3 ans (gratuit)` : "";
  const quandEv = (() => { try { const d = new Date(ev.date + "T12:00:00"); return d.toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long" }) + (ev.heure_debut ? " à " + String(ev.heure_debut).slice(0, 5).replace(":", "h") : ""); } catch (_) { return ev.date; } })();
  const recap = `<table style="font-size:15px;border-collapse:collapse;margin:8px 0 14px">
      <tr><td style="padding:3px 12px 3px 0;color:#6b6385">🎉 Événement</td><td><b>${esc(ev.titre)}</b></td></tr>
      <tr><td style="padding:3px 12px 3px 0;color:#6b6385">📅 Quand</td><td>${esc(quandEv)}</td></tr>
      ${ev.adresse ? `<tr><td style="padding:3px 12px 3px 0;color:#6b6385">📍 Où</td><td>${esc(ev.adresse)}</td></tr>` : ""}
      <tr><td style="padding:3px 12px 3px 0;color:#6b6385">🎟️ Places</td><td>${places} place${places > 1 ? "s" : ""}${esc(bebes)}</td></tr>
      ${remise ? `<tr><td>🎟️ Code promo ${esc(r.code_promo)}</td><td>−${euros0(remise)}</td></tr>` : ""}
      ${brut ? `<tr><td style="padding:3px 12px 3px 0;color:#6b6385">💶 Total</td><td>${euros0(total)}${remise?" après réduction":" ("+euros0(P)+" / place)"}</td></tr>` : ""}
    </table>`;
  const solde = Math.max(0, total - recu);
  if (acompteOk) {   // ✅ acompte reçu (avec ou sans confirmation juste avant) → solde en liquide sur place
    const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1f1735">${BANDE}
      <h2 style="margin:18px 0 6px">💖 Merci, vos places sont réservées !</h2>
      ${bonjour(r.nom)}
      <p style="font-size:16px">Nous avons bien reçu votre acompte de <b>${euros0(recu)}</b>, merci beaucoup ! 🙏 Vos places sont désormais <b>bien au chaud</b> pour <b>${esc(ev.titre)}</b>. Préparez vos plus belles tenues, la magie vous attend 🎉✨</p>
      ${recap}
      ${solde ? boite("#1fa463", "#eefaf3", `<p style="font-size:16px;margin:0">💰 <b>Solde à payer sur place : ${euros0(solde)}</b></p><p style="font-size:14px;margin:4px 0 0;color:#3d5a4a">À régler <b>en liquide</b> à l'accueil le jour de l'événement. Pensez à prévoir l'appoint, c'est plus rapide pour tout le monde 😉</p>`) : `<p style="font-size:16px">Tout est réglé, il ne vous reste plus qu'à venir profiter 🙌</p>`}
      <p style="font-size:15px">Nous avons hâte de vous accueillir et de partager ce moment féerique avec vous 🌟</p>
      ${SIGNATURE}</div>`;
    const texte = `Bonjour,\n\nNous avons bien reçu votre acompte de ${euros0(recu)} : vos places pour ${ev.titre} (${quandEv}) sont réservées.\n${places} place(s)${bebes}.\n${solde ? `\nSolde à payer sur place, en liquide : ${euros0(solde)}` : "\nTout est réglé."}\n\nÀ très bientôt !\nL'équipe Fantasy Kids Events`;
    await envoyerEmail(r.email, `✅ ${ev.titre} – acompte reçu, solde ${euros0(solde)} sur place`, html, texte, [], { canal: "client" });
    return "mail acompte reçu";
  }
  // 1️⃣ confirmation + demande d'acompte (50 %)
  const aVerser = Math.max(0, moitie - recu);
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1f1735">${BANDE}
    <h2 style="margin:18px 0 6px">🎟️ Hourra, votre réservation est confirmée !</h2>
    ${bonjour(r.nom)}
    <p style="font-size:16px">Merci beaucoup pour votre réservation 💖 Nous sommes ravis de vous compter parmi nous pour <b>${esc(ev.titre)}</b> ! Toute l'équipe prépare déjà un moment plein de paillettes, de rires et de surprises ✨</p>
    ${recap}
    ${total ? blocVirement(aVerser, comm, "Acompte à verser (50 %)") : ""}
    ${total ? `<p style="font-size:15px">💰 Le <b>solde (${euros0(total - moitie)})</b> sera à payer <b>en liquide sur place</b> le jour de l'événement.</p>` : ""}
    <p style="font-size:15px">Dès réception de l'acompte, vos places sont <b>définitivement réservées</b> et on vous envoie une petite confirmation 💌</p>
    <p style="font-size:14px;color:#6b6385">Bon à savoir : Annulation 7 jours ou plus avant l'événement : l'acompte reste acquis ; moins de 7 jours avant : le solde reste dû.</p>
    ${SIGNATURE}</div>`;
  const texte = `Bonjour,\n\nVotre réservation pour ${ev.titre} (${quandEv}) est confirmée : ${places} place(s)${bebes}.\n${total ? `Total : ${euros0(total)}\n\n${texteVirement(aVerser, comm, "Acompte à verser (50 %)")}\n\nLe solde (${euros0(total - moitie)}) sera à payer en liquide sur place.` : ""}\n\nÀ très bientôt !\nL'équipe Fantasy Kids Events`;
  await envoyerEmail(r.email, `🎟️ ${ev.titre} – réservation confirmée, acompte à verser`, html, texte, [], { canal: "client" });
  return "mail confirmation + acompte";
}

// ---------- 💜 Propositions de la liste d'attente (jetons hachés, décisions serveur) ----------
const ATTENTE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTENTE_LIEN_BASE = APP_URL || "https://fantasykidsevents.github.io/agenda";
async function hashJetonAttente(token: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, "0")).join("");
}
async function responsablesAttente() {
  const { data, error } = await sb.from("equipe").select("email,prenom").eq("responsable", true);
  if (error) throw error;
  return (data || []).filter(m => m.email);
}
async function notifierResponsablesAttente(payload, evId: string, cle?: string) {
  let n = 0;
  for (const m of await responsablesAttente()) {
    // La cloche est créée aussi quand le push est désactivé. La clé prévient
    // les doublons si le même webhook est rejoué.
    const uniqueParMembre = cle ? `${cle}:${String(m.email).trim().toLowerCase()}` : null;
    const { deja } = await garderDansCloche(m.email, payload, "administration", evId, uniqueParMembre);
    if (!deja) n += await envoyerPush(m.email, payload, { categorie: "administration", dejaEnCloche: true });
  }
  return n;
}
async function placesRestantesAttente(evenementId: string) {
  const { data, error } = await sb.rpc("places_evenements_calcul");
  if (error) throw new Error("Calcul des places indisponible (SQL à activer) : " + error.message);
  const ev = (data || []).find(x => String(x.evenement_id) === evenementId);
  return ev ? Number(ev.restantes) : null;
}
async function notifierLiberationAttente(type, apres, avant) {
  if (type !== "UPDATE" && type !== "DELETE") return 0;
  const nombreActif = r => Math.max(0, (Number(r?.places) || 0) -
    (Array.isArray(r?.annulations) ? r.annulations.reduce((s, a) => s + Math.max(0, Number(a?.n) || 0), 0) : 0));
  const evenementId = String(avant?.evenement_id || apres?.evenement_id || "");
  if (!ATTENTE_ID.test(evenementId) || !avant || !Object.hasOwn(avant, "places")) return 0;
  const avantN = nombreActif(avant), apresN = type === "DELETE" ? 0 : nombreActif(apres);
  if (avantN <= apresN) return 0;
  const restantes = await placesRestantesAttente(evenementId);
  if (!(restantes > 0)) return 0;
  const { count, error } = await sb.from("liste_attente")
    .select("id", { count: "exact", head: true }).eq("evenement_id", evenementId).eq("statut", "en_attente");
  if (error) throw error;
  if (!count) return 0;
  const { data: ev, error: errEv } = await sb.from("evenements")
    .select("titre").eq("id", evenementId).maybeSingle();
  if (errEv) throw errEv;
  const titre = ev?.titre || "cet événement";
  const payload = { title: `🎟️ ${restantes} place(s) libérée(s) pour ${titre}`,
    body: `${count} personne(s) en liste d'attente – choisissez à qui proposer les places.`,
    url: `./index.html?ev=${encodeURIComponent(evenementId)}`, tag: `attente-liberee-${evenementId}` };
  // Le contenu précédent du webhook fait partie de la clé : une retransmission
  // n'envoie pas plusieurs avis, un autre changement de capacité en envoie un.
  const cle = `attente-liberee:${evenementId}:${avant?.id}:${type}:${avantN}:${apresN}:${String(apres?.updated_at || avant?.updated_at || "")}`;
  return await notifierResponsablesAttente(payload, evenementId, cle);
}
async function responsableDepuisRequete(req: Request) {
  const bearer = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return false;
  const { data: identite, error } = await sb.auth.getUser(bearer);
  if (error || !identite?.user?.email) return false;
  const { data: membres, error: errMembres } = await sb.from("equipe")
    .select("id").ilike("email", identite.user.email).eq("responsable", true).limit(1);
  if (errMembres) throw errMembres;
  return !!membres?.length;
}
async function attenteActionResponsable(req: Request, p: any) {
  if (!(await responsableDepuisRequete(req))) return json({ ok: false, erreur: "Réservé aux responsables" }, 403);
  const id = String(p.attenteId || "");
  if (!ATTENTE_ID.test(id)) return json({ ok: false, erreur: "Identifiant invalide" }, 400);
  const { data: a, error: errAttente } = await sb.from("liste_attente").select("*").eq("id", id).maybeSingle();
  if (errAttente) throw errAttente;
  if (!a) return json({ ok: false, erreur: "Demande introuvable" }, 404);

  if (p.type === "ATTENTE_RETIRER" || p.type === "ATTENTE_EXPIRER") {
    const statut = p.type === "ATTENTE_EXPIRER" ? "expiree" : "annulee";
    const permis = p.type === "ATTENTE_EXPIRER" ? ["proposee"] : ["en_attente", "proposee"];
    if (!permis.includes(a.statut)) return json({ ok: false, erreur: "Cette demande ne peut plus être modifiée." }, 409);
    const { data, error } = await sb.from("liste_attente").update({ statut, jeton_hash: null,
      proposition_expire_le: null, reponse_le: new Date().toISOString() })
      .eq("id", id).in("statut", permis).select("id").maybeSingle();
    if (error) throw error;
    return data ? json({ ok: true }) : json({ ok: false, erreur: "La demande a changé. Actualisez." }, 409);
  }
  if (p.type !== "ATTENTE_PROPOSER") return json({ ok: false, erreur: "Action inconnue" }, 400);
  if (a.statut !== "en_attente" || !a.email || !Number.isInteger(Number(a.places)) || Number(a.places) < 1)
    return json({ ok: false, erreur: "Cette demande ne peut pas recevoir de proposition." }, 409);
  const restantes = await placesRestantesAttente(String(a.evenement_id));
  if (restantes === null || restantes < Number(a.places))
    return json({ ok: false, erreur: `Pas assez de places : ${restantes ?? "aucune"} disponible(s) pour ${a.places} demandée(s).` }, 409);
  const { data: ev, error: errEv } = await sb.from("evenements")
    .select("titre,date").eq("id", a.evenement_id).maybeSingle();
  if (errEv) throw errEv;
  if (!ev) return json({ ok: false, erreur: "Événement introuvable" }, 404);
  const token = jeton(), hash = await hashJetonAttente(token), maintenant = new Date();
  const expireLe = new Date(maintenant.getTime() + 48 * 3600e3).toISOString();
  const { data: mise, error: errMise } = await sb.from("liste_attente")
    .update({ statut: "proposee", proposee_le: maintenant.toISOString(), proposition_expire_le: expireLe, jeton_hash: hash })
    .eq("id", id).eq("statut", "en_attente").select("id").maybeSingle();
  if (errMise) throw errMise;
  if (!mise) return json({ ok: false, erreur: "Cette demande a déjà été traitée." }, 409);
  const lien = `${ATTENTE_LIEN_BASE}/attente.html?t=${encodeURIComponent(token)}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1f1735">${BANDE}
    <h2>💜 Des places se sont libérées !</h2><p>Bonjour ${esc(a.nom)},</p>
    <p>Nous pouvons vous proposer <b>${a.places} place(s)</b> pour <b>${esc(ev.titre)}</b>.</p>
    <p>Souhaitez-vous confirmer votre réservation ? Vous avez <b>48 heures</b> pour répondre ;
    cette proposition ne constitue pas encore une réservation confirmée.</p>
    <p><a href="${lien}" style="display:inline-block;background:#793bd3;color:white;padding:14px 20px;border-radius:10px;text-decoration:none">🎟️ Je confirme</a></p>
    <p>Si vous ne souhaitez plus venir, vous pouvez simplement ne pas répondre.</p>${SIGNATURE}</div>`;
  try {
    await envoyerEmail(a.email, `💜 Des places pour ${ev.titre} – réponse sous 48 h`, html,
      `Bonjour ${a.nom},\n\n${a.places} place(s) se sont libérées pour ${ev.titre}.\nPour confirmer sous 48 heures : ${lien}\n\nCe n'est pas encore une réservation confirmée.\n\nFantasy Kids Events`, [], { canal: "client" });
  } catch (err) {
    // Le mail n'est pas parti : la demande redevient sélectionnable. Ne jamais
    // laisser un jeton valide associé à une proposition non envoyée.
    await sb.from("liste_attente").update({ statut: "en_attente", proposee_le: null,
      proposition_expire_le: null, jeton_hash: null }).eq("id", id).eq("statut", "proposee").eq("jeton_hash", hash);
    return json({ ok: false, erreur: "Mail non envoyé : " + String(err?.message || err) }, 503);
  }
  return json({ ok: true, expireLe });
}
async function attenteConfirmer(p: any) {
  const token = String(p.token || "");
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return json({ ok: false, erreur: "Lien de confirmation invalide." }, 400);
  const hash = await hashJetonAttente(token);
  const { data, error } = await sb.rpc("confirmer_liste_attente", { p_jeton_hash: hash });
  if (error) { console.error("Confirmation liste d'attente", error); return json({ ok: false, erreur: "Confirmation temporairement indisponible." }, 503); }
  const etat = data?.etat;
  if (etat === "insuffisant") {
    try {
      const { data: a } = await sb.from("liste_attente").select("id,nom,places,evenement_id")
        .eq("jeton_hash", hash).maybeSingle();
      if (a) {
        const { data: ev } = await sb.from("evenements").select("titre").eq("id", a.evenement_id).maybeSingle();
        await notifierResponsablesAttente({ title: "⚠️ Liste d'attente : plus assez de places",
          body: `${a.nom} · ${a.places} place(s) – ${ev?.titre || "événement"} : confirmation bloquée.`,
          url: `./index.html?ev=${a.evenement_id}`, tag: `attente-capacite-${a.id}` },
          String(a.evenement_id), `attente-capacite:${a.id}`);
      }
    } catch (e) { console.error("Alerte capacité liste d'attente", e); }
    return json({ ok: false, erreur: "Les dernières places ont été prises entre-temps. Notre équipe a été prévenue ; contactez Fantasy Kids Events." }, 409);
  }
  if (etat === "expiree") return json({ ok: false, erreur: "Cette proposition a expiré. Contactez Fantasy Kids Events." }, 410);
  if (etat !== "confirmee" && etat !== "deja_confirmee") return json({ ok: false, erreur: "Ce lien n'est plus valable." }, 410);
  if (etat === "confirmee") {
    try {
      const payload = { title: "💜 Liste d'attente confirmée", body: `${data.nom} · ${data.places} place(s) – ${data.titre}`,
        url: `./index.html?ev=${data.evenement_id}`, tag: `attente-confirmee-${data.reservation_id}` };
      await notifierResponsablesAttente(payload, String(data.evenement_id), `attente-confirmee:${data.reservation_id}`);
    } catch (e) { console.error("Alerte confirmation attente", e); }
    // La création de la réservation avec confirmee_le déclenche le webhook
    // reservations habituel, donc mailsReservation (confirmation + acompte).
  }
  return json({ ok: true, dejaConfirmee: etat === "deja_confirmee" });
}
async function attenteEtat(p: any) {
  const token = String(p.token || "");
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return json({ ok: false, erreur: "Lien invalide" }, 400);
  const { data: a, error } = await sb.from("liste_attente")
    .select("evenement_id,nom,places,statut,proposition_expire_le")
    .eq("jeton_hash", await hashJetonAttente(token)).maybeSingle();
  if (error) throw error;
  if (!a) return json({ ok: false, erreur: "Lien introuvable" }, 404);
  const { data: ev } = await sb.from("evenements").select("titre,date").eq("id", a.evenement_id).maybeSingle();
  return json({ ok: true, statut: a.statut === "proposee" &&
    (!a.proposition_expire_le || a.proposition_expire_le <= new Date().toISOString()) ? "expiree" : a.statut,
    nom: a.nom, places: a.places, titre: ev?.titre || "votre événement", date: ev?.date,
    expireLe: a.proposition_expire_le });
}
async function expirerPropositionsAttente() {
  const { data, error } = await sb.from("liste_attente")
    .update({ statut: "expiree", reponse_le: new Date().toISOString(), jeton_hash: null })
    .eq("statut", "proposee").lt("proposition_expire_le", new Date().toISOString())
    .select("id");
  if (error) throw error;
  return data?.length || 0;
}

// ---------- 📨 Devis au client (à accepter en ligne) ----------
const OPTIONS_PRIX = { hors_zone: ["🚗 Forfait hors zone", 25], enfant: ["👧 Enfant supplémentaire", 7], tatouage: ["🦋 Atelier tatouage paillettes (payé le jour même)", 2],
  perso_flash: ["🎭 Personnage supplémentaire · Flash (30 min)", 40], perso_magic: ["🎭 Personnage supplémentaire · Magic (1 h)", 65],
  perso_fantastic: ["🎭 Personnage supplémentaire · Fantastic (1 h 30)", 80], perso_celebration: ["🎭 Personnage supplémentaire · Célébration (2 h)", 90],
  mascotte: ["🐭 Mascotte surprise (30 min)", 100], perso_30: ["🎤 Personnage supplémentaire · 30 min", 40], perso_1h: ["🎤 Personnage supplémentaire · 1 h", 45] };
async function envoyerDevis(ev, { relance = false } = {}) {
  if (!ev.email || !APP_URL) return "pas d'e-mail";
  let { data: d } = await sb.from("devis").select("*").eq("evenement_id", ev.id).maybeSingle();
  if (!d) { const r = await sb.from("devis").insert({ evenement_id: ev.id, token: jeton() }).select().single(); if (r.error) throw r.error; d = r.data; }
  if (!("reponse_client" in d) || !("relance_nombre" in d))
    return "Activer d'abord le script SQL de suivi des devis dans Supabase";
  if (["confirme", "termine", "annule"].includes(ev.statut) || d.accepte_le)
    return "la prestation n'attend plus de devis";
  if (relance && (d.reponse_client || !d.envoye_le)) return "ce devis n'est pas en attente de réponse";
  const pv = await lirePrive(ev.id), prix = +(pv.prix || 0), acompte = +(pv.acompte || 0);
  const optionsFacturees = Object.entries(ev.options || {}).reduce((t,[k,n]) => t + (k === "tatouage" ? 0 : (OPTIONS_PRIX[k]?.[1] || 0) * (+n || 0)),0);
  const kmInclus = pv.km_detail?.fraisInclusPrix === true || (pv.km_detail?.fraisInclusPrix == null && String(pv.notes_privees || "").includes("Déplacement client : "));
  const deplacement = kmInclus ? Math.max(0, +(pv.deplacement_client || 0)) : 0;
  const formule = Math.max(0,Math.round((prix-optionsFacturees-deplacement)*100)/100);
  const lien = `${APP_URL}/devis.html?t=${d.token}`, enfant = ev.enfant ? ` de ${ev.enfant}` : "";
  const lignesOpt = Object.entries(ev.options || {}).filter(([, n]) => +n > 0).map(([k, n]) => { const o = OPTIONS_PRIX[k]; return o ? `<tr><td style="padding:3px 0">${esc(o[0])}${+n > 1 ? ` × ${n}` : ""}</td><td style="text-align:right;padding:3px 0">${k === "tatouage" ? `${euros0(o[1])} / enfant` : euros0(o[1] * n)}</td></tr>` : ""; }).join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1f1735">${BANDE}
    <h2 style="margin:18px 0 6px">${relance ? "💌 Petit rappel concernant votre devis" : "📜 Votre devis magique est prêt !"}</h2>
    ${bonjour(ev.parent)}
    <p style="font-size:16px">${relance ? "Nous nous permettons de revenir vers vous car nous n'avons pas encore reçu votre réponse à notre devis 💜 Il vous suffit de choisir l'option qui vous convient, même si vous ne souhaitez plus réserver." : `Merci pour votre demande 💖 Voici le détail de l'animation que nous avons préparée${ev.enfant ? ` pour <b>${esc(ev.enfant)}</b>` : ""}. Prenez le temps de tout regarder ✨`}</p>
    ${recapAnim(ev)}
    <table style="width:100%;font-size:15px;border-collapse:collapse;background:#f8f2ff;border-radius:12px;padding:10px">
      <tr><td style="padding:3px 0">✨ ${esc(ev.theme || "Animation")} · formule</td><td style="text-align:right;padding:3px 0">${euros0(formule)}</td></tr>${lignesOpt}
      ${deplacement ? `<tr><td style="padding:3px 0">🚗 Frais de déplacement</td><td style="text-align:right;padding:3px 0">${euros0(deplacement)}</td></tr>` : ""}
      ${prix ? `<tr><td style="padding:8px 0 3px;border-top:1px solid #dcc6ff"><b>Total</b></td><td style="text-align:right;padding:8px 0 3px;border-top:1px solid #dcc6ff"><b>${euros0(prix)}</b></td></tr>` : ""}
      ${acompte ? `<tr><td style="padding:3px 0;color:#6b6385">dont acompte à la réservation</td><td style="text-align:right;color:#6b6385">${euros0(acompte)}</td></tr>` : ""}
    </table>
    <p style="font-size:16px;margin-top:16px">Vous pouvez nous répondre en quelques clics 👇</p>
    <p><a href="${lien}" style="display:inline-block;background:linear-gradient(110deg,#00b4ff,#a020ff,#d63fd0);color:#fff;padding:14px 22px;border-radius:12px;text-decoration:none;font-weight:bold;font-size:16px">📜 Consulter et répondre à mon devis</a></p>
    <p style="font-size:14px;color:#6b6385">Vous pouvez <b>accepter</b>, <b>refuser</b> ou <b>demander une modification</b> directement sur cette page. Dès votre accord, nous vous envoyons les infos pour l'acompte afin de bloquer la date 🔒</p>
    ${SIGNATURE}</div>`;
  const detailTexte = [`Formule ${ev.theme || "Animation"} : ${euros0(formule)}`, ...(personnagesChoisis(ev) ? [`Personnage(s) choisi(s) : ${personnagesChoisis(ev)}`] : []), ...Object.entries(ev.options || {}).filter(([k,n]) => +n>0 && OPTIONS_PRIX[k]).map(([k,n]) => `${OPTIONS_PRIX[k][0]}${+n>1 ? " × "+n : ""} : ${k === "tatouage" ? euros0(OPTIONS_PRIX[k][1])+" / enfant (payé sur place)" : euros0(OPTIONS_PRIX[k][1]*n)}`), ...(deplacement ? [`Frais de déplacement : ${euros0(deplacement)}`] : [])].join("\n");
  const introTexte = relance ? `Petit rappel : nous n'avons pas encore reçu de réponse à votre devis pour l'animation${enfant} prévue ${quand(ev)}.`
    : `Voici votre devis pour l'animation${enfant} : ${quand(ev)}.`;
  const texte = `Bonjour,\n\n${introTexte}\n\n${detailTexte}\nTotal : ${euros0(prix)}${acompte ? `\nAcompte : ${euros0(acompte)}` : ""}\n\nPour l'accepter, le refuser ou demander une modification :\n${lien}\n\nÀ très bientôt !\nL'équipe Fantasy Kids Events`;
  await envoyerEmail(ev.email, `${relance ? "💌 Rappel de votre devis" : "📜 Votre devis Fantasy Kids Events"}${enfant}`, html, texte, [],
    { canal: "client" });
  const horodatage = new Date().toISOString();
  const changements: Record<string, unknown> = { envoye_le: horodatage };
  if (relance) {
    changements.relance_le = horodatage;
    changements.relance_nombre = (Number(d.relance_nombre) || 0) + 1;
  } else {
    // Une nouvelle proposition rouvre le devis et réinitialise la réponse précédente.
    Object.assign(changements, { reponse_client: null, reponse_motif: null, reponse_message: null,
      reponse_le: null, reponse_push_le: null, relance_le: null, relance_nombre: 0 });
  }
  const { error: errMaj } = await sb.from("devis").update(changements).eq("evenement_id", ev.id);
  if (errMaj) throw errMaj;
  const {error:errJournal} = await sb.from("devis_suivi_actions").insert({
    evenement_id: ev.id, action: relance ? "relance" : "envoi",
    detail: `Envoyé à ${ev.email}`,
  });
  if (errJournal) console.error("Historique devis", errJournal.message);
  if (!relance) await classerRappels(ev.id, "devis");
  return "devis envoyé";
}

// Un rappel dans la cloche à J+3 puis à J+5 après le dernier envoi / la dernière relance.
// Aucune annulation automatique et aucun mail supplémentaire au client.
async function rappelsDevisClients(equipe) {
  const {data:devis,error} = await sb.from("devis")
    .select("evenement_id,envoye_le,accepte_le,reponse_client,relance_le")
    .not("envoye_le","is",null).is("accepte_le",null).is("reponse_client",null)
    .order("envoye_le",{ascending:false}).limit(1000);
  if (error) { console.error("Rappels devis (migration nécessaire)",error.message); return []; }
  if (!devis?.length) return [];
  const {data:evenements,error:errEv} = await sb.from("evenements")
    .select("id,date,statut,titre,enfant,parent")
    .in("id",devis.map(d=>d.evenement_id));
  if (errEv) throw errEv;
  const evMap=new Map((evenements||[]).map(e=>[String(e.id),e]));
  const responsables=(equipe||[]).filter(m=>m.responsable&&m.email);
  const cibles=responsables.some(m=>norm(m.prenom)==="jordan")
    ? responsables.filter(m=>norm(m.prenom)==="jordan") : responsables;
  const notifications=[];
  for (const d of devis) {
    const ev=evMap.get(String(d.evenement_id));
    if(!ev||ev.statut!=="en_attente"||ev.date<aujourdhui())continue;
    const dernier=d.relance_le||d.envoye_le,jours=Math.floor((Date.now()-new Date(dernier).getTime())/86400000);
    if(jours<3)continue;
    const etape=jours>=5?5:3;
    const titre=etape===5?"⏰ Devis sans réponse depuis 5 jours":"⏰ Devis à suivre depuis 3 jours";
    const nom=ev.parent||"Le client",presta=ev.titre||ev.enfant||"Animation";
    for(const m of cibles){
      const cle=`devis-rappel-${etape}-${d.evenement_id}-${dernier.replace(/[^0-9]/g,"").slice(0,14)}-${m.email}`;
      const payload={title:titre,body:`${nom} · ${presta}\n${quand(ev)}\nLa réponse du client manque toujours. Tu peux le relancer dans Gestion > Devis clients.`,url:`./index.html?ev=${ev.id}`,tag:`devis-rappel-${ev.id}`};
      const garde=await garderDansCloche(m.email,payload,"devis",ev.id,cle);
      if(garde.deja)continue;
      const pushs=await envoyerPush(m.email,payload,{categorie:"administration",dejaEnCloche:true});
      notifications.push({devis:d.evenement_id,etape,pushs});
    }
  }
  return notifications;
}

// ---------- 📸 Après l'animation : photos + avis Google + diplôme au client ----------
const AVIS_GOOGLE = "https://g.page/r/CQ9trKQST6xJECE/review";
const DIPLOME_URL = "https://www.fantasykidsevents.be/diplome.html";
async function envoyerPhotosClient(ev) {
  if (!ev.email || !ev.photos_lien) return "pas d'e-mail ou de lien";
  const enfant = ev.enfant ? esc(ev.enfant) : "";
  const btn = (href, txt, bg) => `<p style="margin:10px 0"><a href="${href}" style="display:inline-block;background:${bg};color:#fff;padding:14px 22px;border-radius:12px;text-decoration:none;font-weight:bold;font-size:16px">${txt}</a></p>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1f1735">
    <div style="height:6px;border-radius:3px;background:linear-gradient(90deg,#00b4ff,#a020ff,#d63fd0,#ff7f7f)"></div>
    <h2 style="margin:18px 0 6px">📸 Les photos de la fête sont prêtes !</h2>
    <p style="font-size:16px">Bonjour${ev.parent ? " " + esc(String(ev.parent).replace(/\s*\(.*\)\s*$/, "")) : ""},</p>
    <p style="font-size:16px">Merci encore de nous avoir ouvert les portes de votre fête${enfant ? ` pour l'anniversaire de <b>${enfant}</b>` : ""} 💖 C'était un vrai bonheur de partager ces rires et ces étoiles dans les yeux ! Voici les souvenirs de ce moment magique 📸✨</p>
    ${btn(esc(ev.photos_lien), "📸 Voir les photos", "linear-gradient(110deg,#00b4ff,#a020ff,#d63fd0)")}
    <div style="border-radius:14px;padding:12px 16px;margin:16px 0;background:#fffbea;border:1px solid #f3df8a">
      <p style="font-size:16px;margin:0 0 6px"><b>⭐ Vous avez aimé ?</b></p>
      <p style="font-size:15px;margin:0 0 4px">Votre avis est notre plus belle récompense 🌟 Il aide d'autres familles à nous découvrir et fait sourire toute l'équipe. Cela prend 1 petite minute 💛</p>
      ${btn(AVIS_GOOGLE, "⭐ Laisser un avis Google", "#f4b400")}</div>
    <div style="border-radius:14px;padding:12px 16px;margin:16px 0;background:#f8f2ff;border:1px solid #dcc6ff">
      <p style="font-size:16px;margin:0 0 6px"><b>🎓 Le diplôme${enfant ? ` de ${enfant}` : ""}</b></p>
      <p style="font-size:15px;margin:0 0 4px">Créez et imprimez un joli diplôme souvenir à accrocher dans sa chambre : un petit morceau de magie à garder pour toujours 🏅</p>
      ${btn(DIPLOME_URL, "🎓 Créer le diplôme", "#a020ff")}</div>
    <p style="font-size:15px">Au plaisir de vous retrouver pour de nouvelles aventures enchantées ✨<br><b>L'équipe Fantasy Kids Events</b><br><span style="color:#8a80a6;font-size:13px">Là où les rêves d'enfants prennent vie 🏰</span></p></div>`;
  const texte = `Bonjour,\n\nMerci encore de nous avoir invités ! Voici les photos de la fête :\n${ev.photos_lien}\n\n⭐ Vous avez aimé ? Laissez-nous un avis Google (1 minute) :\n${AVIS_GOOGLE}\n\n🎓 Créez le diplôme souvenir :\n${DIPLOME_URL}\n\nÀ très bientôt !\nL'équipe Fantasy Kids Events`;
  await envoyerEmail(ev.email, `📸 Les photos de la fête${ev.enfant ? " de " + ev.enfant : ""} ✨`, html, texte, [], { canal: "client" });
  return "envoyé";
}

// ---------- 🌧️ Météo ----------
function maintenantBxl() { return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Brussels" })); }
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
async function geocoder(adresse) {
  const m = String(adresse || "").match(/(\d{4})\s+([A-Za-zÀ-ÿ' -]+)/);
  const nom = m ? m[2].trim() : String(adresse || "").split(",").pop().trim();
  if (!nom) return null;
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(nom)}&count=5&language=fr&countryCode=BE`);
  const j = await r.json();
  let g = (j.results || [])[0];
  if (!g) { const r2 = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(nom)}&count=1&language=fr`); g = ((await r2.json()).results || [])[0]; }
  return g ? { lat: g.latitude, lon: g.longitude, nom: g.name } : null;
}
async function meteoDuJour(adresse, date) {
  const g = await geocoder(adresse); if (!g) return null;
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&daily=precipitation_probability_max,precipitation_sum,temperature_2m_max,wind_speed_10m_max&timezone=Europe%2FBrussels&start_date=${date}&end_date=${date}`);
  const d = (await r.json()).daily; if (!d) return null;
  return { lieu: g.nom, pluie: d.precipitation_probability_max?.[0], mm: d.precipitation_sum?.[0], temp: d.temperature_2m_max?.[0], vent: d.wind_speed_10m_max?.[0] };
}
// 👗 Costumes & perruques
//  - chaque matin (dès 9h), tant qu'une pièce nécessaire dans les 7 jours n'est pas prête :
//    rappel aux responsables (et à la personne qui a la pièce perso)
//  - la veille (dès 17h) : pièce à récupérer chez quelqu'un (cas rare)
const ETAT_TXT = { laver: "🧺 à laver", reparer: "🪡 à réparer", coiffer: "💇 à recoiffer" };
const isoJ = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const VOEUX = [
  "🎂 Joyeux anniversaire {p} ! ✨ Toute l'équipe Fantasy te souhaite une journée magique 🎉",
];
async function anniversairesEquipe() {
  const bxl = maintenantBxl();
  if (bxl.getHours() < 8) return;
  const auj = isoJ(bxl), cle = `anniv_${auj}`;
  const { data: deja } = await sb.from("parametres").select("cle").eq("cle", cle).maybeSingle();
  if (deja) return;
  await sb.from("parametres").upsert({ cle, valeur: new Date().toISOString() });
  const md = auj.slice(5);
  // Anniversaires déclarés volontairement par les membres dans leur profil.
  // Ne jamais publier les anciennes dates saisies par un admin dans « naissances » :
  // aucun accord de diffusion n'y est associé.
  const [{ data: preferences, error: erreurPrefs }, { data: equipe, error: erreurEquipe }] = await Promise.all([
    sb.from("preferences_notifications").select("email,choix"),
    sb.from("equipe").select("prenom,email"),
  ]);
  if (erreurPrefs || erreurEquipe) {
    console.error("Anniversaires : lecture des accords impossible", erreurPrefs || erreurEquipe);
  }
  const prenomParEmail = new Map((equipe || []).filter(x => x.email && x.prenom)
    .map(x => [String(x.email).trim().toLowerCase(), x.prenom]));
  const fetes = (preferences || []).filter(x => {
    const anniversaire = x.choix?.anniversaire;
    return anniversaire?.partager === true && /^\d{4}-\d{2}-\d{2}$/.test(anniversaire.date || "") &&
      anniversaire.date.slice(5) === md && prenomParEmail.has(String(x.email || "").trim().toLowerCase());
  }).map(x => ({ prenom: prenomParEmail.get(String(x.email).trim().toLowerCase()) }));
  // 🎨 Jour de spectacle / d'événement à thème -> message de fête dans le salon
  const { data: duJour } = await sb.from("evenements").select("titre,theme,theme_app,type_evenement,message_jour").eq("date", auj).neq("statut", "annule");
  const MSG = {
    nuit: (l) => `🌙✨ Aujourd'hui, c'est le grand jour : La Nuit Magique${l ? " à " + l : ""} !\nMerde à toute la troupe 🎭 On va faire briller les étoiles ⭐`,
    noel: (t) => `🎄✨ C'est le jour de la magie de Noël${t ? " : " + t : ""} !\nJoyeux Noël à toute l'équipe 🎅❄️`,
    halloween: (t) => `🎃👻 Aujourd'hui, c'est la nuit des monstres${t ? " : " + t : ""} !\nBouh ! Bon Halloween à toute l'équipe 🦇`,
    kpop: (t) => `🎤💜 Aujourd'hui, c'est le jour de la scène${t ? " : " + t : ""} !\nFighting à toute l'équipe ✨🎶`,
    glace: (t) => `❄️✨ Aujourd'hui, la magie des glaces est de retour${t ? " : " + t : ""} !\nUne journée glacialement magique à toute l'équipe ❄️`,
    paques: (t) => `🐣🌸 Aujourd'hui, c'est la chasse aux œufs${t ? " : " + t : ""} !\nJoyeuses Pâques à toute l'équipe 🐰`,
  };
  const themeDe = (e) => {
    const c = e.theme_app || "auto"; if (c === "aucun") return null; if (MSG[c]) return c;
    const t = `${e.titre || ""} ${e.theme || ""}`;
    if (/nuit magique/i.test(t) && /spectacle/i.test(e.titre || "")) return "nuit";
    if (e.type_evenement !== "evenement") return null;
    if (/halloween/i.test(t)) return "halloween";
    if (/k.?pop|huntrix|idol party|superstar experience/i.test(t)) return "kpop";
    if (/reine des neiges|frozen|royaume des glaces/i.test(t)) return "glace";
    if (/no[eë]l|saint.?nicolas|march[ée] de no|christmas/i.test(t)) return "noel";
    if (/p[aâ]ques|chasse aux (œ|oe)ufs/i.test(t)) return "paques";
    if (/nuit magique/i.test(t)) return "nuit";
    return null;
  };
  const faits = new Set();
  for (const e of duJour || []) {
    const k = themeDe(e); if (!k || faits.has(k)) continue; faits.add(k);
    const extra = k === "nuit" ? ((e.titre || "").match(/spectacle\s+(.+)$/i) || [])[1] : e.titre;
    await sb.from("messages").insert({ canal: "equipe", auteur: "Fantasy ✨", auteur_email: "fantasy@app.local", texte: MSG[k](extra) + (e.message_jour ? "\n\n" + e.message_jour : "") });
  }
  for (const x of fetes) {
    const texte = VOEUX[Math.floor(Math.random() * VOEUX.length)].replace("{p}", x.prenom);
    await sb.from("messages").insert({ canal: "equipe", auteur: "Fantasy ✨", auteur_email: "fantasy@app.local", texte });
  }
}

const TABLES_SAUVEGARDE = ["equipe", "evenements", "evenements_prive", "paies", "fiches", "indispos", "costumes", "bilans", "depenses", "naissances", "reglages", "dates_site", "messages", "pointages", "pins", "stock", "guide_fiches", "reservations", "caisse_produits", "ventes"];
async function toutLire(table) {
  const out = []; for (let i = 0; ; i += 1000) {
    const { data, error } = await sb.from(table).select("*").range(i, i + 999);
    if (error) return { erreur: error.message };
    out.push(...(data || [])); if (!data || data.length < 1000) return out;
  }
}
async function sauvegardeHebdo(equipe) {
  const { data: rg } = await sb.from("reglages").select("cle,valeur").in("cle", ["sauvegarde_jour", "sauvegarde_email", "compta_email"]);
  const R = Object.fromEntries((rg || []).map((x) => [x.cle, x.valeur]));
  const jour = R.sauvegarde_jour ?? "1";   // 1 = lundi … 7 = dimanche ; vide = désactivé
  if (!/^[1-7]$/.test(jour)) return [];
  const bxl = maintenantBxl(); if (((bxl.getDay() + 6) % 7) + 1 !== +jour || bxl.getHours() < 7) return [];
  const auj = isoJ(bxl), cle = `sauvegarde_${auj}`;
  const { data: deja } = await sb.from("parametres").select("cle").eq("cle", cle).maybeSingle();
  if (deja) return [];
  await sb.from("parametres").upsert({ cle, valeur: new Date().toISOString() });
  const donnees = { app: "Fantasy Kids Events", version: 1, date: new Date().toISOString(), tables: {} };
  const compte = [];
  for (const t of TABLES_SAUVEGARDE) { const l = await toutLire(t); donnees.tables[t] = l; compte.push(`${t} : ${Array.isArray(l) ? l.length : "erreur"}`); }
  const json = new TextEncoder().encode(JSON.stringify(donnees));
  // version compressée (.json.gz) si possible
  let pj = { filename: `fantasy-sauvegarde-${auj}.json`, content: json };
  try {
    const gz = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    pj = { filename: `fantasy-sauvegarde-${auj}.json.gz`, content: gz };
  } catch (_) { /* on garde le .json */ }
  const html = `<h2>💾 Sauvegarde Fantasy du ${auj.split("-").reverse().join("/")}</h2>
    <p>Voici la copie complète de l'app (animations, clients, équipe, paie, dépenses, costumes, fiches, réglages…).</p>
    <p>👉 Gardez simplement cet e-mail. En cas de problème, ce fichier permet de tout remettre comme avant.</p>
    <p style="color:#666;font-size:13px">${compte.join(" · ")}</p>
    <p style="color:#888">Les photos (tickets, chat) restent dans le stockage Supabase ; les tickets arrivent aussi chaque mois avec la compta.</p>`;
  const dest = (R.sauvegarde_email || R.compta_email || "").split(/[,;\s]+/).filter((x) => x.includes("@"));
  const a = dest.length ? dest : (equipe || []).filter((m) => m.responsable && m.email).map((m) => m.email);
  for (const to of a) await envoyerEmail(to, `💾 Sauvegarde Fantasy – ${auj.split("-").reverse().join("/")}`, html, "Sauvegarde Fantasy en pièce jointe.", [pj]);
  return [{ sauvegarde: auj, a, taille: pj.content.length }];
}

async function comptaDuMois(equipe) {
  const { data: rg } = await sb.from("reglages").select("cle,valeur").in("cle", ["compta_email", "compta_actif", "tatouage_prix"]);
  const R = Object.fromEntries((rg || []).map((x) => [x.cle, x.valeur]));
  if (R.compta_actif === "0") return [];
  const bxl = maintenantBxl(); if (bxl.getDate() !== 1 || bxl.getHours() < 8) return [];
  const prec = new Date(bxl.getFullYear(), bxl.getMonth() - 1, 1);
  const ym = `${prec.getFullYear()}-${String(prec.getMonth() + 1).padStart(2, "0")}`, cle = `compta_${ym}`;
  const { data: deja } = await sb.from("parametres").select("cle").eq("cle", cle).maybeSingle();
  if (deja) return [];
  await sb.from("parametres").upsert({ cle, valeur: new Date().toISOString() });
  const debut = `${ym}-01`, fin = isoJ(new Date(prec.getFullYear(), prec.getMonth() + 1, 0));
  const { data: evs } = await sb.from("evenements").select("*").gte("date", debut).lte("date", fin).neq("statut", "annule").order("date").order("heure_debut");
  const E = evs || [], ids = E.map((e) => e.id);
  const { data: pv } = ids.length ? await sb.from("evenements_prive").select("*").in("id", ids) : { data: [] };
  const { data: pa } = ids.length ? await sb.from("paies").select("*").in("evenement_id", ids) : { data: [] };
  const { data: dep } = await sb.from("depenses").select("*").gte("date", debut).lte("date", fin).order("date");
  const P = new Map((pv || []).map((x) => [x.id, x])), tat = +(R.tatouage_prix || 2);
  const n = (x) => (x == null || x === "" ? "" : String(Math.round(+x * 100) / 100).replace(".", ","));
  const q = (x) => `"${String(x ?? "").replace(/"/g, '""').replace(/\n/g, " ")}"`;
  const dfr = (d) => d.split("-").reverse().join("/");
  const CATS = { materiel: "Matériel d'animation", maquillage: "Maquillage & paillettes", costumes: "Costumes & perruques", deplacement: "Carburant & parking", pub: "Pub & site", cadeaux: "Cadeaux & goodies", autre: "Autre" };
  // 💼 Comptes Fantasy (sans la Nuit Magique) + 🌙 Nuit Magique : uniquement les déplacements de l'équipe
  const estNM = (e) => /nuit\s*magique/i.test(`${e?.titre || ""} ${e?.theme || ""}`) || e?.theme_app === "nuit";
  const caisseDep = (_d) => "fantasy";
  const partie = (cx) => {
    const EE = E.filter((e) => (estNM(e) ? "nuit" : "fantasy") === cx), DD = (dep || []).filter((d) => caisseDep(d) === cx);
    const PA = (pa || []).filter((x) => EE.some((e) => e.id === x.evenement_id));
    const L = [q(cx === "nuit" ? "LA NUIT MAGIQUE" : "FANTASY KIDS EVENTS"), "", q(cx === "nuit" ? "JOURS (spectacles, répétitions…)" : "ANIMATIONS"), ["Date", "Titre", "Client", "Formule", "Statut", "Prix", "Acompte", "Acompte payé", "Solde", "Suppléments", "Encaissé jour J", "Mode", "Paie équipe", "Reste"].map(q).join(";")];
    const T = { prix: 0, sup: 0, enc: 0, paie: 0 };
    for (const e of EE) {
      const p = P.get(e.id) || {}, sup = (+e.tatouages_nb || 0) * tat + (+e.supplement || 0);
      const paie = PA.filter((x) => x.evenement_id === e.id).reduce((t, x) => t + (+x.deplacement || 0) + (+x.prestation || 0), 0);
      const enc = e.solde_encaisse && e.solde_encaisse !== "non" ? (+e.solde || 0) + sup : 0;
      T.prix += +p.prix || 0; T.sup += sup; T.enc += enc; T.paie += paie;
      L.push([q(dfr(e.date)), q(e.titre || e.enfant || ""), q(e.parent || ""), q(e.theme || ""), q(e.statut), n(p.prix), n(p.acompte), q(p.acompte_paye ? "oui" : (p.acompte ? "non" : "")),
        n(e.solde), n(sup || ""), n(enc || ""), q({ cash: "Liquide", virement: "Virement", payconiq: "Payconiq", non: "Non payé" }[e.solde_encaisse] || ""), n(paie || ""), n((+p.prix || 0) + sup - paie)].join(";"));
    }
    L.push("", q("PAIE DE L'ÉQUIPE"), ["Date", "Titre", "Prénom", "Déplacement (km + parking)", "Prestation", "Total", "Payé"].map(q).join(";"));
    for (const x of PA) { const e = EE.find((y) => y.id === x.evenement_id);
      L.push([q(e ? dfr(e.date) : ""), q(e?.titre || ""), q(x.prenom), n(x.deplacement), n(x.prestation), n((+x.deplacement || 0) + (+x.prestation || 0)), q(x.paye ? "oui" : "non")].join(";")); }
    let TD = 0;
    L.push("", q("DÉPENSES / ACHATS"), ["Date", "Catégorie", "Magasin", "Montant", "Ticket"].map(q).join(";"));
    for (const d of DD) { TD += +d.montant; L.push([q(dfr(d.date)), q(CATS[d.categorie] || "Autre"), q(d.description || ""), n(d.montant), q(d.ticket ? "oui (joint)" : "NON")].join(";")); }
    L.push("", q("RÉSUMÉ"), [q("Chiffre d'affaires (prix + suppléments)"), n(T.prix + T.sup)].join(";"), [q("Encaissé le jour J"), n(T.enc)].join(";"),
      [q("Paie de l'équipe"), n(T.paie)].join(";"), [q("Dépenses"), n(TD)].join(";"), [q("Bénéfice"), n(T.prix + T.sup - T.paie - TD)].join(";"));
    return { L, T, TD, nb: EE.length, DD };
  };
  const F = partie("fantasy");
  const EN = E.filter(estNM), PN = (pa || []).filter((x) => +x.deplacement && EN.some((e) => e.id === x.evenement_id));
  const LN = [q("LA NUIT MAGIQUE – DÉPLACEMENTS DE L'ÉQUIPE (km + parking)"), ["Date", "Jour", "Prénom", "Déplacement", "Payé"].map(q).join(";")];
  let TN = 0, TNdu = 0;
  for (const x of PN) { const e = EN.find((y) => y.id === x.evenement_id); TN += +x.deplacement; if (!x.paye) TNdu += +x.deplacement;
    LN.push([q(e ? dfr(e.date) : ""), q(e?.titre || ""), q(x.prenom), n(x.deplacement), q(x.paye ? "oui" : "non")].join(";")); }
  LN.push("", [q("Total"), "", "", n(TN)].join(";"), [q("Reste à rembourser"), "", "", n(TNdu)].join(";"));
  const nomMois = prec.toLocaleDateString("fr-BE", { month: "long", year: "numeric" });
  const pj = [{ filename: `fantasy-compta-${ym}.csv`, content: new TextEncoder().encode("\ufeff" + F.L.join("\r\n")) }];
  if (PN.length) pj.push({ filename: `nuit-magique-deplacements-${ym}.csv`, content: new TextEncoder().encode("\ufeff" + LN.join("\r\n")) });
  // 🛒 Caisse des événements : à part des rentrées (fichier séparé)
  const { data: vt } = await sb.from("ventes").select("*").gte("created_at", `${debut}T00:00:00`).lte("created_at", `${fin}T23:59:59`).eq("annulee", false).order("created_at");
  const VT = vt || [];
  const { data: evV } = VT.length ? await sb.from("evenements").select("id,titre,date").in("id", [...new Set(VT.map((v) => v.evenement_id))]) : { data: [] };
  const titreV = (id) => (evV || []).find((e) => e.id === id)?.titre || "";
  let TC = 0, TCcash = 0;
  if (VT.length) {
    const LC = [q("CAISSE DES ÉVÉNEMENTS (à part des rentrées)"), ["Date", "Heure", "Événement", "Ticket", "Articles", "Mode", "Total"].map(q).join(";")];
    for (const v of VT) { TC += +v.total; if (v.mode === "cash") TCcash += +v.total; const d = new Date(v.created_at);
      LC.push([q(dfr(v.created_at.slice(0, 10))), q(d.toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" })), q(titreV(v.evenement_id)), String(v.numero || ""),
        q((v.lignes || []).map((l) => `${l.qte} x ${l.nom}`).join(", ")), q(v.mode === "cash" ? "Cash" : "SumUp"), n(v.total)].join(";")); }
    const parP: Record<string, { q: number; t: number }> = {}; VT.forEach((v) => (v.lignes || []).forEach((l) => { parP[l.nom] = parP[l.nom] || { q: 0, t: 0 }; parP[l.nom].q += l.qte; parP[l.nom].t += l.qte * l.prix; }));
    LC.push("", q("PAR PRODUIT"), ["Produit", "Quantité", "Total"].map(q).join(";"), ...Object.entries(parP).map(([k, x]) => [q(k), String(x.q), n(x.t)].join(";")));
    LC.push("", [q("Total cash"), n(TCcash)].join(";"), [q("Total SumUp"), n(TC - TCcash)].join(";"), [q("Total caisse"), n(TC)].join(";"));
    pj.push({ filename: `caisse-evenements-${ym}.csv`, content: new TextEncoder().encode("\ufeff" + LC.join("\r\n")) });
  }
  const nbCsv = pj.length;
  // tickets : joints tant que le total reste sous ~18 Mo, sinon lien valable 7 jours
  let taille = 0; const liens = [], vus = new Set();
  for (const d of dep || []) {
    if (!d.ticket || vus.has(d.ticket)) continue; vus.add(d.ticket);
    const nomF = `ticket-${d.date}-${(d.description || CATS[d.categorie] || "achat").replace(/[^\w-]+/g, "_").slice(0, 30)}.${d.ticket.split(".").pop()}`;
    try {
      const { data: f } = await sb.storage.from("tickets").download(d.ticket);
      const b = f ? new Uint8Array(await f.arrayBuffer()) : null;
      if (b && taille + b.length < 18e6) { taille += b.length; pj.push({ filename: nomF, content: b }); continue; }
    } catch (_) { /* on passera par un lien */ }
    const { data: u } = await sb.storage.from("tickets").createSignedUrl(d.ticket, 7 * 86400);
    if (u?.signedUrl) liens.push(`<li><a href="${u.signedUrl}">${nomF}</a></li>`);
  }
  const euro = (x) => `${n(x) || "0"} €`;
  const html = `<h2>📤 Compta Fantasy – ${nomMois}</h2>
    <h3>💼 Fantasy Kids Events</h3>
    <p>${F.nb} animation${F.nb > 1 ? "s" : ""} · CA <b>${euro(F.T.prix + F.T.sup)}</b> · paie ${euro(F.T.paie)} · dépenses ${euro(F.TD)} · <b>bénéfice ${euro(F.T.prix + F.T.sup - F.T.paie - F.TD)}</b></p>
    <h3>🛒 Caisse des événements (à part)</h3>
    <p>${VT.length ? `${VT.length} vente${VT.length > 1 ? "s" : ""} · <b>${euro(TC)}</b> (cash ${euro(TCcash)} · SumUp ${euro(TC - TCcash)})` : "Aucune vente ce mois-ci."}</p>
    <h3>🌙 La Nuit Magique – déplacements de l'équipe</h3>
    <p>${PN.length ? `Total <b>${euro(TN)}</b> · reste à rembourser <b>${euro(TNdu)}</b>` : "Aucun déplacement ce mois-ci."}</p>
    <p>En pièces jointes : le fichier Excel (CSV) Fantasy${nbCsv > 1 ? ", plus " + (nbCsv - 1) + " fichier" + (nbCsv > 2 ? "s" : "") + " à part (caisse des événements / déplacements Nuit Magique)" : ""}${pj.length > nbCsv ? ` + ${pj.length - nbCsv} ticket${pj.length - nbCsv > 1 ? "s" : ""}` : ""}.</p>
    ${liens.length ? `<p>Autres tickets (liens valables 7 jours) :</p><ul>${liens.join("")}</ul>` : ""}
    <p style="color:#888">Envoyé automatiquement par l'app Fantasy ✨</p>`;
  const dest = (R.compta_email || "").split(/[,;\s]+/).filter((x) => x.includes("@"));
  const a = dest.length ? dest : (equipe || []).filter((m) => m.responsable && m.email).map((m) => m.email);
  for (const to of a) await envoyerEmail(to, `📤 Compta Fantasy – ${nomMois}`, html, `Compta Fantasy ${nomMois} : voir pièces jointes.`, pj);
  return [{ compta: ym, a, pj: pj.length }];
}

async function resumeMatin(equipe) {
  const { data: r } = await sb.from("reglages").select("valeur").eq("cle", "resume_heure").maybeSingle();
  const h = parseInt(r?.valeur ?? "8", 10); if (Number.isNaN(h)) return;
  const bxl = maintenantBxl(); if (bxl.getHours() < h) return;
  const auj = isoJ(bxl), cle = `resume_${auj}`;
  const { data: deja } = await sb.from("parametres").select("cle").eq("cle", cle).maybeSingle();
  if (deja) return;
  await sb.from("parametres").upsert({ cle, valeur: new Date().toISOString() });
  const j = (n) => isoJ(new Date(bxl.getFullYear(), bxl.getMonth(), bxl.getDate() + n));
  const { data: evs } = await sb.from("evenements").select("*").gte("date", j(-14)).lte("date", j(30)).neq("statut", "annule").order("date").order("heure_debut");
  const E = evs || [];
  const ids = E.map((e) => e.id);
  const { data: pv } = ids.length ? await sb.from("evenements_prive").select("id,acompte,acompte_paye").in("id", ids) : { data: [] };
  const { data: fi } = ids.length ? await sb.from("fiches").select("evenement_id,recue_le").in("evenement_id", ids) : { data: [] };
  const { data: co } = await sb.from("costumes").select("etat");
  const { data: stk } = await sb.from("stock").select("nom,etat");
  const P = new Map((pv || []).map((x) => [x.id, x])), F = new Map((fi || []).map((x) => [x.evenement_id, x]));
  const client = (e) => e.type_evenement === "animation" && !/nuit magique/i.test(`${e.theme || ""} ${e.titre || ""}`) && !!(e.parent || e.telephone || e.email || e.enfant);
  const duJour = E.filter((e) => e.date === auj);
  const lignes = [];
  if (duJour.length) lignes.push(`🪄 Aujourd'hui : ${duJour.map((e) => `${e.heure_debut ? e.heure_debut.slice(0, 5).replace(":", "h") + " " : ""}${e.titre || "animation"}`).join(" · ")}`);
  else lignes.push("🌙 Pas d'animation aujourd'hui");
  const attente = E.filter((e) => e.statut === "en_attente" && e.date >= auj).length;
  if (attente) lignes.push(`⏳ ${attente} demande${attente > 1 ? "s" : ""} en attente`);
  const acomptes = E.filter((e) => e.statut === "confirme" && e.date >= auj && e.date <= j(10) && +(P.get(e.id)?.acompte || 0) > 0 && !P.get(e.id)?.acompte_paye).length;
  if (acomptes) lignes.push(`💰 ${acomptes} acompte${acomptes > 1 ? "s" : ""} à relancer`);
  const fiches = E.filter((e) => e.statut === "confirme" && e.date >= auj && e.date <= j(14) && client(e) && !F.get(e.id)?.recue_le).length;
  if (fiches) lignes.push(`📝 ${fiches} fiche${fiches > 1 ? "s" : ""} anniversaire pas reçue${fiches > 1 ? "s" : ""}`);
  const nonPaye = E.filter((e) => e.solde_encaisse === "non").length;
  if (nonPaye) lignes.push(`⚠️ ${nonPaye} solde${nonPaye > 1 ? "s" : ""} non payé${nonPaye > 1 ? "s" : ""}`);
  const mat = E.filter((e) => (e.materiel_manquant || "").trim()).length;
  if (mat) lignes.push(`🎒 Matériel manquant signalé (${mat})`);
  const cos = (co || []).filter((c) => c.etat && c.etat !== "ok").length;
  if (cos) lignes.push(`👗 ${cos} costume${cos > 1 ? "s" : ""}/perruque${cos > 1 ? "s" : ""} à laver, recoiffer ou réparer`);
  const hier = E.filter((e) => e.date === j(-1) && e.type_evenement === "evenement" && !/nuit magique|montage|r[ée]p[ée]tition|g[ée]n[ée]rale/i.test(`${e.titre || ""} ${e.theme || ""}`));
  hier.forEach((e) => lignes.push(`📊 Bilan de « ${e.titre} » prêt dans l'app (événement → 📊 Bilan)`));
  const aRacheter = (stk || []).filter((x) => x.etat && x.etat !== "ok");
  if (aRacheter.length) lignes.push(`🛒 À racheter : ${aRacheter.slice(0, 4).map((x) => x.nom).join(", ")}${aRacheter.length > 4 ? "…" : ""}`);
  const photos = E.filter((e) => e.date < auj && !e.photos_envoyees && e.type_evenement === "animation" && !/nuit magique/i.test(e.titre || "")).length;
  if (photos) lignes.push(`📸 ${photos} envoi${photos > 1 ? "s" : ""} de photos en retard`);
  if (lignes.length === 1) lignes.push("✨ Rien d'urgent, belle journée !");
  for (const m of (equipe || []).filter((x) => x.responsable))
    await envoyerPush(m.email, { title: `☀️ Bonjour ${m.prenom} !`, body: lignes.join("\n"), url: "./index.html?vue=list", tag: "resume-matin" });
}

// 📩 Les demandes d'animation peuvent être « vues » sans être confirmées.
// Dès le lendemain, rappel quotidien à Jordan tant que la fiche est en attente.
// Les rappels restent des notifications : ils ne modifient jamais le statut.
async function relancerDemandesAnimation(equipe) {
  const belge = maintenantBxl();
  if (belge.getHours() < 9) return [];
  const aujourd = isoJ(belge);
  const destinataires = (equipe || []).filter(m => m.responsable && m.email && norm(m.prenom) === "jordan");
  if (!destinataires.length) return [];
  const { data: enAttente, error } = await sb.from("evenements").select("*")
    .eq("statut", "en_attente").gte("date", aujourd);
  if (error) throw error;
  const demandes = (enAttente || []).filter(ev =>
    ev.type_evenement === "animation"
    && (ev.source === "site" || ev.parent || ev.email || ev.telephone));
  if (!demandes.length) return [];

  // Le parcours anticipé possède son propre calendrier de rappels. Ne pas
  // envoyer les anciennes relances quotidiennes avant l'ouverture à 3 mois.
  const { data: suiviAnticipe, error: erreurSuivi } = await sb.from("demandes_anticipees")
    .select("evenement_id,statut").in("evenement_id", demandes.map(e => e.id));
  if (erreurSuivi) {
    // Avant installation du SQL, l'ancien comportement doit rester inchangé.
    if (erreurSuivi.code !== "42P01" && erreurSuivi.code !== "PGRST205") console.error("Suivi anticipé", erreurSuivi.message);
  }
  const anticipationsEnAttente = new Set((suiviAnticipe || [])
    .filter(d => !["reconfirmee", "a_traiter"].includes(d.statut)).map(d => String(d.evenement_id)));
  const demandesActives = demandes.filter(ev => !anticipationsEnAttente.has(String(ev.id)));
  if (!demandesActives.length) return [];

  // La notification initiale permet de ne pas relancer une nouvelle demande
  // quelques minutes après sa réception (et sans ajouter de colonne SQL).
  const ids = demandesActives.map(ev => String(ev.id));
  const { data: precedentes, error: errPrecedentes } = await sb.from("notifications_app")
    .select("evenement_id,cree_le").eq("type", "demande")
    .in("evenement_id", ids).order("cree_le", { ascending: true }).limit(5000);
  if (errPrecedentes) throw errPrecedentes;
  const premieres = new Map();
  for (const n of precedentes || []) {
    const id = String(n.evenement_id);
    if (!premieres.has(id) && n.cree_le) premieres.set(id, n.cree_le);
  }

  const resultats = [];
  for (const ev of demandesActives) {
    const cree = ev.created_at || ev.cree_le || premieres.get(String(ev.id));
    if (cree && Date.now() - new Date(cree).getTime() < 24 * 60 * 60_000) continue;
    for (const m of destinataires) {
      const email = String(m.email).trim().toLowerCase();
      const payload = {
        title: "⏳ Demande d'animation toujours en attente",
        body: `${ev.parent || "Un client"} · ${ev.titre || "Animation"}\n${quand(ev)}\nOuvre la fiche pour prendre une décision.`,
        url: `./index.html?ev=${ev.id}`,
        tag: `rappel-demande-${ev.id}`,
      };
      // Même si RAPPELS se lance toutes les 5 minutes, un seul rappel par jour.
      const cle = `relance-demande-${ev.id}-${aujourd}-${email}`;
      const mise = await garderDansCloche(email, payload, "demande", ev.id, cle);
      if (mise.deja) continue;

      // Remplacer l'ancien avis par celui d'aujourd'hui dans la cloche.
      const { error: errAnciennes } = await sb.from("notifications_app")
        .update({ lue_le: new Date().toISOString() })
        .eq("destinataire_email", email).eq("evenement_id", String(ev.id))
        .eq("type", "demande").is("lue_le", null)
        .lt("cree_le", new Date(Date.now() - 60_000).toISOString());
      if (errAnciennes) console.error("Anciens avis de demande", errAnciennes.message);

      const pushs = await envoyerPush(email, payload, {
        categorie: "administration", dejaEnCloche: true,
      });
      resultats.push({ demande: ev.id, email, pushs });
    }
  }
  return resultats;
}

async function rappelChecklist(equipe) {
  const { data: r } = await sb.from("reglages").select("valeur").eq("cle", "checklist_heure").maybeSingle();
  const h = parseInt(r?.valeur ?? "18", 10); if (Number.isNaN(h)) return;
  const bxl = maintenantBxl(); if (bxl.getHours() < h) return;
  const auj = isoJ(bxl), cle = `checklist_${auj}`;
  const { data: deja } = await sb.from("parametres").select("cle").eq("cle", cle).maybeSingle();
  if (deja) return;
  const demain = isoJ(new Date(bxl.getFullYear(), bxl.getMonth(), bxl.getDate() + 1));
  const { data: evs } = await sb.from("evenements").select("titre,heure_debut").eq("date", demain).neq("statut", "annule").order("heure_debut");
  await sb.from("parametres").upsert({ cle, valeur: new Date().toISOString() });
  if (!evs || !evs.length) return;
  const corps = evs.map((e) => `• ${e.heure_debut ? e.heure_debut.slice(0, 5).replace(":", "h") + " " : ""}${e.titre || "Animation"}`).join("\n");
  for (const m of (equipe || []).filter((x) => x.responsable))
    await envoyerPush(m.email, { title: `📋 Check-list pour demain (${evs.length})`, body: corps + "\nTouchez pour tout vérifier ✨", url: "./index.html?checklist=1", tag: "checklist" });
}

async function menagePhotos() {
  const auj = isoJ(maintenantBxl()), cle = `menage_photos_${auj}`;
  const { data: deja } = await sb.from("parametres").select("cle").eq("cle", cle).maybeSingle();
  if (deja) return;
  await sb.from("parametres").upsert({ cle, valeur: new Date().toISOString() });
  const { data: noms, error } = await sb.rpc("photos_chat_anciennes");
  if (error) throw error;
  const liste = (noms || []).map((x) => typeof x === "string" ? x : x.photos_chat_anciennes).filter(Boolean);
  if (liste.length) await sb.storage.from("chat").remove(liste);
  const limite = new Date(Date.now() - 183 * 864e5).toISOString();
  await sb.from("messages").update({ photo_url: null }).lt("created_at", limite).not("photo_url", "is", null);

  // Chats d'animation : effacés 1 mois après l'animation (messages + photos)
  const { data: msgs } = await sb.from("messages").select("id,evenement_id,photo_url").like("canal", "ev:%").limit(5000);
  if (!msgs || !msgs.length) return;
  const ids = [...new Set(msgs.map((m) => m.evenement_id).filter(Boolean))];
  const { data: evs } = await sb.from("evenements").select("id,date").in("id", ids);
  const d = maintenantBxl(), mois = isoJ(new Date(d.getFullYear(), d.getMonth() - 1, d.getDate()));
  const vieux = new Set((evs || []).filter((e) => e.date < mois).map((e) => e.id));
  const aEffacer = msgs.filter((m) => vieux.has(m.evenement_id));
  if (!aEffacer.length) return;
  const chemins = aEffacer.map((m) => (m.photo_url || "").split("/object/public/chat/")[1]).filter(Boolean).map(decodeURIComponent);
  for (let i = 0; i < chemins.length; i += 500) await sb.storage.from("chat").remove(chemins.slice(i, i + 500));
  for (let i = 0; i < aEffacer.length; i += 500) await sb.from("messages").delete().in("id", aEffacer.slice(i, i + 500).map((m) => m.id));
}

async function rappelsCostumes(equipe) {
  const bxl = maintenantBxl(), out = [];
  const { data: rj } = await sb.from("reglages").select("valeur").eq("cle", "costumes_jours").maybeSingle();
  const nbJ = Math.max(0, parseInt(rj?.valeur ?? "7", 10) || 0);
  const auj = isoJ(bxl), j7 = isoJ(new Date(bxl.getFullYear(), bxl.getMonth(), bxl.getDate() + nbJ));
  const demain = isoJ(new Date(bxl.getFullYear(), bxl.getMonth(), bxl.getDate() + 1));
  const parNom = new Map((equipe || []).map((m) => [norm(m.prenom), m]));
  const resp = (equipe || []).filter((m) => m.responsable);
  let C = null, A = null;
  const charger = async () => {
    if (C !== null && A !== null) return;
    const [cost, assign] = await Promise.all([
      sb.from("costumes").select("*"), sb.from("costume_attributions").select("*"),
    ]);
    C = cost.data || []; A = assign.data || [];
  };
  const pieceDeLaPrestation = (ev, a, type) => {
    const attribution = (A || []).find((x) => String(x.evenement_id) === String(ev.id)
      && norm(x.membre) === norm(a.nom) && norm(x.personnage) === norm(a.role) && x.type === type);
    // Aucune attribution ? Ne pas deviner une robe parmi plusieurs versions Elsa.
    return attribution?.costume_id ? (C || []).find((x) => String(x.id) === String(attribution.costume_id)) || null : null;
  };

  // 1) Rappel quotidien : pas prêt dans les 7 jours
  const cle = `costumes_rappel_${auj}`;
  const { data: deja } = await sb.from("parametres").select("cle").eq("cle", cle).maybeSingle();
  if (nbJ > 0 && bxl.getHours() >= 9 && !deja) {
    await sb.from("parametres").upsert({ cle, valeur: new Date().toISOString() });
    const { data: evs } = await sb.from("evenements").select("*").gte("date", auj).lte("date", j7).neq("statut", "annule").order("date");
    await charger();
    const soucis = new Map();   // id pièce -> { c, quand }
    for (const ev of (evs || []).filter(e=>e.type_evenement!=="repetition")) for (const a of equipeDe(ev)) {
      if (!a.role || norm(a.role) === "acc") continue;
      for (const type of ["costume", "perruque"]) {
        const c = pieceDeLaPrestation(ev, a, type);
        if (c && c.etat && c.etat !== "ok" && !soucis.has(c.id)) soucis.set(c.id, { c, ev });
      }
    }
    if (soucis.size) {
      const jours = (d) => { const n = Math.round((Date.parse(d) - Date.parse(auj)) / 864e5); return n === 0 ? "aujourd'hui" : n === 1 ? "demain" : `dans ${n} jours`; };
      const ligne = ({ c, ev }) => `${c.nom || c.personnage} : ${ETAT_TXT[c.etat] || c.etat}${c.probleme ? " – " + c.probleme : ""} (${jours(ev.date)})`;
      const tout = [...soucis.values()];
      for (const m of resp) out.push(await envoyerPush(m.email, {
        title: `👗 ${tout.length} pièce${tout.length > 1 ? "s" : ""} à préparer`,
        body: tout.map(ligne).join("\n"), url: "./index.html?costumes=1", tag: "costumes-a-preparer",
      }));
      // pièce perso pas prête -> rappel à son propriétaire aussi
      for (const x of tout) if (x.c.proprietaire) {
        const m = parNom.get(norm(x.c.proprietaire));
        if (m && !m.responsable) out.push(await envoyerPush(m.email, { title: "👗 Ta pièce perso à préparer", body: ligne(x), url: "./index.html?costumes=1", tag: `costume-perso-${x.c.id}` }));
      }
    }
  }

  // 2) La veille : à récupérer chez quelqu'un
  if (bxl.getHours() >= 17) {
    const { data: evs } = await sb.from("evenements").select("*").eq("date", demain).neq("statut", "annule").is("costume_rappel", null);
    for (const ev of (evs || []).filter(e=>e.type_evenement!=="repetition")) {
      const { data: pris } = await sb.from("evenements").update({ costume_rappel: new Date().toISOString() })
        .eq("id", ev.id).is("costume_rappel", null).select("id");
      if (!pris || !pris.length) continue;
      await charger();
      for (const a of equipeDe(ev)) {
        if (!a.role || norm(a.role) === "acc") continue;
        for (const type of ["costume", "perruque"]) {
          const c = pieceDeLaPrestation(ev, a, type);
          if (!c || c.proprietaire || c.chez === "stock" || norm(c.chez) === norm(a.nom)) continue;
          const moi = parNom.get(norm(a.nom));
          if (moi) out.push(await envoyerPush(moi.email, { title: "👗 À récupérer", body: `${c.nom || a.role} est chez ${c.chez}\n${titreDe(ev)} · demain`, url: "./index.html?costumes=1", tag: `costume-${ev.id}-${a.nom}-${type}` }));
        }
      }
    }
  }
  return out;
}

async function alertesMeteo(equipe) {
  const now = maintenantBxl(); if (now.getHours() < 9) return [];
  const j2 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2), d2 = isoLocal(j2);
  const { data: evs } = await sb.from("evenements").select("*").eq("date", d2).neq("statut", "annule").is("meteo_alerte", null);
  const out = [];
  for (const ev of evs || []) {
    const { data: f } = await sb.from("fiches").select("reponses").eq("evenement_id", ev.id).maybeSingle();
    const exterieur = /ext[ée]rieur|jardin/i.test(f?.reponses?.lieu || "") || /ext[ée]rieur|jardin|plein air/i.test(ev.notes || "");
    await sb.from("evenements").update({ meteo_alerte: new Date().toISOString() }).eq("id", ev.id);
    if (!exterieur || !ev.adresse) continue;
    const m = await meteoDuJour(ev.adresse, d2); if (!m) continue;
    if ((m.pluie ?? 0) < 50 && (m.mm ?? 0) < 2) continue;
    ev.__meteo = `${m.lieu} : ${m.pluie ?? "?"} % de risque de pluie (${m.mm ?? 0} mm), ${Math.round(m.temp ?? 0)} °C, vent ${Math.round(m.vent ?? 0)} km/h`;
    for (const mb of equipe || []) if (mb.responsable) out.push(await prevenir(mb.email, mb.prenom, "meteo", ev, ""));
  }
  return out;
}

// ---------- 📅 Récap du lundi ----------
async function recapLundi(equipe) {
  const now = maintenantBxl();
  if (now.getDay() !== 1 || now.getHours() < 8) return null;
  const cle = "recap_" + isoLocal(now);
  const { data: deja } = await sb.from("parametres").select("cle").eq("cle", cle).maybeSingle();
  if (deja) return null;
  await sb.from("parametres").upsert({ cle, valeur: new Date().toISOString() });
  const t = isoLocal(now), fin = isoLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  const d14 = isoLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14));
  const moinsMois = isoLocal(new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()));
  const { data: evs } = await sb.from("evenements").select("*").neq("statut", "annule").gte("date", moinsMois).lte("date", d14).order("date").order("heure_debut");
  const { data: prives } = await sb.from("evenements_prive").select("*");
  const { data: fiches } = await sb.from("fiches").select("evenement_id,recue_le");
  const P = new Map((prives || []).map((x) => [x.id, x])), F = new Map((fiches || []).map((x) => [x.evenement_id, x]));
  const client = (e) => e.type_evenement === "animation" && (e.parent || e.telephone || e.email || e.enfant || P.get(e.id)?.prix) && !/nuit magique/i.test(e.theme || "");
  const semaine = (evs || []).filter((e) => e.date >= t && e.date <= fin);
  const fichesManq = (evs || []).filter((e) => e.date >= t && e.date <= d14 && e.statut === "confirme" && client(e) && !F.get(e.id)?.recue_le);
  const acomptes = (evs || []).filter((e) => e.date >= t && e.date <= d14 && e.statut === "confirme" && +P.get(e.id)?.acompte && !P.get(e.id)?.acompte_paye);
  const manque = (evs || []).filter((e) => (e.materiel_manquant || "").trim());
  const soldes = (evs || []).filter((e) => e.date < t && e.solde && (!e.solde_encaisse || e.solde_encaisse === "non"));
  const attente = (evs || []).filter((e) => e.date >= t && e.statut === "en_attente");
  const j = (e) => `${e.date.split("-").reverse().slice(0, 2).join("/")}${e.heure_debut ? " " + e.heure_debut.slice(0, 5).replace(":", "h") : ""}`;
  const bloc = (titre, liste, f) => liste.length ? `<h3 style="margin:18px 0 6px">${titre} (${liste.length})</h3><ul style="padding-left:18px;margin:0">${liste.map((e) => `<li style="margin:4px 0">${f(e)}</li>`).join("")}</ul>` : "";
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f1735">
    <div style="height:6px;border-radius:3px;background:linear-gradient(90deg,#00b4ff,#a020ff,#d63fd0,#ff7f7f)"></div>
    <h2>☀️ Votre semaine magique</h2>
    ${bloc("🎭 Animations des 7 prochains jours", semaine, (e) => `<b>${j(e)}</b> – ${esc(e.titre || e.enfant || "Animation")}${e.animateurs ? `<br><small>👥 ${esc(e.animateurs)}</small>` : ""}`) || "<p>Aucune animation cette semaine.</p>"}
    ${bloc("⏳ Demandes en attente de réponse", attente, (e) => `${j(e)} – ${esc(e.titre || "")}`)}
    ${bloc("📝 Fiches anniversaire pas encore remplies (14 jours)", fichesManq, (e) => `${j(e)} – ${esc(e.titre || "")}${e.telephone ? " · " + esc(e.telephone) : ""}`)}
    ${bloc("💰 Acomptes pas encore reçus", acomptes, (e) => `${j(e)} – ${esc(e.titre || "")} : ${euros0(P.get(e.id)?.acompte)}`)}
    ${bloc("💶 Soldes pas encore encaissés", soldes, (e) => `${j(e)} – ${esc(e.titre || "")} : ${euros0(e.solde)}${e.solde_encaisse === "non" ? " (non payé)" : ""}`)}
    ${bloc("⚠️ Matériel manquant", manque, (e) => `${esc(e.materiel_manquant)}`)}
    ${APP_URL ? `<p style="margin-top:20px"><a href="${APP_URL}/index.html" style="display:inline-block;background:#8a3cf7;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold">Ouvrir l'agenda</a></p><p style="color:#6b6385;font-size:13px;margin-top:6px">📱 Le plus simple : ouvre l’app <b>Fantasy</b> sur ton écran d’accueil (un lien dans un mail s’ouvre toujours dans le navigateur).</p>` : ""}
    <p style="color:#6b6385;font-size:13px">Fantasy Kids Events – récap automatique du lundi</p></div>`;
  const out = [];
  for (const m of equipe || []) if (m.responsable) {
    try {
      if ((await canauxChoisis(m.email, "administration")).email)
        await envoyerEmail(await adresseMailAdministration(m.email), `☀️ Votre semaine magique – ${semaine.length} animation${semaine.length > 1 ? "s" : ""}`, html, "Votre récap de la semaine est disponible dans l'agenda.");
      out.push({ recap: m.email });
    }
    catch (e) { out.push({ recap: m.email, erreur: String(e?.message || e) }); }
    await envoyerPush(m.email, { title: "☀️ Votre semaine magique", body: `${semaine.length} animation(s) · ${fichesManq.length} fiche(s) à recevoir · ${acomptes.length} acompte(s) en attente`, url: "./index.html", tag: "recap-lundi" });
  }
  return out;
}
const euros0 = (n) => `${Number(n || 0).toFixed(2).replace(".", ",").replace(",00", "")} €`;

// ---------- logique principale ----------
const CHAMPS_IMPORTANTS = ["date", "heure_debut", "heure_fin", "adresse", "enceinte"];
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const aujourdhuiBelgique=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Brussels",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());

function quiPrevenir(type, ev, ancien) {
  const nouv = equipeDe(ev), anc = equipeDe(ancien);
  const ancMap = new Map(anc.map((a) => [norm(a.nom), a]));
  const nouvSet = new Set(nouv.map((a) => norm(a.nom)));
  const out = [];

  if (type === "INSERT") {
    if (ev.statut === "confirme") nouv.forEach((a) => out.push({ ...a, type: "nouvelle" }));
  } else if (type === "UPDATE") {
    if (ev.statut === "en_attente") return out;
    const vientDetreAnnule = ev.statut === "annule" && ancien.statut === "confirme";
    const reactive = ev.statut !== "annule" && ancien.statut === "annule";
    const change = CHAMPS_IMPORTANTS.some((k) => (ev[k] || "") !== (ancien[k] || ""));
    for (const a of nouv) {
      const avant = ancMap.get(norm(a.nom));
      if (ev.statut === "annule") { if (vientDetreAnnule && avant) out.push({ ...a, type: "annulee" }); continue; }
      if (ev.statut === "confirme" && (!avant || reactive || ancien.statut !== "confirme")) out.push({ ...a, type: "nouvelle" });
      else if (change || (avant.role || "") !== (a.role || "")) out.push({ ...a, type: "modifiee" });
    }
    if (ev.statut === "confirme")
      for (const a of anc) if (!nouvSet.has(norm(a.nom))) out.push({ ...a, type: "retire" });
  } else if (type === "DELETE") {
    if (ancien.statut === "confirme") anc.forEach((a) => out.push({ ...a, type: "annulee" }));
  }
  return out;
}

// ---------- 💌 Mailing informatif aux réservations d'un événement ----------
// ---------- ✨ Cycle des demandes d'animation anticipées ----------
const ANTICIPATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ANTICIPATION_MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const anticipationJours = (date: string, n: number) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const anticipationDateBelge = (date: string) => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(date));
const anticipationPersonnages = (ev: any) => String(ev.options?.personnages_client ||
  String(ev.notes || "").match(/Personnage souhaité\s*:\s*([^\n]+)/i)?.[1] || "À préciser").trim();
const anticipationPrenom = (ev: any) => String(ev.parent || "").trim().split(/\s+/)[0] || "";
const anticipationHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2,"0")).join("");
async function anticipationJeton(evenementId: string, version: number) {
  // HMAC stable : les anciens liens restent valables après un rappel manuel,
  // mais deviennent caducs lors d'un changement de date (version +1).
  const secret = env("ANTICIPATION_LINK_SECRET") || env("SUPABASE_SERVICE_ROLE_KEY");
  const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const jeton = anticipationHex(new Uint8Array(await crypto.subtle.sign("HMAC", cle,
    new TextEncoder().encode(`fantasy-anticipation:${evenementId}:${version}`))));
  const empreinte = anticipationHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jeton))));
  return { jeton, empreinte };
}

async function envoyerMailAnticipation(evenementId: string, etape: "accuse" | "ouverture" | "j7" | "manuel") {
  const [repEv, repSuivi] = await Promise.all([
    sb.from("evenements").select("*").eq("id", evenementId).maybeSingle(),
    sb.from("demandes_anticipees").select("*").eq("evenement_id", evenementId).maybeSingle(),
  ]);
  if (repEv.error || repSuivi.error) throw repEv.error || repSuivi.error;
  const ev = repEv.data, suivi = repSuivi.data;
  if (!ev || !suivi || ev.statut !== "en_attente" || (ev.type_evenement && ev.type_evenement !== "animation") || suivi.statut !== "anticipee")
    return { ignore: "demande non active" };
  const aujourd = aujourdhuiBelgique();
  if (etape === "accuse" && suivi.premier_email_le) return { ignore: "accusé déjà envoyé" };
  if (etape === "ouverture" && (suivi.ouverture_envoyee_le || suivi.date_ouverture > aujourd)) return { ignore: "pas encore ouverte" };
  if (etape === "j7" && (!suivi.ouverture_envoyee_le || suivi.rappel_j7_le ||
      anticipationJours(anticipationDateBelge(suivi.ouverture_envoyee_le), 7) > aujourd))
    return { ignore: "rappel à 7 jours non dû" };
  if (etape === "manuel" && !ANTICIPATION_UUID.test(evenementId)) return { ignore: "identifiant invalide" };
  if (etape === "manuel" && suivi.date_ouverture > aujourd) return { ignore: "rappel manuel disponible à partir de trois mois avant la date" };
  const email = String(ev.email || "").trim();
  if (!ANTICIPATION_MAIL.test(email)) return { ignore: "adresse du client absente ou invalide" };
  if (!getMailer()) throw new Error("Gmail professionnel non configuré");
  if (etape !== "accuse" && !APP_URL) throw new Error("APP_URL requis pour les boutons de réponse");

  // Réservation atomique d'une étape avant toute connexion SMTP. Si une
  // exécution est interrompue, elle ne sera PAS renvoyée silencieusement.
  const { data: journal, error: erreurClaim } = await sb.from("demandes_anticipees_emails")
    .insert({ evenement_id: evenementId, etape, version: suivi.version, destinataire: email })
    .select("id").single();
  if (erreurClaim?.code === "23505") {
    // Si le mail avait bien été journalisé, mais que la mise à jour du suivi
    // avait échoué juste après, réparer le compteur SANS renvoyer le mail.
    const {data:precedent}=await sb.from("demandes_anticipees_emails")
      .select("statut,envoye_le").eq("evenement_id",evenementId)
      .eq("etape",etape).eq("version",suivi.version).maybeSingle();
    if (precedent?.statut === "envoye" && precedent.envoye_le) {
      const champ=etape==="accuse" ? "premier_email_le" : etape==="ouverture" ? "ouverture_envoyee_le" : "rappel_j7_le";
      await sb.from("demandes_anticipees").update({[champ]:precedent.envoye_le})
        .eq("evenement_id",evenementId).eq("version",suivi.version).eq("statut","anticipee").is(champ,null);
    }
    return { ignore: "étape déjà prise (aucun doublon)" };
  }
  if (erreurClaim) throw erreurClaim;
  const premier = anticipationPrenom(ev);
  const dateTexte = quand(ev), personnage = anticipationPersonnages(ev), formule = ev.theme || "À préciser";
  let sujet = "✨ Votre demande d'animation a bien été conservée";
  let texte = `Bonjour${premier ? " " + premier : ""},\n\nNous vous remercions pour votre demande d’animation ! ✨\n\nNotre agenda n’est pas encore ouvert aux réservations pour cette période.\n\nCependant, nous conservons précieusement votre demande et nous reprendrons automatiquement contact avec vous 3 mois avant votre événement afin de savoir si vous êtes toujours intéressé(e).\n\nAucune démarche n’est nécessaire de votre côté pour le moment.\n\nVotre demande : ${dateTexte}\nPersonnage(s) : ${personnage}\n\nÀ très bientôt !\nL’équipe Fantasy Kids Events`;
  let boutons = "";
  try {
    if (etape !== "accuse") {
      const { jeton, empreinte } = await anticipationJeton(evenementId, suivi.version);
      const { data: jetonSauve, error: erreurJeton } = await sb.from("demandes_anticipees")
        .update({ token_hash: empreinte, modifie_le: new Date().toISOString() })
        .eq("evenement_id", evenementId).eq("version", suivi.version).eq("statut", "anticipee")
        .select("evenement_id").maybeSingle();
      if (erreurJeton || !jetonSauve) throw erreurJeton || new Error("Demande modifiée avant l'envoi");
      const base = `${APP_URL}/anticipation.html?t=${jeton}`;
      const oui = `${base}&choix=oui`, non = `${base}&choix=non`;
      boutons = `<p style="margin:24px 0"><a href="${oui}" style="display:inline-block;padding:14px 17px;border-radius:12px;background:#288a5b;color:#fff;text-decoration:none;font-weight:bold">✅ Je confirme mon intérêt</a> <a href="${non}" style="display:inline-block;padding:14px 17px;border-radius:12px;background:#f4e7ea;color:#a32943;text-decoration:none;font-weight:bold">❌ Je ne suis plus intéressé(e)</a></p>`;
      sujet = etape === "j7" ? "💌 Petit rappel : votre projet d'animation" : "✨ Votre projet d'animation : êtes-vous toujours intéressé(e) ?";
      texte = `Bonjour${premier ? " " + premier : ""},\n\n${etape === "j7" ? "Nous revenons vers vous, n'ayant pas encore reçu votre réponse.\n\n" : "Comme promis, nous vous recontactons trois mois avant votre événement.\n\n"}Êtes-vous toujours intéressé(e) par une animation Fantasy Kids Events ?\n\nDate souhaitée : ${dateTexte}\nPersonnage(s) : ${personnage}\nFormule : ${formule}\n\n✅ Je confirme mon intérêt : ${oui}\n❌ Je ne suis plus intéressé(e) : ${non}\n\nVotre réponse est une indication d'intérêt, pas une confirmation de réservation. Nous devons encore vérifier la disponibilité.\n\nÀ très bientôt !\nL'équipe Fantasy Kids Events`;
    }
    const html = `<div style="font-family:Arial,sans-serif;max-width:540px;margin:auto;color:#291c42">${BANDE}
      <h2 style="margin:20px 0 10px">✨ Fantasy Kids Events</h2>
      <p style="font-size:15px;line-height:1.7;white-space:pre-line">${esc(texte.split("\n\nVotre demande :")[0].split("\n\n✅ Je confirme")[0])}</p>
      <div style="background:#f6efff;border-radius:12px;padding:14px;margin:15px 0">
        <b>📅 ${esc(dateTexte)}</b><br>🎭 ${esc(personnage)}<br>✨ ${esc(formule)}</div>
      ${boutons}${etape !== "accuse" ? `<p style="font-size:13px;color:#71587e">Confirmer votre intérêt ne réserve pas la date : nous vérifierons ensuite la disponibilité.</p>` : ""}
      ${SIGNATURE}</div>`;
    await envoyerEmail(email, sujet, html, texte, [], { canal: "client" });
    const maintenant = new Date().toISOString();
    const { error: errMail } = await sb.from("demandes_anticipees_emails").update({ statut:"envoye", envoye_le:maintenant }).eq("id", journal.id);
    if (errMail) throw new Error("Mail parti, mais journal non mis à jour : vérification manuelle nécessaire.");
    const champs: Record<string, unknown> = { modifie_le: maintenant };
    if (etape === "accuse") champs.premier_email_le = maintenant;
    if (etape === "manuel" && !suivi.premier_email_le) champs.premier_email_le = maintenant;
    if (etape === "ouverture" || (etape === "manuel" && !suivi.ouverture_envoyee_le)) champs.ouverture_envoyee_le = maintenant;
    if (etape === "j7") champs.rappel_j7_le = maintenant;
    if (etape === "manuel" && suivi.ouverture_envoyee_le &&
        anticipationJours(anticipationDateBelge(suivi.ouverture_envoyee_le),7) <= aujourd) champs.rappel_j7_le = maintenant;
    const { error: errSuivi } = await sb.from("demandes_anticipees")
      .update(champs).eq("evenement_id", evenementId).eq("version", suivi.version).eq("statut", "anticipee");
    if (errSuivi) throw errSuivi;
    return { evenementId, etape, email: "envoyé" };
  } catch (err) {
    // Si le SMTP a répondu succès mais que le journal échoue, la campagne
    // reste bloquée en_cours (jamais reprogrammée automatiquement).
    if (!String(err?.message || "").startsWith("Mail parti"))
      await sb.from("demandes_anticipees_emails").update({ statut:"erreur", erreur:String(err?.message || err).slice(0,500) }).eq("id", journal.id);
    throw err;
  }
}

async function notifierReponsesAnticipees(equipe: any[]) {
  const { data, error } = await sb.from("demandes_anticipees")
    .select("evenement_id,statut,reponse_le").in("statut",["reconfirmee","abandonnee"])
    .is("admin_notifie_le",null).limit(50);
  if (error) throw error;
  const resultat = [];
  for (const d of data || []) {
    if (!d.reponse_le) continue;
    const { data: pris } = await sb.from("demandes_anticipees")
      .update({ admin_notifie_le: new Date().toISOString() })
      .eq("evenement_id", d.evenement_id).eq("statut",d.statut).is("admin_notifie_le",null)
      .select("evenement_id").maybeSingle();
    if (!pris) continue;
    const { data: ev } = await sb.from("evenements").select("titre,parent,date").eq("id",d.evenement_id).maybeSingle();
    for (const m of (equipe || []).filter(x => x.responsable && x.email)) {
      await envoyerPush(m.email,{title:d.statut === "reconfirmee" ? "✅ Intérêt reconfirmé : à traiter" : "❌ Demande anticipée abandonnée",
        body:`${ev?.parent || "Client"} · ${ev?.titre || "Animation"} · ${ev?.date || ""}`,
        url:`./index.html?ev=${d.evenement_id}`,tag:`anticipation-reponse-${d.evenement_id}`},
        {categorie:"administration",sansCloche:true});
    }
    resultat.push({ reponse: d.evenement_id, statut: d.statut });
  }
  return resultat;
}

async function traiterAnticipations(equipe: any[]) {
  const heure = Number(new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/Brussels",hour:"2-digit",hourCycle:"h23"}).format(new Date()));
  const aujourd = aujourdhuiBelgique();
  const resultats = await notifierReponsesAnticipees(equipe);
  if (heure < 9) return resultats;
  const { data: demandes, error } = await sb.from("demandes_anticipees")
    .select("evenement_id,statut,date_ouverture,premier_email_le,ouverture_envoyee_le,rappel_j7_le")
    .eq("statut","anticipee").order("date_ouverture",{ascending:true}).limit(1000);
  if (error) throw error;
  let envois = 0;
  for (const d of demandes || []) {
    if (envois >= 12) break;
    const etape = !d.premier_email_le ? "accuse" :
      d.date_ouverture <= aujourd && !d.ouverture_envoyee_le ? "ouverture" :
      d.ouverture_envoyee_le && !d.rappel_j7_le &&
      anticipationJours(anticipationDateBelge(d.ouverture_envoyee_le),7) <= aujourd ? "j7" : null;
    if (etape) {
      try { const r = await envoyerMailAnticipation(d.evenement_id, etape); resultats.push(r); if (!r.ignore) envois++; }
      catch(err) { console.error("Mail anticipé",d.evenement_id,etape,err);resultats.push({anticipation:d.evenement_id,erreur:String(err?.message||err)}); }
    }
    if (d.ouverture_envoyee_le && anticipationJours(anticipationDateBelge(d.ouverture_envoyee_le),14) <= aujourd) {
      const { error: errSansRep } = await sb.from("demandes_anticipees")
        .update({statut:"sans_reponse",modifie_le:new Date().toISOString()})
        .eq("evenement_id",d.evenement_id).eq("statut","anticipee").is("reponse_le",null);
      if (errSansRep) console.error("Sans réponse", errSansRep.message);
    }
  }
  return resultats;
}

const MAILING_FILTRES = ["tous", "confirmes", "acomptes_manquants"];
const MAILING_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAILING_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function acompteRappelMontant(r:any, prix:number) {
  const places=Math.max(0,Number(r.places)||0), recu=Math.max(0,Number(r.acompte_recu)||0);
  const total=Math.max(0,Math.round((prix*places-reductionResa(r,prix,places))*100)/100), P=places?total/places:0;
  const ann=Array.isArray(r.annulations)?r.annulations.reduce((s,a)=>s+Math.max(0,Number(a?.n)||0),0):0;
  const actives=Math.max(0,places-ann);
  const attendu=Math.round(actives*P/2*100)/100;
  const restant=Math.max(0,Math.round((actives*P-recu-Math.max(0,Number(r.avoir_utilise)||0)-Math.max(0,Number(r.paye_jour)||0))*100)/100);
  return Math.max(0,Math.min(restant,Math.round((attendu-recu)*100)/100));
}
async function mailingDestinataires(evenementId: string, filtre: string, rappel=false, reservationId="") {
  const { data: ev, error: erreurEv } = await sb.from("evenements")
    .select("id,titre,date,type_evenement,resa_prix,theme,theme_app,statut").eq("id", evenementId).maybeSingle();
  if (erreurEv) throw erreurEv;
  if (!ev || ev.type_evenement !== "evenement")
    throw new Error("Cet événement n'a pas de réservations gérées dans l'agenda.");
  if(rappel&&(ev.statut==="annule"||ev.statut==="termine"||ev.date<aujourdhuiBelgique()||ev.theme_app==="nuit"||/nuit\s*magique/i.test(`${ev.titre||""} ${ev.theme||""}`)||!(Number(ev.resa_prix)>0)))throw new Error("Rappel indisponible pour cet événement : vérifie sa date, son statut et son prix.");
  // Une limite haute détecte un jeu de données trop grand au lieu d'omettre
  // silencieusement des familles (pagination nécessaire au-delà de 499).
  const { data: lignes, error: erreurResa } = await sb.from("reservations")
    .select("id,nom,email,places,acompte_recu,confirmee_le,annulations,code_promo_id,promo_type,promo_montant,avoir_utilise,paye_jour")
    .eq("evenement_id", evenementId).order("id").limit(500);
  if (erreurResa) throw erreurResa;
  if ((lignes || []).length >= 500) throw new Error("Plus de 499 réservations : contacte l'administrateur avant l'envoi.");
  let sansEmail = 0, doublons = 0;
  const parEmail = new Map<string, { id: string; nom: string; email: string; rappels?: Array<{id:string;nom:string;montant:number;comm:string}> }>();
  for (const r of lignes || []) {
    const places = Math.max(0, Number(r.places) || 0);
    const annulees = Array.isArray(r.annulations) ? r.annulations.reduce((n, a) => n + Math.max(0, Number(a?.n) || 0), 0) : 0;
    const actives = Math.max(0, places - annulees);
    if (!actives || (filtre !== "tous" && !r.confirmee_le) || (reservationId&&r.id!==reservationId)) continue;
    const manquant=rappel?acompteRappelMontant(r,Math.max(0,Number(ev.resa_prix)||0)):0;
    if(rappel&&manquant<=0)continue;
    if (filtre === "acomptes_manquants" && !rappel) {
      const prix = Math.max(0, Number(ev.resa_prix) || 0);
      if (!prix || Number(r.acompte_recu || 0) >= (actives * (prix - (places ? reductionResa(r,prix,places)/places : 0))) / 2 - 0.005) continue;
    }
    const email = String(r.email || "").trim().toLowerCase();
    if (!MAILING_EMAIL.test(email) || email.length > 254) { sansEmail++; continue; }
    const detail={id:String(r.id),nom:String(r.nom||"Famille"),montant:manquant,comm:`${String(r.nom||"").trim()} ${ev.titre||""}`.trim().slice(0,60)};
    const prior=parEmail.get(email);
    if (prior) { doublons++; if(rappel)prior.rappels!.push(detail); continue; }
    parEmail.set(email, { id: String(r.id), nom: String(r.nom || "Famille"), email,...(rappel?{rappels:[detail]}:{}) });
  }
  const destinataires = [...parEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
  if (destinataires.length > 200) throw new Error("Plus de 200 destinataires : l'envoi doit être réparti en plusieurs lots.");
  const empreinte = new TextEncoder().encode(JSON.stringify([evenementId, filtre, rappel,reservationId,destinataires.map(r => [r.id, r.email,r.rappels||null])]));
  const h = await crypto.subtle.digest("SHA-256", empreinte);
  const cle = Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, "0")).join("");
  return { ev, destinataires, sansEmail, doublons, cle };
}

async function mailingRequete(req: Request, p: any) {
  const bearer = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return json({ ok: false, erreur: "Connexion requise" }, 401);
  const { data: identite, error: erreurAuth } = await sb.auth.getUser(bearer);
  const email = identite?.user?.email;
  if (erreurAuth || !email) return json({ ok: false, erreur: "Session invalide" }, 401);
  const { data: responsables, error: erreurProfil } = await sb.from("equipe")
    .select("id").ilike("email", email).eq("responsable", true).limit(1);
  if (erreurProfil || !responsables?.length) return json({ ok: false, erreur: "Réservé aux responsables" }, 403);

  const evenementId = String(p.evenementId || "").trim();
  if (!MAILING_UUID.test(evenementId)) return json({ ok: false, erreur: "Événement invalide" }, 400);
  if (p.type === "MAILING_EVENEMENT_HISTORY") {
    const { data: ev, error: evErr } = await sb.from("evenements").select("id,type_evenement").eq("id", evenementId).maybeSingle();
    if (evErr || !ev || ev.type_evenement !== "evenement") return json({ ok: false, erreur: "Événement introuvable" }, 404);
    const { data, error } = await sb.from("mailings_evenements")
      .select("id,sujet,filtre,statut,destinataires_total,envoyes,erreurs,cree_le")
      .eq("evenement_id", evenementId).order("cree_le", { ascending: false }).limit(20);
    if (error) throw new Error("Historique indisponible : exécute d'abord mailings-evenements.sql dans Supabase.");
    return json({ ok: true, envois: data || [] });
  }
  const filtre = String(p.filtre || "");
  if (!MAILING_FILTRES.includes(filtre)) return json({ ok: false, erreur: "Sélection de destinataires invalide" }, 400);
  const rappel=p.rappelAcompte===true, reservationId=rappel?String(p.reservationId||""):"";
  if(rappel&&(filtre!=="acomptes_manquants"||(reservationId&&!MAILING_UUID.test(reservationId))))return json({ok:false,erreur:"Rappel invalide"},400);
  const { ev, destinataires, sansEmail, doublons, cle } = await mailingDestinataires(evenementId, filtre,rappel,reservationId);
  if (p.type === "MAILING_EVENEMENT_PREVIEW")
    return json({ ok: true, total: destinataires.length, sansEmail, doublons, cle,
      destinataires: destinataires.map(r => ({ nom: r.nom, email: r.email, ...(rappel?{montant:r.rappels!.reduce((sum,x)=>sum+x.montant,0),reservations:r.rappels}: {}) })) });

  if (p.type !== "MAILING_EVENEMENT_SEND") return json({ ok: false, erreur: "Action inconnue" }, 400);
  const campagneId = String(p.campagneId || "").trim();
  const sujet = String(p.sujet || "").trim(), message = String(p.message || "").trim();
  if (!MAILING_UUID.test(campagneId) || !/^[a-f0-9]{64}$/i.test(String(p.cle || "")) || p.cle !== cle)
    return json({ ok: false, erreur: "La liste des destinataires a changé. Recommence l'aperçu avant d'envoyer." }, 409);
  if (sujet.length < 3 || sujet.length > 140 || /[\r\n]/.test(sujet) || message.length < 10 || message.length > 4000)
    return json({ ok: false, erreur: "Objet ou message invalide" }, 400);
  if (!destinataires.length) return json({ ok: false, erreur: "Aucun destinataire" }, 400);
  if (!getMailer()) return json({ ok: false, erreur: "Gmail professionnel non configuré : aucun mail envoyé." }, 503);
  if(rappel&&!env("IBAN"))return json({ok:false,erreur:"IBAN non configuré : aucun rappel envoyé."},503);

  // Insert atomique avant tout SMTP : deux requêtes avec le même identifiant
  // ne peuvent jamais lancer deux fois la campagne.
  const { error: erreurCreation } = await sb.from("mailings_evenements").insert({
    id: campagneId, evenement_id: evenementId, filtre, sujet, message,
    destinataires_total: destinataires.length, statut: "en_cours", cree_par: email.toLowerCase(),
  });
  if (erreurCreation) {
    if (erreurCreation.code !== "23505")
      return json({ ok: false, erreur: "Journal d'envoi indisponible : aucun mail envoyé. Active mailings-evenements.sql." }, 503);
    const { data: ancien } = await sb.from("mailings_evenements")
      .select("evenement_id,destinataires_total,envoyes,erreurs,statut").eq("id", campagneId).maybeSingle();
    if (!ancien || ancien.evenement_id !== evenementId) return json({ ok: false, erreur: "Identifiant déjà utilisé" }, 409);
    return json({ ok: true, dejaEnvoye: true, total: ancien.destinataires_total,
      envoyes: ancien.envoyes, erreurs: ancien.erreurs, statut: ancien.statut });
  }

  let envoyes = 0, erreurs = 0;
  const echecs: Array<{ email: string; raison: string }> = [];
  for (const r of destinataires) {
    try {
      if(rappel){
        // Re-read immediately before each email: never remind a payment just recorded.
        const frais=await mailingDestinataires(evenementId,filtre,true,reservationId);
        const actuel=frais.destinataires.find(x=>x.email===r.email);
        if(!actuel||JSON.stringify(actuel.rappels)!==JSON.stringify(r.rappels))throw new Error("Réservation ou acompte modifié depuis l’aperçu : rappel non envoyé.");
        const details=r.rappels||[];
        const html=`<div style="font-family:Arial,sans-serif;max-width:540px;margin:auto;color:#251b3e">${BANDE}<h2>✨ Petit rappel d'acompte · ${esc(ev.titre)}</h2>${bonjour(r.nom)}<p style="font-size:15px;line-height:1.7">${esc(message).replace(/\n/g,"<br>")}</p>${details.map(x=>blocVirement(x.montant,x.comm,"Acompte restant à verser"+(details.length>1?" · "+esc(x.nom):""))).join("")}<p>Si votre virement a déjà été effectué, merci de ne pas tenir compte de ce rappel. 💜</p>${SIGNATURE}</div>`;
        const texte=`Bonjour,\n\n${message}\n\n${details.map(x=>texteVirement(x.montant,x.comm,"Acompte restant à verser")).join("\n\n")}\n\nSi votre virement a déjà été effectué, merci de ne pas tenir compte de ce rappel.\nL'équipe Fantasy Kids Events`;
        await envoyerEmail(r.email,sujet,html,texte,[],{canal:"client"});
      }else{
      const html = `<div style="font-family:Arial,sans-serif;max-width:540px;margin:auto;color:#251b3e">${BANDE}
        <h2 style="margin:20px 0 8px">💜 ${esc(ev.titre || "Fantasy Kids Events")}</h2>
        <p style="font-size:15px;line-height:1.7">${esc(message).replace(/\n/g, "<br>")}</p>
        <p style="font-size:13px;color:#776b88">Ce message concerne votre réservation à l'événement ${esc(ev.titre || "Fantasy Kids Events")}.</p>
        ${SIGNATURE}</div>`;
      const texte = `${message}\n\nCe message concerne votre réservation à l'événement ${ev.titre || "Fantasy Kids Events"}.\nL'équipe Fantasy Kids Events`;
      await envoyerEmail(r.email, sujet, html, texte, [], { canal: "client" });
      }
      envoyes++;
    } catch (err) {
      erreurs++;
      echecs.push({ email: r.email, raison: String(err?.message || err).slice(0, 180) });
    }
    // Le progrès est conservé après chaque destinataire, même si la fonction
    // est interrompue. Une campagne interrompue n'est jamais relancée d'office.
    const { error: erreurJournal } = await sb.from("mailings_evenements").update({
      envoyes, erreurs, details: echecs, modifie_le: new Date().toISOString(),
    }).eq("id", campagneId);
    if (erreurJournal) throw new Error("Envoi interrompu : progression non enregistrée. Vérifie le journal avant toute nouvelle tentative.");
  }
  const { error: erreurFin } = await sb.from("mailings_evenements").update({
    statut: erreurs ? (envoyes ? "partiel" : "erreur") : "termine", termine_le: new Date().toISOString(),
  }).eq("id", campagneId);
  if (erreurFin) throw new Error("Mails traités mais clôture du journal impossible : vérifie l'historique.");
  return json({ ok: true, total: destinataires.length, envoyes, erreurs });
}

// 📸 Envoi vérifié depuis le bouton Photos de Fantasy App.
// Le statut "envoyées" n'est enregistré qu'après acceptation Gmail.
// Les anciens faux positifs peuvent être renvoyés explicitement.
// Aucun double envoi automatique n'est déclenché sur la mise à jour du statut.
async function envoyerPhotosDepuisApp(req: Request, p: any) {
  const bearer = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return json({ok:false,erreur:"Connexion requise."},401);
  const {data:identite,error:erreurAuth}=await sb.auth.getUser(bearer);
  const emailUtilisateur = String(identite?.user?.email || "");
  if (erreurAuth || !emailUtilisateur) return json({ok:false,erreur:"Session expirée."},401);
  const {data:membres,error:erreurEquipe}=await sb.from("equipe")
    .select("prenom,responsable").ilike("email",emailUtilisateur).eq("responsable",true).limit(5);
  if (erreurEquipe || !(membres || []).some(m => norm(m.prenom) === "jordan"))
    return json({ok:false,erreur:"L'envoi des photos est réservé au responsable autorisé."},403);
  const id = String(p.evenementId || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return json({ok:false,erreur:"Identifiant de prestation invalide."},400);
  const lien = String(p.lien || "").trim();
  let parsed: URL;
  try { parsed = new URL(lien); } catch (_) {
    return json({ok:false,erreur:"Le lien des photos est invalide."},400);
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || lien.length > 1900 ||
      parsed.username || parsed.password)
    return json({ok:false,erreur:"Le lien doit être une adresse Internet https valide."},400);
  const {data:ev,error:erreurEv}=await sb.from("evenements").select("*").eq("id",id).maybeSingle();
  if (erreurEv) throw erreurEv;
  if (!ev || ev.type_evenement !== "animation" || !["confirme", "termine"].includes(ev.statut) || ev.date > aujourdhuiBelgique())
    return json({ok:false,erreur:"Cette prestation n'est pas éligible à l'envoi."},400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(ev.email || "")))
    return json({ok:false,erreur:"L'e-mail du client est manquant ou invalide."},400);
  if (ev.photos_envoyees && p.renvoi !== true)
    return json({ok:false,erreur:"Les photos sont déjà marquées envoyées. Utilisez le renvoi explicite si nécessaire."},409);
  // Cette requête attend réellement que le fournisseur accepte l'envoi.
  await envoyerPhotosClient({...ev,photos_lien:lien});
  const maintenant = new Date().toISOString();
  const {data:modif,error:erreurMaj}=await sb.from("evenements")
    .update({photos_lien:lien,photos_envoyees:maintenant,photos_envoyees_par:"Jordan"})
    .eq("id",id).select("id");
  if (erreurMaj || !modif?.length)
    return json({ok:false,mailAccepte:true,erreur:"Gmail a accepté le mail, mais le statut n'a pas pu être enregistré. Ne renvoyez pas sans vérification dans Gmail."},503);
  return json({ok:true,mailAccepte:true,destinataire:ev.email,expediteur:getMailer()?.adresse || "",statut:"accepte_par_gmail"});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const p = await req.json();

    if (p.type === "PHOTOS_CLIENT_SEND") return await envoyerPhotosDepuisApp(req, p);

    if (["MAILING_EVENEMENT_PREVIEW", "MAILING_EVENEMENT_SEND", "MAILING_EVENEMENT_HISTORY"].includes(p.type))
      return await mailingRequete(req, p);

    if (p.type === "ATTENTE_ETAT") return await attenteEtat(p);
    if (p.type === "ATTENTE_CONFIRMER") return await attenteConfirmer(p);
    if (["ATTENTE_PROPOSER", "ATTENTE_RETIRER", "ATTENTE_EXPIRER"].includes(p.type))
      return await attenteActionResponsable(req, p);

    if (p.type === "ANTICIPATION_MANUEL") {
      const bearer = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
      if (!bearer) return json({ok:false,erreur:"Connexion requise"},401);
      const {data:identite,error:errAuth} = await sb.auth.getUser(bearer);
      if (errAuth || !identite?.user?.email) return json({ok:false,erreur:"Session invalide"},401);
      const {data:responsables,error:errResp} = await sb.from("equipe")
        .select("id").ilike("email",identite.user.email).eq("responsable",true).limit(1);
      if (errResp || !responsables?.length) return json({ok:false,erreur:"Réservé aux responsables"},403);
      const id = String(p.evenementId || "").trim();
      if (!ANTICIPATION_UUID.test(id)) return json({ok:false,erreur:"Animation invalide"},400);
      const resultat = await envoyerMailAnticipation(id,"manuel");
      return json({ok: !resultat.ignore, ...resultat, erreur: resultat.ignore || undefined});
    }

    // 🗳️ Push à toute l'équipe lors de la création d'un sondage.
    // La cloche est déjà enregistrée par la fonction SQL.
    if (p.type === "SONDAGE_NOUVEAU") {
      const bearer=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];
      if (!bearer) return json({ok:false,erreur:"Connexion requise"},401);
      const {data:identite,error:identErreur}=await sb.auth.getUser(bearer);
      const email=identite?.user?.email;
      if (identErreur || !email) return json({ok:false,erreur:"Session invalide"},401);
      const {data:profil,error:profilErreur}=await sb.from("equipe")
        .select("responsable,gestionnaire").ilike("email",email);
      if (profilErreur || !(profil||[]).some(m=>m.responsable || m.gestionnaire))
        return json({ok:false,erreur:"Action réservée au responsable"},403);
      const id=String(p.sondageId||"").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        return json({ok:false,erreur:"Identifiant de sondage invalide"},400);
      // Réservation atomique : un second clic ne renvoie pas les notifications.
      const {data:sondage,error:sondageErreur}=await sb.from("sondages_dispo")
        .update({push_initial_envoye:new Date().toISOString()})
        .eq("id",id).is("push_initial_envoye",null)
        .select("titre,date_limite,destinataires").maybeSingle();
      if (sondageErreur) throw sondageErreur;
      if (!sondage) return json({ok:true,dejaEnvoye:true});
      let pushs=0;
      const limite=new Date(sondage.date_limite).toLocaleString("fr-BE",{
        timeZone:"Europe/Brussels",day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"
      });
      for (const destinataire of sondage.destinataires || []) {
        pushs += await envoyerPush(destinataire,{
          title:"🗳️ Nouveau sondage de disponibilité",
          body:sondage.titre+" · Réponds avant le "+limite+".",
          url:"./index.html?sondages=1",
          tag:"sondage-"+id
        },{dejaEnCloche:true,categorie:"autres"});
      }
      return json({ok:true,pushs});
    }


    // 📣 Infos équipe : cloche enregistrée par le SQL, push envoyé une seule fois.
    if (p.type === "INFO_EQUIPE") {
      const bearer=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];
      if(!bearer)return json({ok:false,erreur:"Connexion requise"},401);
      const {data:identite,error:errAuth}=await sb.auth.getUser(bearer);
      const email=identite?.user?.email;
      if(errAuth||!email)return json({ok:false,erreur:"Session invalide"},401);
      const {data:profil,error:errProfil}=await sb.from("equipe")
        .select("responsable,gestionnaire").ilike("email",email);
      if(errProfil||!(profil||[]).some(m=>m.responsable||m.gestionnaire))
        return json({ok:false,erreur:"Réservé aux responsables"},403);
      const id=String(p.infoId||"").trim();
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        return json({ok:false,erreur:"Identifiant invalide"},400);
      const {data:info,error:errInfo}=await sb.from("infos_equipe")
        .update({push_envoye_le:new Date().toISOString()})
        .eq("id",id).is("push_envoye_le",null)
        .select("titre,contenu").maybeSingle();
      if(errInfo)throw errInfo;
      if(!info)return json({ok:true,dejaEnvoye:true});
      const {data:dest,error:errDest}=await sb.from("equipe").select("email");
      if(errDest)throw errDest;
      let n=0;
      for(const destinataire of [...new Set((dest||[]).map(x=>String(x.email||"").trim().toLowerCase()).filter(Boolean))]){
        n+=await envoyerPush(destinataire,{
          title:"📣 Info équipe : "+info.titre,
          body:String(info.contenu||"").slice(0,180),
          url:"./index.html?infos="+id,
          tag:"info-equipe-"+id
        },{dejaEnCloche:true,categorie:"autres"});
      }
      return json({ok:true,pushs:n});
    }

    // 💶 Paiements marqués par Jordan : seuls les responsables connectés peuvent
    // déclencher l'alerte. Les sommes sont relues côté serveur, jamais acceptées du navigateur.
    if (p.type === "PAIES_MAJ") {
      const bearer = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
      if (!bearer) return json({ ok: false, erreur: "Connexion requise" }, 401);
      const { data: identite, error: authError } = await sb.auth.getUser(bearer);
      const email = identite?.user?.email;
      if (authError || !email) return json({ ok: false, erreur: "Session invalide" }, 401);
      const { data: responsables, error: errResp } = await sb.from("equipe").select("id")
        .ilike("email", email).eq("responsable", true).limit(1);
      if (errResp || !responsables?.length) return json({ ok: false, erreur: "Réservé aux responsables" }, 403);

      if (!Array.isArray(p.rows) || p.rows.length > 100)
        return json({ ok: false, erreur: "Liste de paiements invalide" }, 400);
      const lignes = p.rows.map((r) => ({
        evId: String(r?.evId || "").trim(), prenom: String(r?.prenom || "").trim(),
      })).filter((r) => r.evId && r.prenom);
      if (!lignes.length) return json({ ok: true, envoyes: [] });
      const ids = [...new Set(lignes.map((r) => r.evId))];
      const [paiementsRep, evenementsRep, equipeRep] = await Promise.all([
        sb.from("paies").select("evenement_id,prenom,deplacement,prestation,paye,paye_le").in("evenement_id", ids),
        sb.from("evenements").select("*").in("id", ids),
        sb.from("equipe").select("prenom,email"),
      ]);
      if (paiementsRep.error || evenementsRep.error || equipeRep.error)
        return json({ ok: false, erreur: "Lecture des paiements impossible" }, 500);
      const parId = new Map((evenementsRep.data || []).map((e) => [String(e.id), e]));
      const parNom = new Map((equipeRep.data || []).map((m) => [norm(m.prenom), m]));
      const envoyes = [], dejaVus = new Set();
      for (const ligne of lignes) {
        const cle = ligne.evId + ":" + norm(ligne.prenom);
        if (dejaVus.has(cle)) continue;
        dejaVus.add(cle);
        const paiement = (paiementsRep.data || []).find((x) =>
          String(x.evenement_id) === ligne.evId && norm(x.prenom) === norm(ligne.prenom));
        const ev = parId.get(ligne.evId), membre = parNom.get(norm(ligne.prenom));
        // Le paiement est une action explicite du responsable : notifier même si la prestation est passée.
        if (!paiement?.paye || !paiement.paye_le || !ev || !membre?.email) {
          envoyes.push({ prenom: ligne.prenom, ignore: "paiement non confirmé ou membre introuvable" });
          continue;
        }
        const montant = (+paiement.deplacement || 0) + (+paiement.prestation || 0);
        const detail = {
          ...ev, __montant: montant,
          __paiementCle: `paie:${ligne.evId}:${norm(ligne.prenom)}:${paiement.paye_le}`,
        };
        envoyes.push(await prevenir(membre.email, membre.prenom, "paie", detail, ""));
      }
      return json({ ok: true, envoyes });
    }

    // 💳 Acompte d'une animation marqué « reçu » → mail : merci + solde + fiche anniversaire
    if (p.table === "evenements_prive") {
      const pv = p.record || {}, avant = p.old_record || {};
      // 💶 le solde du jour J suit l'acompte (s'il n'a pas été modifié à la main)
      if (p.type === "UPDATE" && !!pv.acompte_paye !== !!avant.acompte_paye && +pv.prix) {
        const { data: e0 } = await sb.from("evenements").select("solde").eq("id", pv.id).maybeSingle();
        const prix = +pv.prix, ac = +pv.acompte || 0, s0 = e0 ? +e0.solde : NaN;
        if (e0 && (e0.solde == null || Math.abs(s0 - prix) < 0.01 || Math.abs(s0 - (prix - ac)) < 0.01))
          await sb.from("evenements").update({ solde: Math.max(0, pv.acompte_paye ? prix - ac : prix) }).eq("id", pv.id);
      }
      if (p.type !== "UPDATE" || !pv.acompte_paye || avant.acompte_paye) return json({ ok: true, acompte: "rien à faire" });
      const { data: ev } = await sb.from("evenements").select("*").eq("id", pv.id).maybeSingle();
      if(ev?.date && ev.date<aujourdhuiBelgique())
        return json({ok:true,acompte:"historique : mail de confirmation non envoyé"});
      if (!ev || ev.statut !== "confirme" || !ev.email) return json({ ok: true, acompte: "pas confirmée ou pas d'e-mail" });
      try { return json({ ok: true, acompte: await envoyerFicheParent(ev, true, pv) }); }
      catch (e) { console.error("acompte", e); return json({ ok: false, acompte: "erreur : " + (e?.message || e) }); }
    }
    // 🎟️ Réservation d'événement confirmée / acompte reçu → mails au client
    if (p.table === "reservations") {
      let liberation = 0;
      try { liberation = await notifierLiberationAttente(p.type, p.record, p.old_record); }
      catch (e) { console.error("Alerte places libérées", e); }
      try {
        const resa = p.type === "DELETE" ? "réservation supprimée" : await mailsReservation(p.type, p.record, p.old_record);
        return json({ ok: true, resa, liberation });
      }
      catch (e) { console.error("résa", e); return json({ ok: false, resa: "erreur : " + (e?.message || e) }); }
    }

    // 👥 Membre ajouté (ou e-mail changé) dans l'app → son compte de connexion est créé tout seul
    if (p.table === "equipe") {
      const m = p.record || {}, avant = p.old_record || {};
      const email = String(m.email || "").trim().toLowerCase();
      // 🗑️ Membre retiré de l'équipe → son compte de connexion est supprimé (s'il n'est plus utilisé par personne)
      if (p.type === "DELETE") {
        const ancienMail = String(avant.email || "").trim().toLowerCase();
        if (!ancienMail) return json({ ok: true, compte: "pas d'e-mail" });
        const { data: encore } = await sb.from("equipe").select("id").ilike("email", ancienMail).limit(1);
        if (encore && encore.length) return json({ ok: true, compte: "e-mail encore utilisé" });
        let cible = null;
        for (let page = 1; page <= 10 && !cible; page++) {
          const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
          if (error) return json({ ok: false, compte: "erreur : " + error.message });
          cible = (data?.users || []).find((u) => String(u.email || "").toLowerCase() === ancienMail);
          if ((data?.users || []).length < 200) break;
        }
        if (!cible) return json({ ok: true, compte: "aucun compte" });
        const { error } = await sb.auth.admin.deleteUser(cible.id);
        return json({ ok: !error, compte: error ? "erreur : " + error.message : "supprimé", email: ancienMail });
      }
      if (!email || email === String(avant.email || "").trim().toLowerCase()) return json({ ok: true, compte: "rien à faire" });
      // sécurité : on ne crée un compte que pour un e-mail réellement présent dans la page Équipe
      const { data: vrai } = await sb.from("equipe").select("id").ilike("email", email).limit(1);
      if (!vrai || !vrai.length) return json({ ok: false, compte: "e-mail absent de l'équipe" });
      const { error } = await sb.auth.admin.createUser({ email, email_confirm: true });
      const deja = error && /already|registered|exists/i.test(error.message || "");
      if (error && !deja) { console.error("compte", error); return json({ ok: false, compte: "erreur : " + error.message }); }
      return json({ ok: true, compte: deja ? "existait déjà" : "créé", email });
    }

    // 📝 Bilan d'animation : parent mécontent ou incident → responsables
    if (p.table === "bilans") {
      const b = p.record;
      if (p.type !== "INSERT" || !b) return json({ ok: true, ignore: true });
      const { data: ev } = await sb.from("evenements").select("*").eq("id", b.evenement_id).maybeSingle();
      // Le bilan n'est jamais individuel : quand les autres validations sont
      // aussi faites, on retire le rappel de TOUS les téléphones de l'équipe.
      await classerFinSiTerminee(ev);
      if (!(b.incident || b.humeur === "mecontent" || b.humeur === "moyen"))
        return json({ ok: true, bilanCommun: "enregistré" });
      const { data: equipe } = await sb.from("equipe").select("prenom,email,responsable");
      const H = { moyen: "😐 parent moyennement satisfait", mecontent: "😟 parent mécontent" };
      const titre = b.incident ? "⚠️ Incident signalé" : "📝 Bilan à regarder";
      const corps = [ev ? `${titreDe(ev)} · ${quand(ev)}` : "", H[b.humeur] || "", b.texte || "", `par ${b.auteur || "?"}`].filter(Boolean).join("\n");
      let n = 0;
      for (const m of (equipe || []).filter((x) => x.responsable && norm(x.prenom) !== norm(b.auteur)))
        n += await envoyerPush(m.email, { title: titre, body: corps, url: `./index.html?ev=${b.evenement_id}`, tag: `bilan-${b.id}` });
      return json({ ok: true, pushs: n });
    }

    // 👗 Souhait Fantasy ou problème de tenue : la fonction SQL a déjà créé
    // la notification dans la cloche. Ce webhook ajoute le push téléphone,
    // sans produire un deuxième avis dans la cloche.
    if (p.table === "costume_demandes") {
      const d = p.record, avant = p.old_record || {};
      if (!d || (p.type !== "INSERT" && p.type !== "UPDATE")) return json({ ok: true, ignore: true });
      const changement = p.type === "INSERT" || ["choix", "costume_id", "motif", "detail", "photo_path"]
        .some((k) => d[k] !== avant[k]);
      const suivi = p.type === "UPDATE" && d.statut !== avant.statut && !changement;
      const { data: equipe } = await sb.from("equipe").select("prenom,email,responsable");
      const dest = (equipe || []).filter(x => x.email);
      let n = 0;
      if (changement && (d.choix === "fantasy" || d.motif || (d.statut === "a_traiter" && d.choix === "personnel"))) {
        const titre = d.motif ? "⚠️ Problème de tenue" : "👗 Demande de tenue Fantasy";
        const corps = `${d.membre} (${d.personnage}) · ${d.type}\n${d.choix === "fantasy" ? "Souhaite utiliser le matériel Fantasy" : "Choix personnel à vérifier"}${d.detail ? "\n" + d.detail.slice(0, 180) : ""}`;
        for (const m of dest.filter(m => m.responsable && norm(m.prenom) !== norm(d.modifie_par)))
          n += await envoyerPush(m.email, { title: titre, body: corps, url: `./index.html?tenue=${encodeURIComponent(d.evenement_id)}`,
            tag: `costume-demande-${d.evenement_id}-${d.membre}-${d.type}` }, { sansCloche: true, categorie: "materiel" });
      }
      if (suivi) {
        const membre = dest.find(m => norm(m.prenom) === norm(d.membre));
        if (membre) n += await envoyerPush(membre.email, {
          title: "👗 Mise à jour de ta tenue",
          body: `${d.personnage} · ${d.type} : ${d.statut === "resolue" ? "demande résolue" : d.statut === "en_cours" ? "en cours" : "à traiter"}`,
          url: `./index.html?tenue=${encodeURIComponent(d.evenement_id)}`,
          tag: `costume-suivi-${d.evenement_id}-${d.membre}-${d.type}`,
        }, { sansCloche: true, categorie: "materiel" });
      }
      return json({ ok: true, pushs: n });
    }

    // 🪡 Costume / perruque marqué « à réparer » → responsables
    if (p.table === "costumes") {
      const c = p.record, avant = p.old_record || {};
      const nouveau = avant.etat !== "reparer" || (!avant.probleme && c.probleme);
      if (p.type !== "UPDATE" || !c || c.etat !== "reparer" || !nouveau) return json({ ok: true, ignore: true });
      const { data: equipe } = await sb.from("equipe").select("prenom,email,responsable");
      let n = 0;
      for (const m of (equipe || []).filter((x) => x.responsable && norm(x.prenom) !== norm(c.maj_par)))
        n += await envoyerPush(m.email, { title: `🪡 ${c.nom || c.personnage} à réparer`, body: `${c.probleme || "Problème non précisé"}\nSignalé par ${c.maj_par || "?"}`, url: "./index.html?costumes=1", tag: `costume-reparer-${c.id}` });
      return json({ ok: true, pushs: n });
    }

    // 🎨 Consommable signalé « bientôt vide » / « vide » → responsables
    if (p.table === "stock") {
      const x = p.record, avant = p.old_record || {};
      if (p.type !== "UPDATE" || !x || x.etat === "ok" || x.etat === avant.etat) return json({ ok: true, ignore: true });
      const { data: equipe } = await sb.from("equipe").select("prenom,email,responsable");
      let n = 0;
      for (const m of (equipe || []).filter((y) => y.responsable && norm(y.prenom) !== norm(x.maj_par)))
        n += await envoyerPush(m.email, { title: `🛒 ${x.emoji || ""} ${x.nom} : ${x.etat === "vide" ? "vide" : "bientôt vide"}`.replace("  ", " "), body: `Signalé par ${x.maj_par || "?"} · à racheter`, url: "./index.html", tag: `stock-${x.id}` });
      return json({ ok: true, pushs: n });
    }

    // 💬 Nouveau message dans le chat → notification aux autres
    if (p.table === "messages") {
      if (p.type !== "INSERT" || !p.record) return json({ ok: true, ignore: true });
      const m = p.record;
      const { data: equipe } = await sb.from("equipe").select("prenom,email,responsable");
      let dest = (equipe || []).filter((x) => x.email);
      let nomCanal = "Équipe Fantasy";
      if (m.canal !== "equipe") {
        const { data: ev } = await sb.from("evenements").select("*").eq("id", m.evenement_id).maybeSingle();
        if (!ev) return json({ ok: true, ignore: "animation introuvable" });
        nomCanal = titreDe(ev);
        const noms = String(ev.animateurs || "").split(",")
          .map((a) => a.replace(/\(.*\)/, "").trim().toLowerCase()).filter(Boolean);
        dest = dest.filter((x) => x.responsable || noms.includes(String(x.prenom).toLowerCase()));
      }
      dest = dest.filter((x) => x.email.toLowerCase() !== String(m.auteur_email || "").toLowerCase());
      // 🔕 Respecte les conversations mises en sourdine, y compris pour @tous et @mentions.
      // Cette préférence est enregistrée dans Supabase pour tous les appareils de l'utilisateur.
      const { data: muets, error: erreurMuets } = await sb.from("chat_muets").select("email").eq("canal", m.canal);
      if (erreurMuets) {
        console.error("Impossible de lire les conversations muettes", erreurMuets);
        return json({ ok: false, erreur: "Préférences de chat indisponibles" }, 503);
      }
      const emailsMuets = new Set((muets || []).map((x) => String(x.email).toLowerCase()));
      dest = dest.filter((x) => !emailsMuets.has(String(x.email).toLowerCase()));
      // 👀 pas de notification pour ceux qui ont cette conversation ouverte en ce moment
      try {
        const { data: pres } = await sb.from("chat_presence").select("email,canal,vu_le").eq("canal", m.canal).gte("vu_le", new Date(Date.now() - 60000).toISOString());
        const ouverts = new Set((pres || []).map((x) => String(x.email).toLowerCase()));
        dest = dest.filter((x) => !ouverts.has(x.email.toLowerCase()));
      } catch (_) { /* table absente : on notifie tout le monde */ }
      const corps = (m.texte || "").trim() || (m.audio_path ? "🎤 Message vocal" : "📸 Photo");
      // 📣 @Prénom / @tous → notification « t'a mentionné »
      const norm = (x: string) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
      const txt = norm(m.texte || ""), tous = /(^|\s)@tous(?![\w])/.test(txt);
      const mentionne = (prenom: string) => tous || txt.includes("@" + norm(prenom));
      let n = 0;
      for (const d of dest) {
        const tag = mentionne(d.prenom);
        const titreChat = tag ? `📣 ${m.auteur || "Quelqu'un"} ${tous ? "a mentionné tout le monde" : "t'a mentionné"} · ${nomCanal}` : `💬 ${m.auteur || "Quelqu'un"} · ${nomCanal}`;
        const choix = await canauxChoisis(d.email, "chat");
        n += await envoyerPush(d.email, {
          title: titreChat,
          body: corps.length > 140 ? corps.slice(0, 137) + "…" : corps,
          url: `./index.html?chat=${encodeURIComponent(m.canal)}`,
          tag: tag ? `ment-${m.id}` : `chat-${m.canal}`,
        }, { categorie: "chat", autorisePush: choix.push, sansCloche: true });
        if (choix.email) {
          try {
            const lien = APP_URL ? `${APP_URL}/index.html?chat=${encodeURIComponent(m.canal)}` : "";
            await envoyerEmail(d.email, titreChat,
              `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto"><h2>${esc(titreChat)}</h2><p style="white-space:pre-wrap">${esc(corps)}</p>${lien ? `<p><a href="${lien}">Ouvrir la conversation</a></p>` : ""}<p>Fantasy Kids Events</p></div>`,
              `${titreChat}\n\n${corps}${lien ? "\n\n" + lien : ""}`);
          } catch (e) { console.error("E-mail chat", e); }
        }
      }
      return json({ ok: true, chat: dest.length, pushs: n });
    }

    // Bouton « Tester » dans l'app
    if (p.type === "TEST") {
      const r = await prevenir(p.email, p.prenom || "", "nouvelle", {
        id: "test", titre: "Notification de test", date: aujourdhui(), heure_debut: "15:00",
        theme: "Tout fonctionne ✨", adresse: "",
      }, "");
      return json({ ok: true, ...r });
    }

    // Le token du devis donne droit à une seule notification de réponse.
    // Le client a déjà enregistré sa décision via la fonction SQL sécurisée.
    if (p.type === "DEVIS_REPONSE") {
      const token=String(p.token||"");
      if(token.length<24||token.length>128)return json({ok:false,erreur:"Lien invalide"},400);
      const {data:d,error:errDevis}=await sb.from("devis")
        .select("evenement_id,reponse_client,reponse_motif,reponse_message,reponse_le,reponse_push_le")
        .eq("token",token).maybeSingle();
      if(errDevis||!d||!["refuse","modification"].includes(d.reponse_client)||!d.reponse_le)
        return json({ok:false,erreur:"Réponse introuvable"},404);
      if(Date.now()-new Date(d.reponse_le).getTime()>24*3600_000)
        return json({ok:true,ancien:true});
      const {data:prise,error:errPrise}=await sb.from("devis")
        .update({reponse_push_le:new Date().toISOString()})
        .eq("evenement_id",d.evenement_id).is("reponse_push_le",null)
        .select("evenement_id").maybeSingle();
      if(errPrise)throw errPrise;
      if(!prise)return json({ok:true,dejaEnvoye:true});
      const {data:ev}=await sb.from("evenements").select("titre,enfant,parent").eq("id",d.evenement_id).maybeSingle();
      const {data:equipe}=await sb.from("equipe").select("prenom,email,responsable").eq("responsable",true);
      const titre=d.reponse_client==="refuse"?"❌ Devis refusé":"💬 Modification demandée";
      const body=`${ev?.parent||"Le client"} · ${ev?.titre||ev?.enfant||"Animation"}${d.reponse_motif?"\n"+d.reponse_motif:""}${d.reponse_message?"\n"+d.reponse_message:""}`;
      let pushs=0;
      for(const m of equipe||[])if(m.email)
        pushs+=await envoyerPush(m.email,{title:titre,body,url:`./index.html?ev=${d.evenement_id}`,tag:`devis-reponse-${d.evenement_id}`},
          {categorie:"administration",sansCloche:true});
      let mail="envoyé";
      try { await mailDecisionDevis(titre,body,d.evenement_id); }
      catch(e) { mail="erreur : "+(e?.message||e); console.error("Mail réponse devis",e); }
      return json({ok:true,pushs,mail});
    }

    // Rappels 1h avant (appelé toutes les 5 minutes par la tâche planifiée)
    if (p.type === "RAPPELS") {
      const { data: aVenir, error } = await sb.rpc("rappels_a_envoyer");
      if (error) throw error;
      const { data: equipe } = await sb.from("equipe").select("prenom,email,responsable");
      const parNom = new Map((equipe || []).map((m) => [norm(m.prenom), m]));
      const resultats = [];
      // 💌 Le parcours 3 mois / J+7 / J+14 s'exécute côté serveur, même
      // lorsque l'agenda est fermé. La cloche des réponses est créée en SQL.
      try { resultats.push(...(await traiterAnticipations(equipe))); }
      catch (err) { console.error("Rappels anticipés",err); }
      // ⏳ Demandes clients non traitées : rappels quotidiens pour Jordan.
      try { resultats.push(...(await relancerDemandesAnimation(equipe))); }
      catch (err) { console.error("Relances demandes d'animation", err); }
      // 📜 Devis envoyés sans réponse : un avis à 3 jours puis à 5 jours.
      try { resultats.push(...(await rappelsDevisClients(equipe))); }
      catch (err) { console.error("Rappels devis clients", err); }
      // 🗳️ Rappels de sondages : J-7, J-2, J-1 et H-4.
      // Les notifications de la cloche peuvent avoir été créées par Cron ;
      // un petit registre SQL permet d'envoyer les pushs sans doublon.
      try {
        const {error:errCreation}=await sb.rpc("relancer_sondages_dispo");
        if (errCreation) throw errCreation;
        const {data:pushsSondages,error:errPushs}=await sb.rpc("prendre_push_sondages_dispo");
        if (errPushs) throw errPushs;
        for (const alerte of pushsSondages || []) {
          const pushs=await envoyerPush(alerte.email,{
            title:alerte.titre,body:alerte.message,
            url:alerte.lien || "./index.html?sondages=1",
            tag:"sondage-rappel"
          },{dejaEnCloche:true,categorie:"rappels"});
          resultats.push({sondage:alerte.email,pushs});
        }
      } catch(err){console.error("Rappels sondages",err);}
      for (const ev of aVenir || []) {
        if (ev.statut !== "confirme") continue;
        // on marque d'abord, pour ne jamais envoyer deux fois
        const { data: pris } = await sb.from("evenements").update({ rappel_envoye: new Date().toISOString() })
          .eq("id", ev.id).is("rappel_envoye", null).select("id");
        if (!pris || !pris.length) continue;
        for (const a of equipeDe(ev)) {
          const m = parNom.get(norm(a.nom));
          if (m) resultats.push(await prevenir(m.email, m.prenom, "rappel", ev, a.role));
        }
      }
      // 📅 La veille (dès 18h) : animations et événements, avec poste + horaires de chacun
      try {
        const { data: veille } = await sb.rpc("rappels_veille");
        for (const ev of veille || []) {
          if (ev.statut !== "confirme") continue;
          const { data: pris } = await sb.from("evenements").update({ rappel_veille_envoye: new Date().toISOString() })
            .eq("id", ev.id).is("rappel_veille_envoye", null).select("id");
          if (!pris || !pris.length) continue;
          for (const a of equipeDe(ev)) {
            const m = parNom.get(norm(a.nom));
            if (m) resultats.push(await prevenir(m.email, m.prenom, "rappel_veille", ev, a.role));
          }
        }
      } catch (e) { console.error("rappel veille", e); }

      // 🦋 À mi-animation : uniquement l'ACC, si le comptage ou l'encaissement
      // des tatouages est encore à faire. Une seule alerte pour la prestation.
      const maintenantMs = maintenantBelgiqueMs();
      const dateBelge = (d) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" });
      const aujourd = dateBelge(new Date());
      const { data: auMilieu, error: eTat } = await sb.from("evenements").select("*")
        .eq("date", aujourd).is("tatouages_rappel_milieu_envoye", null);
      if (eTat) throw eTat;
      for (const ev of auMilieu || []) {
        if (ev.statut !== "confirme" || ev.type_evenement !== "animation" || !tatouagesACompleter(ev)
          || !rappelTatouagesMilieuEligible(ev, maintenantMs)) continue;
        const accompagnateurs = equipeDe(ev).filter((a) => estAccompagnateur(a.role))
          .map((a) => ({ ...a, membre: parNom.get(norm(a.nom)) })).filter((a) => !!a.membre?.email);
        if (!accompagnateurs.length) continue;
        const { data: pris, error: ePris } = await sb.from("evenements")
          .update({ tatouages_rappel_milieu_envoye: new Date().toISOString() })
          .eq("id", ev.id).is("tatouages_rappel_milieu_envoye", null).select("id");
        if (ePris) throw ePris;
        if (!pris?.length) continue;
        for (const a of accompagnateurs)
          resultats.push(await prevenir(a.membre.email, a.membre.prenom, "tatouages_milieu", ev, a.role));
      }

      // 🏁 Cinq minutes APRÈS une animation (jamais après un événement) :
      // une cloche par membre concerné, uniquement si une validation manque.
      // Lecture directe pour ne pas dépendre de la fenêtre temporelle de l'ancienne RPC.
      const hier = dateBelge(new Date(Date.now() - 24 * 60 * 60_000));
      const { data: finies, error: e2 } = await sb.from("evenements").select("*")
        .gte("date", hier).lte("date", aujourd).is("fin_envoye", null);
      if (e2) throw e2;
      const eligibles = (finies || []).filter((ev) => ev.statut === "confirme" && ev.type_evenement === "animation" && rappelFinEligible(ev, maintenantMs));
      const ids = eligibles.map((ev) => ev.id);
      let bilansEnvoyes = new Set();
      if (ids.length) {
        const { data: bilansFin, error: eBilans } = await sb.from("bilans").select("evenement_id").in("evenement_id", ids);
        if (eBilans) throw eBilans;
        bilansEnvoyes = new Set((bilansFin || []).map((b) => String(b.evenement_id)));
      }
      for (const ev of eligibles) {
        ev.__bilanManquant = !bilansEnvoyes.has(String(ev.id));
        // Le solde de base et les tatouages sont deux règlements distincts.
        ev.__soldeManquant = validationSoldeManquante(ev);
        const tatouagesManquants = tatouagesACompleter(ev);
        const personnes = equipeDe(ev).map((a) => ({ ...a, membre: parNom.get(norm(a.nom)),
          tat: tatouagesManquants && estAccompagnateur(a.role) }))
          .filter((a) => a.membre?.email && (ev.__bilanManquant || ev.__soldeManquant || a.tat));
        if (!personnes.length) continue;
        const { data: pris } = await sb.from("evenements").update({ fin_envoye: new Date().toISOString() })
          .eq("id", ev.id).is("fin_envoye", null).select("id");
        if (!pris?.length) continue;
        for (const a of personnes) {
          ev.__tatouagesManquants = a.tat;
          resultats.push(await prevenir(a.membre.email, a.membre.prenom, "fin", ev, a.role));
        }
      }
      // ⚠️ J-3 et J-1 : matériel signalé manquant et pas encore réglé -> responsables
      try {
        const { data: proches } = await sb.rpc("animations_j3_j1");
        if (proches && proches.length) {
          const { data: manques } = await sb.from("evenements").select("titre,date,materiel_manquant")
            .neq("statut", "annule").not("materiel_manquant", "is", null);
          const liste = (manques || []).filter((m) => (m.materiel_manquant || "").trim())
            .map((m) => `${m.materiel_manquant.trim()}\n   (signalé sur « ${m.titre || "animation"} » du ${m.date.split("-").reverse().join("/")})`).join("\n");
          const bxl = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Brussels" }));
          const j3 = new Date(bxl.getFullYear(), bxl.getMonth(), bxl.getDate() + 3);
          const j3iso = `${j3.getFullYear()}-${String(j3.getMonth() + 1).padStart(2, "0")}-${String(j3.getDate()).padStart(2, "0")}`;
          for (const ev of proches) {
            const q = ev.date === j3iso ? "j3" : "j1";
            const col = q === "j3" ? "materiel_alerte_j3" : "materiel_alerte_j1";
            const { data: pris } = await sb.from("evenements").update({ [col]: new Date().toISOString() })
              .eq("id", ev.id).is(col, null).select("id");
            if (!pris || !pris.length || !liste) continue;   // rien ne manque : pas d'alerte
            ev.__manquants = liste;
            for (const m of equipe || []) if (m.responsable)
              resultats.push(await prevenir(m.email, m.prenom, q === "j3" ? "materiel_j3" : "materiel_j1", ev, ""));
          }
        }
      } catch (e) { console.error("materiel j3/j1", e); }

      // 💰 Acompte non reçu à moins de 10 jours -> responsables
      try {
        const { data: retards } = await sb.rpc("acomptes_a_relancer");
        for (const ev of retards || []) {
          const { data: pris } = await sb.from("evenements").update({ acompte_relance: new Date().toISOString() })
            .eq("id", ev.id).is("acompte_relance", null).select("id");
          if (!pris || !pris.length) continue;
          const { data: pv } = await sb.from("evenements_prive").select("acompte").eq("id", ev.id).maybeSingle();
          ev.__acompte = pv?.acompte;
          ev.__jours = Math.max(0, Math.round((Date.parse(ev.date) - Date.parse(aujourdhui())) / 864e5));
          for (const m of equipe || []) if (m.responsable) resultats.push(await prevenir(m.email, m.prenom, "acompte", ev, ""));
        }
      } catch (e) { console.error("acomptes", e); }

      // 🎂 Anniversaire d'un membre de l'équipe -> message dans le salon (dès 8h)
      try { await anniversairesEquipe(); } catch (e) { console.error("anniversaires", e); }

      // ⏱️ Oubli de pointer sa sortie (en service depuis plus de 10 h)
      try {
        const { data: oublis } = await sb.from("pointages").select("*").is("fin", null).eq("alerte_envoyee", false)
          .lt("debut", new Date(Date.now() - 10 * 3600e3).toISOString());
        for (const o of oublis || []) {
          await sb.from("pointages").update({ alerte_envoyee: true }).eq("id", o.id);
          const h = new Date(o.debut).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
          const lui = (equipe || []).find((m) => norm(m.prenom) === norm(o.prenom));
          if (lui) resultats.push(await envoyerPush(lui.email, { title: "⏱️ Tu as oublié de pointer ta sortie ?", body: `Tu es en service depuis ${h}. Pointe ta sortie dans l'app (ou préviens Jordan).`, url: "./index.html?vue=mine", tag: `oubli-${o.id}` }));
          for (const m of (equipe || []).filter((x) => x.responsable))
            resultats.push(await envoyerPush(m.email, { title: "⏱️ Pointage pas terminé", body: `${o.prenom} est « en service » depuis ${h} : oubli de pointer la sortie ?`, url: "./index.html?vue=stats", tag: `oubli-resp-${o.id}` }));
        }
      } catch (e) { console.error("pointage", e); }

      // 💾 Sauvegarde hebdomadaire complète par e-mail
      try { resultats.push(...(await sauvegardeHebdo(equipe))); } catch (e) { console.error("sauvegarde", e); }

      // 📤 Le 1er du mois : la compta du mois précédent par e-mail
      try { resultats.push(...(await comptaDuMois(equipe))); } catch (e) { console.error("compta", e); }

      // ☀️ Résumé du matin -> responsables uniquement
      try { await resumeMatin(equipe); } catch (e) { console.error("resume", e); }

      // 📋 Check-list de la veille -> responsables uniquement
      try { await rappelChecklist(equipe); } catch (e) { console.error("checklist", e); }

      // 📸 Ménage quotidien : photos du chat de plus de 6 mois
      try { await menagePhotos(); } catch (e) { console.error("photos", e); }

      // 👗 Costumes & perruques : rappel quotidien J-7 + veille
      try { resultats.push(...(await rappelsCostumes(equipe))); } catch (e) { console.error("costumes", e); }

      // 🌧️ Météo J-2 pour les animations en extérieur (à partir de 9h)
      try { resultats.push(...(await alertesMeteo(equipe))); } catch (e) { console.error("meteo", e); }

      // 📅 Récap du lundi matin pour les responsables (à partir de 8h)
      try { const r = await recapLundi(equipe); if (r) resultats.push(...r); } catch (e) { console.error("recap", e); }

      // 📩 Nouvelles demandes du formulaire du site -> animations « en attente »
      try {
        const nouvelles = await importerDemandes();
        for (const ev of nouvelles) {
          // Wix expédie déjà son e-mail de demande : garder la cloche/push,
          // sans ajouter un second message pour cette même demande.
          for (const m of equipe || []) if (m.responsable && m.email)
            resultats.push(await prevenir(m.email, m.prenom, "demande", ev, "", { sansEmail: true }));
        }
      } catch (e) { console.error("import site", e); resultats.push({ erreur_import: String(e?.message || e) }); }

      // 🎟️ Réservations d'événements reçues via le formulaire Contact du site
      try {
        const resa = await importerResaSite();
        for (const x of resa) {
          // Une réservation Wix figure déjà dans la section réservations.
          // Éviter un doublon de cloche et un deuxième e-mail automatique.
          for (const m of (equipe || []).filter((y) => y.responsable && y.email)) {
            resultats.push(await envoyerPush(m.email, { title: `🎟️ Nouvelle réservation : ${x.titre}`, body: `${x.nom} · ${x.places} place${x.places > 1 ? "s" : ""}${x.bebes ? ` + ${x.bebes} bébé${x.bebes > 1 ? "s" : ""}` : ""} (via le site, à vérifier)`, url: "./index.html", tag: `resa-${x.wix_submission_id}` }, { sansCloche: true }));
          }
        }
      } catch (e) { console.error("import résa", e); resultats.push({ erreur_import_resa: String(e?.message || e) }); }

      // 💜 Même cadence que les réservations Wix, sans toucher à reservations.
      try {
        const expirees = await expirerPropositionsAttente();
        if (expirees) resultats.push({ attente_expirees: expirees });
        const attentes = await importerListeAttente();
        for (const a of attentes) {
          const payload = { title: `💜 Liste d'attente : ${a.nom}`,
            body: `${a.places} place(s) – ${a.titre}`, url: `./index.html?ev=${a.evenement_id}`,
            tag: `attente-wix-${a.wix_submission_id}` };
          resultats.push(await notifierResponsablesAttente(payload, String(a.evenement_id), `attente-wix:${a.wix_submission_id}`));
        }
      } catch (e) { console.error("import liste d'attente", e); resultats.push({ erreur_import_attente: String(e?.message || e) }); }
      console.log("rappels", JSON.stringify(resultats));
      return json({ ok: true, rappels: resultats });
    }

    // Bouton « Envoyer la fiche par e-mail » dans l'app
    if (p.type === "DEVIS") {
      const bearer=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1];
      const {data:identite,error:errIdentite}=bearer?await sb.auth.getUser(bearer):{data:null,error:new Error("Connexion requise")};
      if(errIdentite||!identite?.user?.email)return json({ok:false,erreur:"Connexion requise"},401);
      const {data:profil,error:errProfil}=await sb.from("equipe").select("responsable,gestionnaire").ilike("email",identite.user.email);
      if(errProfil||!(profil||[]).some(m=>m.responsable||m.gestionnaire))return json({ok:false,erreur:"Réservé à la gestion"},403);
      const { data: e } = await sb.from("evenements").select("*").eq("id", p.evId).maybeSingle();
      if (!e) return json({ ok: false, erreur: "animation introuvable" }, 404);
      const r = await envoyerDevis(e,{relance:p.relance===true});
      return json({ ok: r === "devis envoyé", devis: r, erreur: r === "devis envoyé" ? undefined : r });
    }
    if (p.type === "FICHE") {
      const { data: e } = await sb.from("evenements").select("*").eq("id", p.evId).maybeSingle();
      if (!e) return json({ ok: false, erreur: "animation introuvable" }, 404);
      if (p.email && !e.email) { await sb.from("evenements").update({ email: p.email }).eq("id", e.id); e.email = p.email; }
      return json({ ok: true, ficheEnvoi: await envoyerFicheParent(e, true) });
    }

    const type = p.type;
    const ev = type === "DELETE" ? p.old_record : p.record;
    const ancien = p.old_record || {};
    if (!ev || !ev.date) return json({ ok: true, ignore: "pas d'événement" });

    // Le traitement de la fiche clôt automatiquement l'alerte initiale
    // et tous les anciens rappels, même sans clic sur « Vu ».
    if ((type === "UPDATE" && ancien.statut === "en_attente" && ev.statut !== "en_attente")
      || (type === "DELETE" && ancien.statut === "en_attente")) {
      await classerRappels(ev.id, "demande");
    }

    if (type === "UPDATE") {
      // Aussitôt le nombre réel et le mode de paiement saisis, le rappel
      // de mi-animation ne doit plus figurer chez aucun ACC. Relire le vrai
      // dossier : un corps de webhook ne suffit pas à valider un paiement.
      const { data: dossierActuel, error: eActuel } = await sb.from("evenements")
        .select("*").eq("id", ev.id).maybeSingle();
      if (eActuel) console.error("Vérification des validations", eActuel.message);
      else if (dossierActuel) {
        if (!tatouagesACompleter(dossierActuel)) await classerRappels(ev.id, "tatouages_milieu");
        await classerFinSiTerminee(dossierActuel);
      }
    }

    // 🌐 Mise à jour des « Dates prises » du site
    const site = {};
    if (type !== "UPDATE" || ["date", "statut", "site_affichage"].some((k) => ev[k] !== ancien[k])) {
      for (const d of new Set([ev.date, ancien.date].filter(Boolean))) {
        try { site[d] = await syncDateSite(d); } catch (e) { console.error("site", e); site[d] = "erreur : " + (e?.message || e); }
      }
    }
    // 📚 Mise à jour de l'historique (avant aujourd'hui à Bruxelles) :
    // aucun push, e-mail ou avis dans la cloche, même pour matériel, fiche,
    // encaissement ou changement d'équipe. Les données restent enregistrées.
    // Inclut également l'ajout rétroactif d'une ancienne prestation.
    const jourLocal=aujourdhuiBelgique();
    if(["UPDATE","INSERT","DELETE"].includes(type) && ev.date < jourLocal)
      return json({ok:true,envoyes:[],site,historique:true,silencieux:true});

    const cibles=quiPrevenir(type,ev,ancien);

    const { data: equipe } = await sb.from("equipe").select("prenom,email,responsable");
    const parNom = new Map((equipe || []).map((m) => [norm(m.prenom), m]));

    // ⚠️ Matériel manquant signalé -> les responsables 👑 sont prévenus
    const manque = (ev.materiel_manquant || "").trim();
    if (type !== "DELETE" && ev.statut !== "annule" && manque && manque !== (ancien.materiel_manquant || "").trim()) {
      const avant = new Set((ancien.materiel_manquant || "").split("\n").map((l) => l.trim()).filter(Boolean));
      const nouveau = manque.split("\n").map((l) => l.trim()).filter((l) => l && !avant.has(l));
      ev.__nouveau_manquant = (nouveau.length ? nouveau : [manque]).join("\n");
      for (const m of equipe || []) if (m.responsable) cibles.push({ nom: m.prenom, role: "", type: "materiel" });
    }
    // 📨 Animation confirmée -> fiche anniversaire envoyée au parent
    const vientConfirmee = type !== "DELETE" && ev.statut === "confirme" && ancien.statut !== "confirme" && ev.date >= aujourdhui();
    let ficheEnvoi = null;
    if (vientConfirmee && (ev.email || ev.parent || ev.telephone)) {   // seulement les animations clients
      try { ficheEnvoi = await mailConfirmationAnimation(ev); } catch (e) { ficheEnvoi = "erreur : " + (e?.message || e); console.error("fiche", e); }
      // ✅ confirmée par le client lui-même (devis accepté en ligne) → on prévient les 👑
      try {
        const { data: dv } = await sb.from("devis").select("accepte_le").eq("evenement_id", ev.id).maybeSingle();
        if (dv?.accepte_le && Date.now() - new Date(dv.accepte_le).getTime() < 5 * 60e3) {
          for (const m of (equipe || []).filter((y) => y.responsable && y.email))
            await envoyerPush(m.email, { title: `✅ Devis accepté : ${ev.titre || ev.enfant || "animation"}`, body: `${ev.parent || "Le client"} a accepté le devis. La demande d'acompte vient de partir 💳`, url: `./index.html?ev=${ev.id}`, tag: `devis-${ev.id}` });
          try {
            await mailDecisionDevis(`✅ Devis accepté : ${ev.titre || ev.enfant || "animation"}`,
              `${ev.parent || "Le client"} a accepté votre devis.\n${quand(ev)}\nLa demande d'acompte est prévue dans le mail de confirmation.`,
              ev.id);
          } catch (mailErreur) { console.error("Mail devis accepté", mailErreur); }
        }
      } catch (e) { console.error("devis accepté", e); }
      if (ficheEnvoi === "pas d'e-mail" || String(ficheEnvoi).startsWith("erreur"))
        for (const m of equipe || []) if (m.responsable) cibles.push({ nom: m.prenom, role: "", type: "fiche_manuelle" });
    }
    // 📸 Les mails photos partent désormais UNIQUEMENT sur action explicite
    // PHOTOS_CLIENT_SEND, avec accusé de réception Gmail avant la validation.
    // Ne pas les envoyer une seconde fois au webhook UPDATE.
    let photosEnvoi = null;
    // 📝 Fiche anniversaire reçue -> responsables 👑
    if (type === "UPDATE" && ev.fiche_recue && ev.fiche_recue !== ancien.fiche_recue) {
      const { data: f } = await sb.from("fiches").select("reponses").eq("evenement_id", ev.id).maybeSingle();
      ev.__fiche = f?.reponses || {};
      if (ev.__fiche.date && ev.__fiche.date !== ev.date) ev.__dateDiff = ev.__fiche.date.split("-").reverse().join("/");
      for (const m of equipe || []) if (m.responsable) cibles.push({ nom: m.prenom, role: "", type: "fiche" });
    }
    // 💶 Solde encaissé (ou non payé) par l'équipe -> les responsables 👑
    if (type === "UPDATE" && ev.solde_encaisse && ev.solde_encaisse !== ancien.solde_encaisse) {
      for (const m of equipe || []) if (m.responsable)
        cibles.push({ nom: m.prenom, role: "", type: ev.solde_encaisse === "non" ? "nonpaye" : "encaisse" });
    }
    if (!cibles.length) return json({ ok: true, envoyes: [], site, ficheEnvoi, photosEnvoi });

    const resultats = [];
    for (const c of cibles) {
      const m = parNom.get(norm(c.nom));
      if (!m) { resultats.push({ prenom: c.nom, ignore: "pas dans la page Équipe" }); continue; }
      resultats.push(await prevenir(m.email, m.prenom, c.type, ev, c.role));
    }
    console.log(JSON.stringify(resultats));
    return json({ ok: true, envoyes: resultats, site, ficheEnvoi });
  } catch (e) {
    console.error(e);
    return json({ ok: false, erreur: String(e?.message || e) }, 500);
  }
});
