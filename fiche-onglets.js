/* Fiches Fantasy v3 — onglets simples, champs conservés à leur place. */
(function () {
"use strict";
function init() {
  const form=document.getElementById("evForm");
  const bg=document.getElementById("sheetBg");
  const heading=document.getElementById("formTitle");
  if(!form||!bg||!heading||document.getElementById("ficheTabs"))return;
  const top=id=>{
    let el=document.getElementById(id);
    if(!el||!form.contains(el))return null;
    while(el.parentElement!==form)el=el.parentElement;
    return el;
  };
  const all=Array.from(form.children);
  const mark=(first,last,tab)=>{
    const a=top(first),b=top(last);
    if(!a||!b)return false;
    const i=all.indexOf(a),j=all.indexOf(b);
    if(i<0||j<i)return false;
    for(let k=i;k<=j;k++)all[k].dataset.ficheTabSection=tab;
    return true;
  };
  const blocks=[
    ["collerBox","collerRes","client"],
    ["fichePartyStart","themesList","animation"],
    ["adresseLbl","proClientTva","client"],
    ["themeBox","monTrajet","animation"],
    ["parent","ficheBox","client"],
    ["optSec","optSec","finances"],
    ["privSec","devisBox","finances"],
    ["solde","site_affichage","finances"],
    ["enceinteSeg","materiel_manquant","animation"],
    ["notesLabel","proNotesHint","animation"],
    ["afterBox","afterBox","suivi"]
  ];
  const fete=all.find(e=>e.classList.contains("sec")&&e.textContent.trim()==="La fête");
  if(fete)fete.id="fichePartyStart";
  // Une répartition explicite : jamais de grande plage accidentelle sur les autres champs.
  for(const [first,last,tab] of blocks)mark(first,last,tab);
  const status=top("statut");
  if(status)status.dataset.ficheTabSection="resume";
  const anticipation=top("anticipationFiche");
  if(anticipation)anticipation.dataset.ficheTabSection="resume";
  for(const el of all)if(!el.dataset.ficheTabSection)el.dataset.ficheTabSection="resume";
  // Toutes les actions globales restent visibles quel que soit l'onglet.
  for(const id of ["formTitle","formErr","jourBtnBox"]){
    const el=top(id);if(el)el.dataset.ficheTabSection="always";
  }
  const actions=form.querySelector(":scope > .actions");
  if(actions)actions.dataset.ficheTabSection="always";
  const style=document.createElement("style");
  style.textContent=`
    #ficheTabs{display:flex;gap:7px;overflow-x:auto;padding:8px 1px 12px;margin:3px 0 10px;scrollbar-width:thin;position:sticky;top:0;z-index:8;background:var(--bg,#fff)}
    #ficheTabs button{flex:0 0 auto;border:1px solid #d8c6ea;background:#fff;color:#603881;border-radius:12px;padding:10px 13px;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap}
    #ficheTabs button[aria-selected="true"]{background:#7544bb;color:#fff;border-color:#7544bb}
    #evForm > [data-fiche-tab-section][data-fiche-hidden="yes"]{display:none!important}
    #ficheResume{border-radius:13px;border:1px solid #e0d0ee;background:#f7f3ff;padding:10px 12px;margin:7px 0;font-size:13px;line-height:1.5;color:#513376}
    #evForm > .actions{position:sticky;bottom:0;z-index:7;background:var(--bg,#fff);padding:10px 0 max(10px,env(safe-area-inset-bottom));border-top:1px solid #e8dcec}
    @media(max-width:600px){#ficheTabs button{font-size:12px;padding:9px 11px}}
  `;
  document.head.appendChild(style);
  const resume=document.createElement("div");resume.id="ficheResume";
  heading.insertAdjacentElement("afterend",resume);
  const nav=document.createElement("nav");nav.id="ficheTabs";nav.setAttribute("aria-label","Rubriques de la fiche");
  resume.insertAdjacentElement("afterend",nav);
  let current="resume";
  const labels=[["resume","📋 Essentiel"],["client","👤 Client"],["animation","🎭 Animation"],["finances","💶 Finances"],["suivi","📸 Suivi"]];
  for(const [id,label] of labels){
    const button=document.createElement("button");button.type="button";button.dataset.ficheTab=id;button.textContent=label;
    button.addEventListener("click",()=>select(id));nav.appendChild(button);
  }
  function value(id){return document.getElementById(id)?.value?.trim()||""}
  function summary(){
    const name=value("titre")||value("enfant")||"Nouvelle fiche";
    const d=value("date"),time=[value("heure_debut"),value("heure_fin")].filter(Boolean).join(" – ");
    const status=document.getElementById("statut")?.selectedOptions?.[0]?.textContent||"";
    // Text-only : ne jamais injecter les valeurs client dans innerHTML.
    resume.textContent=[name,d,time,status].filter(Boolean).join(" · ");
  }
  function select(id){
    current=id;
    for(const el of Array.from(form.children)){
      const section=el.dataset.ficheTabSection;
      if(section)el.dataset.ficheHidden=section!=="always"&&section!==id?"yes":"no";
    }
    for(const button of nav.querySelectorAll("button"))button.setAttribute("aria-selected",String(button.dataset.ficheTab===id));
    summary();
  }
  // Accès direct depuis les actions "photos", "devis" et "bilan".
  function jump(id,focusId){
    select(id);
    const target=focusId?document.getElementById(focusId):null;
    requestAnimationFrame(()=>{
      if(target&&target.getClientRects().length){
        target.closest("details")&&(target.closest("details").open=true);
        target.scrollIntoView({behavior:"smooth",block:"center"});
        if(/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName))target.focus({preventScroll:true});
      }
    });
  }
  window.FantasyFicheTabs={select:jump};
  form.addEventListener("input",summary);
  form.addEventListener("change",summary);
  form.addEventListener("focusin",e=>{
    let el=e.target;
    while(el&&el.parentElement!==form)el=el.parentElement;
    const dest=el?.dataset.ficheTabSection;
    if(dest&&dest!=="always"&&dest!==current)select(dest);
  });
  // Chaque ouverture de la fiche revient à l'essentiel.
  const observer=new MutationObserver(()=>{
    if(!bg.classList.contains("hidden")){select("resume");requestAnimationFrame(summary)}
  });
  observer.observe(bg,{attributes:true,attributeFilter:["class"]});
  select("resume");
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();