// Fantasy App • Gestion : gardien, suivi des incidents, journal des emails,
// et synthèse mensuelle. Les droits sont vérifiés aussi côté Supabase (RLS).
(function () {
  "use strict";
  const api = window.__fkQualite;
  if (!api) return;
  const $ = id => document.getElementById(id);
  const ech = s => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
  const eur = n => Number(n || 0).toLocaleString("fr-BE", {style:"currency",currency:"EUR"});
  const jour = () => {
    const d = new Date();
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
  };
  const moisCourant = () => jour().slice(0,7);
  const dateLongue = d => d ? new Date(d.slice(0,10)+"T12:00:00").toLocaleDateString("fr-BE",{
    day:"numeric",month:"long",year:"numeric"
  }) : "Date inconnue";
  const dateHeure = x => x ? new Date(x).toLocaleString("fr-BE",{
    day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"
  }) : "—";
  const boutons = {gardien:"gGardien",incidents:"gIncidents",emails:"gEmails",mensuel:"gMagiqueMensuel"};
  const panels = {gardien:"gGardienPanel",incidents:"gIncidentsPanel",emails:"gEmailsPanel",mensuel:"gMagiqueMensuelPanel"};
  const etats = {
    a_traiter:"⚠️ À traiter",
    en_cours:"🔧 En cours",
    resolu:"✅ Résolu"
  };
  let infos = {emails:[],diagnostics:[],suivis:[]};
  let erreurs = {};
  let vue = "";
  let enChargement = false;
  function erreurTable(n) {
    return erreurs[n] ? '<p class="hint" style="color:#b4123c">⚠️ ' +
      ech(erreurs[n]) + '. Vérifiez l’installation de fantasy-supervision.sql dans Supabase.</p>' : "";
  }
  async function charger() {
    if (!api.autorise()) return;
    if (enChargement) return;
    enChargement = true;
    try {
      const tables = [["emails","fantasy_emails_journal"],["diagnostics","fantasy_diagnostics"],
        ["suivis","fantasy_suivi_incidents"]];
      const listes = await Promise.all(tables.map(async ([nom,table]) => {
        try { return {nom,val:await api.lister(table)}; }
        catch(e) { return {nom,erreur:String(e?.message || e).slice(0,250)}; }
      }));
      listes.forEach(r => {
        erreurs[r.nom] = r.erreur || "";
        infos[r.nom] = r.erreur ? [] : (r.val || []);
      });
      rafraichir();
    } finally { enChargement = false; }
  }
  function signalements() {
    const donnees=api.donnees();
    if (!donnees) return [];
    const suivis = new Map(infos.suivis.map(s=>[String(s.bilan_id),s]));
    const fiches = new Map(donnees.evenements.map(e=>[String(e.id),e]));
    return donnees.bilans.filter(b => b.incident || ["moyen","mecontent"].includes(b.humeur))
      .map(b => ({
        bilan:b,
        ev:fiches.get(String(b.evenement_id)),
        suivi:suivis.get(String(b.id)) || {statut:"a_traiter",responsable:"",action_prevue:""}
      })).sort((a,b) => {
        const p={a_traiter:0,en_cours:1,resolu:2};
        return (p[a.suivi.statut] ?? 1)-(p[b.suivi.statut] ?? 1) ||
          String(b.ev?.date || b.bilan.created_at || "").localeCompare(String(a.ev?.date || a.bilan.created_at || ""));
      });
  }
  function controles() {
    const d=api.donnees();
    if (!d) return [];
    const aujourd = jour(), dans7 = new Date();
    dans7.setDate(dans7.getDate()+7);
    const limite = [dans7.getFullYear(),String(dans7.getMonth()+1).padStart(2,"0"),
      String(dans7.getDate()).padStart(2,"0")].join("-");
    const alertes=[];
    d.evenements.forEach(e=>{
      if (e.type_evenement !== "animation" || e.statut === "annule") return;
      if (e.date >= aujourd && e.date <= limite && e.statut === "confirme" && !e.heure_debut)
        alertes.push({icone:"🕒",titre:"Horaire à compléter",desc:(e.titre || e.enfant || "Animation")+" · "+dateLongue(e.date),
          id:String(e.id)});
      if (e.date >= aujourd && e.date <= limite && e.statut === "confirme" && !e.adresse)
        alertes.push({icone:"📍",titre:"Adresse à compléter",desc:(e.titre || e.enfant || "Animation")+" · "+dateLongue(e.date),
          id:String(e.id)});
      if (e.date >= aujourd && e.date <= limite && e.statut === "confirme" && e.prix <= 0)
        alertes.push({icone:"💶",titre:"Prix de base absent",desc:(e.titre || e.enfant || "Animation")+" · "+dateLongue(e.date),
          id:String(e.id)});
      if (e.statut === "confirme" && e.date >= aujourd && e.acompte > e.ca + 0.01)
        alertes.push({icone:"🧮",titre:"Acompte supérieur au total calculé",desc:(e.titre || e.enfant || "Animation")+" · "+dateLongue(e.date),
          id:String(e.id)});
      if (e.date >= aujourd && e.date <= limite && e.statut === "confirme" && !e.email)
        alertes.push({icone:"📧",titre:"Adresse e-mail manquante",desc:(e.titre || e.enfant || "Animation")+" · "+dateLongue(e.date),
          id:String(e.id)});
      if (e.date >= aujourd && e.date <= limite && e.statut === "en_attente" && !e.anticipee)
        alertes.push({icone:"⏳",titre:"Demande proche sans confirmation",desc:(e.titre || e.enfant || "Animation")+" · "+dateLongue(e.date),
          id:String(e.id)});
      if (e.date < aujourd && ["confirme","termine"].includes(e.statut) && !e.bilanPresent &&
          e.type_evenement === "animation" && !e.interne)
        alertes.push({icone:"📝",titre:"Bilan de prestation manquant",desc:(e.titre || e.enfant || "Animation")+" · "+dateLongue(e.date),
          id:String(e.id)});
    });
    return alertes;
  }
  function kpi(chiffre,texte) {
    return '<div class="mine-head" style="flex:1;min-width:100px;margin:0;padding:12px;text-align:center">' +
      '<b style="display:block;font-size:21px">' + ech(String(chiffre)) + '</b><small>' + ech(texte) + '</small></div>';
  }
  function renderGardien() {
    const box=$("gGardienContenu");
    if (!api.autorise()) {box.replaceChildren();return;}
    const ctrl=controles();
    const incidents=signalements().filter(x=>x.suivi.statut!=="resolu");
    const mailFails=infos.emails.filter(m=>m.statut==="echec");
    const errors=infos.diagnostics.filter(m=>m.statut==="nouveau");
    const recent=new Date(Date.now()-30*86400000);
    const nouveauxMails=mailFails.filter(x=>new Date(x.cree_le)>=recent);
    box.innerHTML = erreurTable("emails")+erreurTable("diagnostics")+erreurTable("suivis")+
      '<div class="row" style="gap:8px;flex-wrap:wrap">' +
        kpi(ctrl.length,"Points à contrôler")+kpi(incidents.length,"Incidents ouverts")+
        kpi(nouveauxMails.length,"Échecs e-mail / 30 j")+kpi(errors.length,"Erreurs appli non résolues")+'</div>' +
      '<p class="hint" style="margin:10px 0">Le Gardien vérifie les fiches chargées, les incidents, les envois journalisés et les erreurs JavaScript détectées après connexion. Il ne détecte pas toutes les pannes ni les messages classés en spam.</p>' +
      (ctrl.length ? '<h4>📌 Points à contrôler</h4>'+ctrl.slice(0,80).map(x=>
        '<div class="devis-gestion-row"><b>'+x.icone+' '+ech(x.titre)+'</b><p class="hint" style="margin:6px 0">'+ech(x.desc)+'</p>'+
        '<button class="sig" type="button" data-quality-ev="'+ech(x.id)+'">Ouvrir la fiche</button></div>').join("")
      : '<p class="hint">✅ Aucun problème détecté dans les contrôles des fiches actuellement chargées.</p>') +
      (mailFails.length ? '<h4>📧 Derniers échecs e-mail</h4>'+mailFails.slice(0,8).map(x=>
        '<div class="devis-gestion-row"><b>'+ech(x.sujet || "Message")+'</b>'+
        '<small style="display:block">'+ech(x.destinataire)+' · '+ech(dateHeure(x.cree_le))+'</small>'+
        (x.code_erreur?'<small>Motif : '+ech(x.code_erreur)+'</small>':"")+'</div>').join("")
      : '<p class="hint">📧 Aucun échec e-mail dans les envois journalisés.</p>') +
      (errors.length ? '<h4>🛠️ Erreurs de l’application</h4>'+errors.slice(0,30).map(x=>
        '<div class="devis-gestion-row"><b>'+ech(x.categorie)+' · '+ech(dateHeure(x.cree_le))+'</b>'+
        '<p class="hint" style="overflow-wrap:anywhere">'+ech(x.message)+'</p>'+
        '<button type="button" class="sig" data-diag-resoudre="'+ech(x.id)+'">✅ Marquer résolu</button></div>').join("")
      : '<p class="hint">🛠️ Aucune erreur JavaScript non résolue journalisée.</p>');
  }
  function renderIncidents() {
    const cible=$("gIncidentsContenu");
    if (!api.autorise()) {cible.replaceChildren();return;}
    const tous=signalements(), filtre=$("gIncidentsFiltre").value, q=$("gIncidentsSearch").value.trim().toLocaleLowerCase("fr");
    const liste=tous.filter(x => (filtre==="tous"||x.suivi.statut===filtre) &&
      (!q || [x.ev?.titre,x.ev?.enfant,x.ev?.parent,x.bilan.auteur,x.bilan.texte,x.suivi.responsable,x.suivi.action_prevue]
        .join(" ").toLocaleLowerCase("fr").includes(q)));
    cible.innerHTML = erreurTable("suivis")+
      '<p class="hint">'+tous.filter(x=>x.suivi.statut!=="resolu").length+' incident(s) à traiter · '+
      tous.filter(x=>x.suivi.statut==="resolu").length+' résolu(s). Les signalements proviennent des bilans existants.</p>'+
      (liste.length ? liste.slice(0,150).map(({bilan:b,ev, suivi:s})=>
        '<div class="devis-gestion-row" data-suivi-id="'+ech(b.id)+'">'+
          '<div class="dv-top"><b>⚠️ '+ech(ev?.titre || ev?.enfant || "Prestation")+'</b><span class="dv-status">'+(etats[s.statut]||"À traiter")+'</span></div>'+
          '<p class="hint" style="margin:8px 0">'+(ev ? ech(dateLongue(ev.date)) : "Fiche indisponible")+
          ' · Signalé par '+ech(b.auteur || "un membre")+'</p>'+
          (b.incident?'<b>⚠️ Incident signalé</b>':'<b>Retour parent : '+ech(b.humeur || "à vérifier")+'</b>')+
          (b.texte?'<p style="white-space:pre-wrap;overflow-wrap:anywhere">'+ech(b.texte)+'</p>':"")+
          '<div class="row" style="flex-wrap:wrap;gap:8px"><div><label>État</label><select data-inc-etat>'+
            Object.entries(etats).map(([k,v])=>'<option value="'+k+'"'+(s.statut===k?' selected':'')+'>'+v+'</option>').join("")+
          '</select></div><div><label>Responsable du suivi</label><input type="text" maxlength="100" data-inc-personne value="'+ech(s.responsable || "")+'" placeholder="Prénom" /></div></div>'+
          '<label>Suite à donner / résolution</label><textarea rows="2" maxlength="2000" data-inc-note placeholder="Action prévue, réponse au client, solution…">'+ech(s.action_prevue || "")+'</textarea>'+
          '<div class="dv-actions"><button class="sig" type="button" data-inc-save="'+ech(b.id)+'">💾 Enregistrer le suivi</button>'+
          (ev?'<button class="sig" type="button" data-quality-ev="'+ech(ev.id)+'">📂 Ouvrir la fiche</button>':"")+'</div>'+
        '</div>').join(""):'<p class="hint" style="text-align:center;padding:20px">Aucun signalement correspondant à ces filtres. ✨</p>');
  }
  function renderEmails() {
    const cible=$("gEmailsContenu");
    if (!api.autorise()){cible.replaceChildren();return;}
    const q=$("gEmailsSearch").value.trim().toLocaleLowerCase("fr"), filtre=$("gEmailsFiltre").value;
    const lignes=infos.emails.filter(e=>(filtre==="tous" || e.statut===filtre) &&
      (!q || [e.destinataire,e.sujet,e.code_erreur].join(" ").toLocaleLowerCase("fr").includes(q)));
    cible.innerHTML=erreurTable("emails")+
      '<div class="row" style="gap:8px;flex-wrap:wrap">'+
        kpi(infos.emails.filter(x=>x.statut==="accepte").length,"Acceptés par le fournisseur")+
        kpi(infos.emails.filter(x=>x.statut==="echec").length,"Échecs d’envoi")+'</div>'+
      '<p class="hint" style="margin:9px 0">L’historique central commence à l’activation du module côté Supabase et notifier. « Accepté » signifie que Gmail ou Resend a accepté la demande d’envoi, pas que le client l’a reçu ou lu.</p>'+
      (lignes.length ? lignes.slice(0,200).map(e=>
        '<div class="devis-gestion-row">'+
          '<div class="dv-top"><b>'+ech(e.sujet || "Message")+'</b><span class="dv-status">'+
          (e.statut==="accepte"?"✅ Accepté":"❌ Échec")+'</span></div>'+
          '<p class="dv-meta">'+ech(dateHeure(e.cree_le))+' · '+ech(e.destinataire || "")+
          ' · '+ech(e.fournisseur === "gmail"?"Gmail":"Resend")+
          ' · '+ech(e.canal === "client"?"Client":"Équipe/administration")+'</p>'+
          (e.code_erreur?'<p class="hint">⚠️ '+ech(e.code_erreur)+'</p>':"")+
        '</div>').join("") : '<p class="hint" style="text-align:center;padding:20px">Aucun envoi enregistré pour ces filtres.</p>');
  }
  const personnel = e => e.equipe || [];
  function calculMensuel(mois) {
    const data=api.donnees() || {evenements:[],bilans:[],depenses:[]};
    const maintenant=jour();
    const e=data.evenements.filter(x=>String(x.date).startsWith(mois) &&
      x.statut!=="annule" && !x.nuit);
    const planifies=e.filter(x=>["confirme","termine"].includes(x.statut) && x.type_evenement==="animation" && !x.interne);
    const faits=planifies.filter(x=>x.date<=maintenant);
    const idFaits=new Set(faits.map(x=>String(x.id)));
    const bilans=data.bilans.filter(b=>idFaits.has(String(b.evenement_id)));
    const satisfaction=bilans.filter(b=>["ravi","content","moyen","mecontent"].includes(b.humeur));
    const positifs=satisfaction.filter(b=>["ravi","content"].includes(b.humeur)).length;
    const incident=bilans.filter(b=>b.incident||["moyen","mecontent"].includes(b.humeur));
    const perso=new Map();
    faits.forEach(x=>personnel(x).forEach(p=>{
      if(!p.role || /^(acc|accompagn)/i.test(p.role))return;
      perso.set(p.role,(perso.get(p.role)||0)+1);
    }));
    const tops=[...perso.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3);
    return {
      mois, faits, planifies, bilans,positifs,satisfaction,incident,tops,
      caPrevu:planifies.reduce((a,x)=>a+(+x.ca||0),0),
      encaisse:planifies.reduce((a,x)=>a+(+x.encaisse||0),0),
      paie:faits.reduce((a,x)=>a+(+x.paie||0),0),
      depenses:data.depenses.filter(x=>String(x.date||"").startsWith(mois)).reduce((a,x)=>a+(+x.montant||0),0),
      sansBilan:faits.filter(x=>!x.bilanPresent).length
    };
  }
  let resumeCourant="";
  function renderMensuel(){
    if(!api.autorise())return;
    const mois=$("gMagiqueMois").value||moisCourant();
    const d=calculMensuel(mois);
    const titre=new Date(mois+"-02T12:00:00").toLocaleDateString("fr-BE",{month:"long",year:"numeric"});
    const taux=d.satisfaction.length?Math.round(d.positifs/d.satisfaction.length*100):null;
    resumeCourant = "✨ Fantasy Kids Events — Bilan "+titre+"\n"+
      "Prestations réalisées : "+d.faits.length+"\n"+
      "Chiffre d'affaires prévu (confirmations du mois) : "+eur(d.caPrevu)+"\n"+
      "Encaissements enregistrés : "+eur(d.encaisse)+"\n"+
      "Défraiements des prestations réalisées : "+eur(d.paie)+"\n"+
      "Dépenses enregistrées : "+eur(d.depenses)+"\n"+
      "Satisfaction positive parmi les bilans notés : "+(taux===null?"Non mesurable":taux+" %")+
      " ("+d.positifs+"/"+d.satisfaction.length+")\n"+
      "Incidents ou retours à vérifier : "+d.incident.length+"\n"+
      "Bilans manquants : "+d.sansBilan+"\n"+
      "Personnages les plus sollicités : "+(d.tops.map(([k,v])=>k+" ("+v+")").join(", ")||"Aucun")+
      "\nChiffres issus des données saisies dans Fantasy App ; il ne s'agit pas d'un bilan comptable.";
    $("gMagiqueContenu").innerHTML =
      '<div style="text-align:center;padding:13px 4px"><h3>✦ Le journal magique de '+ech(titre)+' ✦</h3>'+
      '<p class="hint">Une vue mensuelle des animations confirmées et des bilans reçus, sans extrapoler les données manquantes.</p></div>'+
      '<div class="row" style="gap:8px;flex-wrap:wrap">'+
        kpi(d.faits.length,"Prestations réalisées")+
        kpi(eur(d.caPrevu),"CA prévu / prestations confirmées")+
        kpi(eur(d.encaisse),"Encaissements déclarés")+
        kpi(taux===null?"—":taux+" %","Satisfaction positive")+'</div>'+
      '<div class="devis-gestion-row"><b>💰 Repères financiers</b>'+
        '<p class="hint">Les chiffres ci-dessous sont des montants enregistrés, pas un bénéfice comptable.</p>'+
        '<p>👥 Défraiements des prestations effectuées : <b>'+ech(eur(d.paie))+'</b></p>'+
        '<p>🧾 Dépenses du mois : <b>'+ech(eur(d.depenses))+'</b></p>'+
        '<p>📝 '+d.sansBilan+' bilan(s) manquant(s) pour les prestations réalisées</p></div>'+
      '<div class="devis-gestion-row"><b>🎭 Sur les scènes et les anniversaires</b>'+
        '<p>'+d.planifies.length+' animation(s) confirmée(s) sur le mois, dont '+d.faits.length+' déjà effectuée(s).</p>'+
        '<p>⭐ Personnages les plus sollicités : '+(d.tops.length?d.tops.map(([k,v])=>ech(k)+" ("+v+")").join(" · "):"Pas encore de données")+'</p></div>'+
      '<div class="devis-gestion-row"><b>💜 Satisfaction et attention aux clients</b>'+
        '<p>'+d.positifs+' retour(s) positif(s) sur '+d.satisfaction.length+' bilan(s) avec une humeur renseignée.</p>'+
        '<p>⚠️ '+d.incident.length+' incident(s) ou retour(s) à vérifier.</p>'+
        '<p class="hint">Les bilans sans humeur ne sont pas comptés comme avis positifs ou négatifs.</p></div>';
  }
  function rafraichir() {
    if (!api.autorise()) return;
    if (vue==="gardien") renderGardien();
    else if(vue==="incidents") renderIncidents();
    else if(vue==="emails") renderEmails();
    else if(vue==="mensuel") renderMensuel();
  }
  Object.entries(boutons).forEach(([type,id])=>$(id).addEventListener("click",async()=>{
    if(!api.autorise())return;
    vue=type;
    $(panels[type]).classList.remove("hidden");
    $(panels[type]).scrollIntoView({behavior:"smooth",block:"start"});
    if(type==="mensuel")renderMensuel();
    else{
      $(type==="gardien"?"gGardienContenu":type==="incidents"?"gIncidentsContenu":"gEmailsContenu").textContent="✨ Vérification des données…";
      await charger();
    }
  }));
  Object.values(panels).forEach(id=>{
    const fermer=$(id).querySelector("[data-quality-fermer]");
    if(fermer)fermer.addEventListener("click",()=>$(id).classList.add("hidden"));
  });
  ["gIncidentsFiltre","gIncidentsSearch","gEmailsFiltre","gEmailsSearch","gMagiqueMois"].forEach(id=>
    $(id).addEventListener(id.includes("Search")?"input":"change",rafraichir));
  ["gGardienRefresh","gIncidentsRefresh","gEmailsRefresh"].forEach(id=>
    $(id).addEventListener("click",()=>charger()));
  $("gMagiqueCopier").addEventListener("click",()=>{
    if(!api.autorise())return;
    try{navigator.clipboard.writeText(resumeCourant).then(()=>{$("gMagiqueCopier").textContent="✅ Copié";}).catch(()=>prompt("Copiez votre bilan :",resumeCourant));}
    catch(e){prompt("Copiez votre bilan :",resumeCourant);}
  });
  document.addEventListener("click",async e=>{
    const evt=e.target.closest("[data-quality-ev]");
    if(evt && api.autorise()){api.ouvrirFiche(evt.dataset.qualityEv);return;}
    const resolution=e.target.closest("[data-diag-resoudre]");
    if(resolution && api.autorise()) {
      resolution.disabled=true;
      try{await api.resoudreDiagnostic(resolution.dataset.diagResoudre);await charger();}
      catch(err){alert("Enregistrement impossible : "+(err.message||err));resolution.disabled=false;}
      return;
    }
    const enregistrer=e.target.closest("[data-inc-save]");
    if(enregistrer&&api.autorise()) {
      const zone=enregistrer.closest("[data-suivi-id]"),id=zone?.dataset.suiviId;
      const signal=signalements().find(s=>String(s.bilan.id)===id);
      if(!zone||!signal)return;
      enregistrer.disabled=true;
      try {
        await api.enregistrerIncident({
          bilan_id:id,evenement_id:String(signal.bilan.evenement_id),
          statut:zone.querySelector("[data-inc-etat]").value,
          responsable:zone.querySelector("[data-inc-personne]").value.trim().slice(0,100),
          action_prevue:zone.querySelector("[data-inc-note]").value.trim().slice(0,2000)
        });
        await charger();
      } catch(err){alert("Suivi non enregistré : "+(err.message||err));enregistrer.disabled=false;}
    }
  });
  // Journal limité et dédoublonné des erreurs non traitées du navigateur.
  // Ni URL, ni pile d'appel, ni données de formulaire ne sont enregistrées.
  const deja=new Set();let comptes=0;
  function rapporter(categorie,message) {
    if(comptes>=6)return;
    let m=String(message || "Erreur JavaScript inconnue")
      .replace(/https?:\/\/\S+/g,"[url]")
      .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,"[email]")
      .replace(/(?:bearer|token|apikey|api_key)[=: ]+\S+/gi,"[secret]")
      .slice(0,220);
    if(!m || deja.has(categorie+":"+m))return;
    deja.add(categorie+":"+m);comptes++;
    api.signalerErreur(categorie,m).catch(()=>{});
  }
  window.addEventListener("error", e=>{if(e.error||e.message)rapporter("javascript",e.message||"Erreur JavaScript");});
  window.addEventListener("unhandledrejection",e=>{
    rapporter("promesse",e.reason?.message||"Promesse rejetée dans l'application");
  });
  $("gMagiqueMois").value=moisCourant();
})();