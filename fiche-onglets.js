/* Fantasy App — fiches claires, onglets non destructifs (v1) */
(function () {
  "use strict";
  const TAB_LIST = [
    ["resume", "✨ Résumé"],
    ["client", "👤 Client"],
    ["animation", "🎭 Animation"],
    ["finances", "💶 Finances"],
    ["suivi", "📸 Suivi"]
  ];
  function init() {
    const form = document.getElementById("evForm");
    const sheet = document.getElementById("sheetBg");
    const heading = document.getElementById("formTitle");
    if (!form || !sheet || !heading || document.getElementById("ficheTabs")) return;
    const style = document.createElement("style");
    style.textContent = `
      #ficheTabs { display:flex; gap:7px; overflow-x:auto; overscroll-behavior-x:contain; padding:5px 1px 10px; margin:5px 0 6px; scrollbar-width:thin; }
      #ficheTabs button { flex:0 0 auto; border:1px solid #d9c9ed; background:#fff; color:#55316e; padding:10px 13px; border-radius:13px; font-size:13px; font-weight:800; cursor:pointer; white-space:nowrap; }
      #ficheTabs button[aria-selected="true"] { color:#fff; background:linear-gradient(125deg,#7944cc,#bd55be); border-color:#7944cc; box-shadow:0 3px 10px #723da733; }
      #ficheResume { border:1px solid #e1d2f5; background:linear-gradient(120deg,#f8f5ff,#f1f9ff); padding:12px 14px; border-radius:15px; margin:9px 0 9px; color:#3d285b; }
      #ficheResume .fr-heading {font-weight:900; font-size:16px; margin-bottom:5px;}
      #ficheResume .fr-meta {font-size:13px; line-height:1.65; overflow-wrap:anywhere;}
      #ficheResume .fr-state {display:inline-block; font-size:11px; font-weight:800; background:#fff; padding:3px 8px; border-radius:30px; margin-left:5px;}
      #evForm > .fiche-tab-off {display:none !important;}
      #evForm > .actions {position:sticky; bottom:0; z-index:5; background:var(--bg,#fff); border-top:1px solid #e7daf1; padding:10px 0 max(10px,env(safe-area-inset-bottom)); margin-top:12px;}
      @media(max-width:600px) {#ficheTabs {margin-left:-2px;margin-right:-2px} #ficheTabs button {padding:10px 12px;font-size:12px} #ficheResume{padding:11px}}
    `;
    document.head.appendChild(style);
    const summary = document.createElement("div");
    summary.id = "ficheResume";
    summary.setAttribute("aria-live", "polite");
    heading.insertAdjacentElement("afterend", summary);
    const nav = document.createElement("nav");
    nav.id = "ficheTabs";
    nav.setAttribute("aria-label", "Rubriques de la fiche");
    summary.insertAdjacentElement("afterend", nav);
    TAB_LIST.forEach(([key,label]) => {
      const b=document.createElement("button");
      b.type="button"; b.dataset.ficheTab=key; b.textContent=label;
      b.setAttribute("aria-selected", "false");
      b.addEventListener("click",()=>select(key));
      nav.appendChild(b);
    });

    const topChild = id => {
      let n = document.getElementById(id);
      if (!n || !form.contains(n)) return null;
      while (n.parentElement !== form) n = n.parentElement;
      return n;
    };
    function range(first,last,section) {
      const a=topChild(first),b=topChild(last);
      if (!a || !b) return;
      let active=false;
      for (const el of Array.from(form.children)) {
        if (el === a) active=true;
        if (active) el.dataset.ficheSection=section;
        if (el === b) break;
      }
    }
    const firstParty = Array.from(form.children).find(el => el.classList.contains("sec") && el.textContent.trim()==="La fête");
    if(firstParty) firstParty.id="fichePartyStart";
    range("collerBox","collerRes","client");
    range("fichePartyStart","themesList","animation");
    range("adresse","proClientTva","client");
    range("themeBox","monTrajet","animation");
    range("parent","ficheBox","client");
    range("optSec","optSec","animation");
    range("privSec","devisBox","finances");
    range("solde","site_affichage","finances");
    range("enceinteSeg","materiel_manquant","animation");
    range("notesLabel","proNotesHint","animation");
    range("jourBtnBox","afterBox","suivi");
    // La date, le titre, le statut et les actions restent disponibles au résumé.
    Array.from(form.children).forEach(el => {
      if(!el.dataset.ficheSection && el !== summary && el !== nav) el.dataset.ficheSection="resume";
    });
    for(const id of ["formErr"]) {const el=topChild(id); if(el) el.dataset.ficheSection="always";}
    const buttons = form.querySelector(":scope > .actions");
    if(buttons) buttons.dataset.ficheSection="always";
    let current="resume";
    function select(key) {
      current=key;
      Array.from(form.children).forEach(el=>{
        const sec=el.dataset.ficheSection;
        if(sec) el.classList.toggle("fiche-tab-off", sec!=="always" && sec!==key);
      });
      nav.querySelectorAll("button").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.ficheTab===key)));
      if (key==="resume") updateSummary();
      const scroller=form;
      if(scroller.scrollTop>100) scroller.scrollTo({top:0,behavior:"instant"});
    }
    const get=id=>document.getElementById(id)?.value?.trim() || "";
    const safe=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    function updateSummary() {
      const title=get("titre") || get("enfant") || "Nouvelle prestation";
      const date=get("date");
      let printable=date;
      if(/^\d{4}-\d\d-\d\d$/.test(date)){
        const [y,m,d]=date.split("-").map(Number);
        printable=new Intl.DateTimeFormat("fr-BE",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date(y,m-1,d,12));
      }
      const horaire=[get("heure_debut"),get("heure_fin")].filter(Boolean).join(" – ");
      const type=get("type_evenement");
      const formule=get("theme");
      const pers=get("personnages_client");
      const state=document.getElementById("statut");
      const statut=state?.selectedOptions?.[0]?.textContent || "";
      const segments=[printable,horaire,formule,pers].filter(Boolean);
      summary.innerHTML='<div class="fr-heading">✨ '+safe(title)+'<span class="fr-state">'+safe(statut || "À compléter")+'</span></div><div class="fr-meta">'+
        (segments.length?segments.map(s=>safe(s)).join(" · "):"Complète la date et les informations essentielles dans cet onglet.")+
        '</div><div class="fr-meta" style="margin-top:4px;opacity:.75">'+(type==="contrat_pro"?"💼 Contrat professionnel":type==="evenement"?"🎪 Événement":type==="repetition"?"🎭 Répétition":"🎂 Animation")+'</div>';
    }
    form.addEventListener("input",e=>{if(["titre","date","heure_debut","heure_fin","theme","personnages_client","enfant"].includes(e.target.id))updateSummary();});
    form.addEventListener("change",e=>{if(["statut","type_evenement"].includes(e.target.id))updateSummary();});
    form.addEventListener("focusin",e=>{
      let n=e.target;
      while(n && n.parentElement!==form) n=n.parentElement;
      if(n?.dataset?.ficheSection && n.dataset.ficheSection!=="always" && n.dataset.ficheSection!==current)
        select(n.dataset.ficheSection);
    });
    // Actualiser le résumé après chaque ouverture de fiche, sans toucher aux données.
    const observer=new MutationObserver(()=>{
      if(!sheet.classList.contains("hidden")){
        select("resume");
        requestAnimationFrame(updateSummary);
      }
    });
    observer.observe(sheet,{attributes:true,attributeFilter:["class"]});
    select("resume");
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init);
  else init();
})();