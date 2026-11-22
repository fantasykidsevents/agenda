/* Fantasy App — intelligence des fiches v1, sans mutation serveur. */
(function() {
  "use strict";
  const $=id=>document.getElementById(id);
  const safe=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const dateBelge=iso=>iso?new Date(iso).toLocaleDateString("fr-BE",{day:"numeric",month:"long",year:"numeric"}):"—";
  const diffDays=stamp=>stamp?Math.max(0,Math.floor((Date.now()-new Date(stamp).getTime())/86400000)):0;
  const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Brussels",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const validEmail=ev=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(ev.email||""));
  const accepted=d=>!!(d?.accepte_le||d?.reponse_client==="accepte");
  const resolved=d=>accepted(d)||["refuse","modification"].includes(d?.reponse_client);
  function quoteInfo(ev,d) {
    if(ev.statut==="annule"||["confirme","termine"].includes(ev.statut)||ev.date<today())return null;
    if(!d?.envoye_le||resolved(d))return null;
    const days=diffDays(d.relance_le||d.envoye_le);
    return {days,level:days>=5?"relance":days>=3?"rappel":"attente",last:d.relance_le||d.envoye_le};
  }
  const tabFor=id=>({
    email:"client",parent:"client",telephone:"client",adresse:"client",
    prix:"finances",acompte_paye:"finances",devisBox:"finances",statut:"resume",
    addAnim:"animation",evCostAssignBtn:"animation",afterBox:"suivi",fPhotos:"suivi"
  })[id]||"resume";
  function jump(tab,id) {
    tab=tab||tabFor(id);
    const button=document.querySelector('#ficheTabs [data-fiche-tab="'+tab+'"]');
    button?.click();
    if(id) {
      const el=$(id);
      if(el) {
        if(el.closest("details"))el.closest("details").open=true;
        setTimeout(()=>{el.scrollIntoView({behavior:"smooth",block:"center"}); if(["INPUT","TEXTAREA","SELECT"].includes(el.tagName)&&!el.disabled)el.focus({preventScroll:true});},60);
      }
    }
  }
  function ensure() {
    if(!$("ficheResume")||$("fantasyFicheIntelligence"))return;
    const root=document.createElement("div");
    root.id="fantasyFicheIntelligence";
    root.dataset.ficheSection="resume";
    $("ficheResume").insertAdjacentElement("afterend",root);
    const style=document.createElement("style");
    style.textContent=`
      #fantasyFicheIntelligence {display:grid;gap:10px;margin:10px 0 12px}
      #fantasyFicheIntelligence .fi-panel {padding:12px;border-radius:15px;border:1px solid #e1d2f1;background:linear-gradient(110deg,#fffafc,#f6f4ff);color:#4b305c}
      #fantasyFicheIntelligence .fi-title {font-size:14px;font-weight:850;margin-bottom:7px}
      #fantasyFicheIntelligence .fi-text {font-size:13px;line-height:1.55}
      #fantasyFicheIntelligence .fi-actions {display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
      #fantasyFicheIntelligence button {border:1px solid #b68cda;background:#fff;padding:8px 11px;border-radius:11px;font-size:12px;font-weight:800;color:#68358d;cursor:pointer}
      #fantasyFicheIntelligence button.fi-main {background:#753bc2;color:#fff;border-color:#753bc2}
      #fantasyFicheIntelligence .fi-path {display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:6px}
      #fantasyFicheIntelligence .fi-step {padding:8px;border-radius:10px;background:#fff;border:1px solid #e8d9f4;font-size:11px;line-height:1.4}
      #fantasyFicheIntelligence .fi-step b{display:block;font-size:12px}
      #fantasyFicheIntelligence .fi-step.done {background:#eef9f3;border-color:#c5e5d3}
      #fantasyFicheIntelligence .fi-step.pending {background:#fffaec;border-color:#f4e3bb}
      #fantasyFicheIntelligence .fi-lumi {display:flex;gap:9px;align-items:center}
      #fantasyFicheIntelligence .fi-lumi img {width:55px;height:64px;object-fit:contain;flex-shrink:0}
      #fantasyFicheIntelligence textarea {width:100%;min-height:100px;max-width:100%;box-sizing:border-box;margin-top:8px;font-size:13px}
      #fantasyFicheIntelligence .fi-muted {color:#756a7b;font-size:11px;margin-top:6px}
      @media(max-width:480px){#fantasyFicheIntelligence .fi-path{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;
    document.head.appendChild(style);
    root.addEventListener("click",async e=>{
      const b=e.target.closest("button");if(!b)return;
      if(b.dataset.fiJump){jump(b.dataset.fiJump,b.dataset.fiTarget||"");return;}
      if(b.dataset.fiCopy) {
        const t=$("fiRelanceTexte")?.value||"";if(!t)return;
        try{await navigator.clipboard.writeText(t);b.textContent="✅ Message copié";}
        catch(_){const ta=$("fiRelanceTexte");ta?.select();b.textContent="Sélectionne le texte pour le copier";}
      }
      if(b.dataset.fiFollow) {
        $("gDevis")?.click();
        // L'interface devis existante conserve sa confirmation avant tout envoi.
        document.querySelector('.tab[data-view="stats"]')?.click();
      }
    });
    return root;
  }
  function render(ev,devis,options={}) {
    const root=ensure();
    if(!root)return;
    if(!ev||ev.type_evenement!=="animation"||!options.responsable){
      root.replaceChildren();root.hidden=true;return;
    }
    root.hidden=false;
    const quote=quoteInfo(ev,devis);
    const hasTeam=typeof options.teamCount==="number" ? options.teamCount>0 : !!String(ev.animateurs||"").trim();
    const isOver=ev.date<=today()&&["confirme","termine"].includes(ev.statut);
    const anticipate=ev.anticipation&&["anticipee","notifiee","en_attente"].includes(ev.anticipation.statut);
    const issue=devis?.reponse_client;
    let action={title:"✨ Tout est prêt à vérifier",desc:"Consulte les rubriques sans chercher dans toute la fiche.",tab:"resume",target:"statut"};
    if(ev.statut==="annule")action={title:"❌ Réservation annulée",desc:"Aucune relance automatique.",tab:"resume"};
    else if(anticipate)action={title:"💜 Réservation anticipée",desc:"Suivi dans le système d'attente existant. Ne confirme pas prématurément.",tab:"resume",target:"anticipationFiche"};
    else if(ev.statut==="en_attente"&&!validEmail(ev))action={title:"📧 Adresse e-mail manquante",desc:"Complète le contact avant de préparer le devis.",tab:"client",target:"email"};
    else if(ev.statut==="en_attente"&&!(Number(ev.prix)>0))action={title:"💶 Prix à compléter",desc:"Vérifie la formule et le calcul du prix.",tab:"finances",target:"prix"};
    else if(issue==="refuse")action={title:"❌ Devis refusé",desc:"Consulte le motif avant une éventuelle nouvelle proposition.",tab:"finances",target:"devisBox"};
    else if(issue==="modification")action={title:"💬 Modification demandée",desc:"Le client attend une proposition adaptée.",tab:"finances",target:"devisBox"};
    else if(quote&&quote.level!=="attente")action={title:"⏳ Devis sans réponse depuis "+quote.days+" jours",desc:"Prépare une relance, mais garde la décision d'envoi.",tab:"finances",target:"devisBox"};
    else if(ev.statut==="en_attente"&&!devis?.envoye_le)action={title:"📨 Devis à préparer",desc:"Vérifie les montants et les personnages avant l'envoi.",tab:"finances",target:"devisBox"};
    else if(ev.statut==="en_attente")action={title:"📨 En attente du client",desc:"Le devis a été envoyé ; aucune confirmation encore enregistrée.",tab:"finances",target:"devisBox"};
    else if(!hasTeam)action={title:"🎭 Équipe à attribuer",desc:"La réservation est confirmée mais l'équipe doit être vérifiée.",tab:"animation",target:"addAnim"};
    else if(Number(ev.acompte)>0&&!ev.acompte_paye)action={title:"💰 Acompte à vérifier",desc:"Aucun paiement n'est confirmé automatiquement.",tab:"finances",target:"acompte_paye"};
    else if(isOver&&!ev.photos_envoyees)action={title:"📸 Photos à envoyer",desc:"Vérifie d'abord le lien et le destinataire ; l'envoi reste manuel.",tab:"suivi",target:"fPhotos"};
    else if(isOver&&!ev.solde_encaisse)action={title:"💶 Solde à contrôler",desc:"Vérifie la réception réelle avant de valider.",tab:"suivi",target:"fEnc"};
    else if(isOver)action={title:"🏁 Fin de prestation",desc:"Consulte les bilans et les actions après l'animation.",tab:"suivi",target:"afterBox"};
    else if(ev.statut==="confirme")action={title:"👗 Préparer l'animation",desc:"Consulte les tenues et les consignes de l'équipe.",tab:"animation",target:"addAnim"};
    const path=[
      ["Demande",true],
      ["Devis",!!devis?.envoye_le || ["confirme","termine"].includes(ev.statut)],
      ["Accord",accepted(devis)||["confirme","termine"].includes(ev.statut)],
      ["Acompte",!Number(ev.acompte)||!!ev.acompte_paye],
      ["Équipe",hasTeam],
      ["Prestation",ev.statut==="termine"||isOver],
      ["Photos",!!ev.photos_envoyees]
    ];
    const timing=quote&&quote.level!=="attente";
    const client=String(ev.parent||"").replace(/\s*\(.*\)\s*$/,"").trim()||"Madame, Monsieur";
    const relance="Bonjour "+client+",\n\nNous revenons vers vous concernant notre devis pour l'animation du "+dateBelge(ev.date)+". Avez-vous eu l'occasion d'en prendre connaissance ?\n\nNous restons à votre disposition si vous avez une question ou souhaitez une adaptation.\n\nBelle journée !\nL'équipe Fantasy Kids Events";
    const quoteMarkup=timing&&validEmail(ev)?`
      <div class="fi-panel"><div class="fi-title">⏳ Relance conseillée — ${quote.days} jours sans réponse</div>
      <div class="fi-text">Dernier envoi ou relance : ${safe(dateBelge(quote.last))}. Une proposition de message est prête ; rien ne part automatiquement.</div>
      <textarea id="fiRelanceTexte" aria-label="Texte de relance à adapter">${safe(relance)}</textarea>
      <div class="fi-actions"><button type="button" data-fi-copy="1">📋 Copier le texte</button><button type="button" data-fi-jump="finances" data-fi-target="devisBox">📨 Voir le devis</button></div>
      <div class="fi-muted">Le renvoi officiel du devis reste disponible dans Gestion → Devis, avec confirmation avant envoi.</div></div>`:"";
    root.innerHTML=`
      <div class="fi-panel"><div class="fi-title">🪄 Fiche intelligente · prochaine priorité</div><div class="fi-text">${safe(action.title)} — ${safe(action.desc)}</div>
        <div class="fi-actions"><button type="button" class="fi-main" data-fi-jump="${safe(action.tab)}" data-fi-target="${safe(action.target||"")}">Voir l'action</button></div></div>
      <div class="fi-panel"><div class="fi-title">✨ Parcours de la réservation</div><div class="fi-path">${path.map(([title,done])=>`<div class="fi-step ${done?"done":"pending"}"><b>${done?"✅":"○"} ${safe(title)}</b>${done?"Étape renseignée":"À vérifier"}</div>`).join("")}</div>
      <div class="fi-muted">Étapes déduites des données existantes. « À vérifier » ne signifie pas forcément que l'action est en retard.</div></div>
      ${quoteMarkup}
      <div class="fi-panel fi-lumi"><img src="lumi-jour.webp" alt="Lumi" loading="lazy"><div><div class="fi-title">✨ Lumi veille sur cette fiche</div><div class="fi-text">${safe(action.title)}. ${safe(action.desc)}</div>
      <div class="fi-actions"><button type="button" data-fi-jump="${safe(action.tab)}" data-fi-target="${safe(action.target||"")}">🪄 M'y rendre</button></div></div></div>`;
  }
  window.FantasyFicheIntelligence={render,jump};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ensure);else ensure();
})();
