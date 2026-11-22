// Gestion → Bilans : vue en lecture seule des bilans déjà enregistrés.
(function () {
  "use strict";
  const api = window.__fkBilansGestion;
  if (!api) return;
  const $ = id => document.getElementById(id);
  const escape = s => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[c]);
  const humeurs = { ravi:"😍 Ravi", content:"🙂 Content", moyen:"😐 Moyen", mecontent:"😟 Mécontent" };
  const today = () => new Date().toLocaleDateString("sv-SE");
  const dateFmt = date => {
    if (!date) return "Date inconnue";
    const d = new Date(date + "T12:00:00");
    return isNaN(+d) ? escape(date) : escape(d.toLocaleDateString("fr-BE", {day:"numeric",month:"long",year:"numeric"}));
  };
  const prestationFinie = e => {
    const now = new Date(), jour = today();
    if (!e.date || e.date > jour) return false;
    if (e.date < jour || e.statut === "termine") return true;
    const h = String(e.heure_fin || "").slice(0,5);
    return /^\d{2}:\d{2}$/.test(h) && new Date(e.date + "T" + h + ":00") <= now;
  };
  const statutDe = rapports => !rapports.length ? "manquants" :
    rapports.some(b => b.incident || ["moyen","mecontent"].includes(b.humeur)) ? "verifier" : "recus";
  function chargerLignes() {
    return api.lire().filter(e => e.rapports.length ||
      (["confirme","termine"].includes(e.statut) && prestationFinie(e)))
      .map(e => ({...e, type:statutDe(e.rapports)}))
      .sort((a,b) => ({verifier:0,manquants:1,recus:2})[a.type] -
        ({verifier:0,manquants:1,recus:2})[b.type] || b.date.localeCompare(a.date));
  }
  function render() {
    if (!api.autorise()) { $("gBilansPanel").classList.add("hidden"); return; }
    const q = $("gBilansSearch").value.trim().toLocaleLowerCase("fr");
    const mois = $("gBilansMonth").value, filtre = $("gBilansFilter").value;
    const source = chargerLignes().filter(e => (!mois || e.date.startsWith(mois)) &&
      (!q || [e.titre,e.enfant,e.parent,e.theme,e.animateurs,
        ...e.rapports.flatMap(b => [b.auteur,b.texte])].join(" ").toLocaleLowerCase("fr").includes(q)));
    const nb = type => source.filter(e => e.type === type).length;
    const lignes = source.filter(e => filtre === "tous" || e.type === filtre);
    $("gBilansSummary").innerHTML =
      '<div class="row" style="gap:8px;flex-wrap:wrap">' +
      '<div class="mine-head" style="flex:1;min-width:85px;text-align:center;margin:0;padding:10px"><b>📝 ' + nb("manquants") + '</b><small style="display:block">Manquants</small></div>' +
      '<div class="mine-head" style="flex:1;min-width:85px;text-align:center;margin:0;padding:10px"><b>⚠️ ' + nb("verifier") + '</b><small style="display:block">À vérifier</small></div>' +
      '<div class="mine-head" style="flex:1;min-width:85px;text-align:center;margin:0;padding:10px"><b>✅ ' + nb("recus") + '</b><small style="display:block">Reçus</small></div>' +
      '</div><p class="hint" style="margin:7px 0">' + lignes.length + ' prestation(s) affichée(s). Les futures demandes et les annulations ne sont pas considérées comme manquantes.</p>';
    $("gBilansList").innerHTML = lignes.length ? lignes.map(e => {
      const badge = {manquants:"📝 Manquant",verifier:"⚠️ À vérifier",recus:"✅ Reçu"}[e.type];
      const nom = e.titre || e.enfant || "Animation";
      const rapports = e.rapports.length ?
        '<details style="margin:10px 0"><summary>Consulter le bilan (' + e.rapports.length + ')</summary>' +
        e.rapports.map(b => '<div class="bilan' + (b.incident ? ' inc' : '') + '" style="margin:8px 0">' +
          '<b>' + escape(b.auteur || "Membre de l'équipe") + '</b>' +
          (humeurs[b.humeur] ? ' · ' + escape(humeurs[b.humeur]) : '') +
          (b.incident ? ' · <b style="color:#b4123c">⚠️ Incident</b>' : '') +
          (b.texte ? '<p style="white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0">' + escape(b.texte) + '</p>' : '') +
          '<small>' + escape(b.created_at ? new Date(b.created_at).toLocaleDateString("fr-BE") : "") + '</small></div>').join("") +
        '</details>' : '<p class="hint" style="margin:8px 0">Aucun bilan reçu pour cette prestation.</p>';
      return '<div class="devis-gestion-row">' +
        '<div class="dv-top"><b>🎭 ' + escape(nom) + '</b><span class="dv-status">' + badge + '</span></div>' +
        '<div class="dv-meta">📅 ' + dateFmt(e.date) +
          (e.parent ? ' · Client : ' + escape(e.parent) : '') +
          (e.enfant ? ' · Enfant : ' + escape(e.enfant) : '') +
        '</div>' + (e.animateurs ? '<small>👥 ' + escape(e.animateurs) + '</small>' : '') +
        rapports + '<div class="dv-actions"><button class="sig" type="button" data-bilans-ouvrir="' + escape(e.id) +
          '">📂 Ouvrir la fiche</button></div></div>';
    }).join("") : '<p class="hint" style="text-align:center;padding:14px">✨ Aucun bilan correspondant à ces filtres.</p>';
  }
  $("gBilans").addEventListener("click", () => {
    if (!api.autorise()) return;
    $("gBilansPanel").classList.remove("hidden");
    render();
    $("gBilansPanel").scrollIntoView({behavior:"smooth",block:"start"});
  });
  $("gBilansClose").addEventListener("click", () => $("gBilansPanel").classList.add("hidden"));
  $("gBilansSearch").addEventListener("input", render);
  $("gBilansMonth").addEventListener("change", render);
  $("gBilansFilter").addEventListener("change", render);
  $("gBilansList").addEventListener("click", e => {
    const b = e.target.closest("[data-bilans-ouvrir]");
    if (b && api.autorise()) api.ouvrir(b.dataset.bilansOuvrir);
  });
  $("gBilansRefresh").addEventListener("click", async () => {
    if (!api.autorise()) return;
    const b = $("gBilansRefresh"); b.disabled = true;
    try { await api.actualiser(); render(); }
    catch (e) { $("gBilansList").textContent = "⚠️ Impossible d'actualiser : " + (e.message || e); }
    finally { b.disabled = false; }
  });
})();
