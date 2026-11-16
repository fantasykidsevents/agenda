// Vérifie les teams dans l'onglet Équipe, sans modifier la base Supabase.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('  // 🎭 Teams partagées');
const end = html.indexOf('  // ---------- 🎪 Événement', start);
assert(start !== -1 && end > start, 'Code des teams introuvable');

const listeners = {};
const ids = ['teamPresetSel','teamPresetSelected','teamsEditor','teamsEditorSelect','teamsEditorDetails',
  'teamsEditorMembers','teamsEditorCount','teamsEditorNew','teamsEditorEdit','teamsEditorDelete',
  'teamsEditorName','teamsEditorRename','teamsEditorNameSave','teamsEditorNameCancel','teamsEditorError',
  'teamsEditorSummary','teamsEditorSummaryText','teamsEditorToggle','teamsEditorDone'];
const elements = Object.fromEntries(ids.map(id => [id, {
  value: '', checked: false, disabled: false, innerHTML: '', textContent: '',
  classList: {
    hidden: false,
    add(x) { if(x==='hidden')this.hidden=true; },
    remove(x) { if(x==='hidden')this.hidden=false; },
    toggle(x,force) { if(x==='hidden')this.hidden=force===undefined?!this.hidden:!!force; },
  },
  addEventListener(event, callback) { listeners[`${id}:${event}`] = callback; },
  setAttribute(name,value) { this[name]=value; },
  focus() {},
}]));
let store = JSON.stringify([
  { id: 'night', nom: 'Team Nuit Magique', membres: [
    { nom: 'Emma', role: 'Ariel' }, { nom: 'Loïc', role: 'Peter Pan' }, { nom: 'Parti', role: 'acc' },
  ] },
]);
const picked = [{ nom: 'Emma', role: 'Ariel' }];
let syncs = 0;
let writeDenied = false;
let ignoreWrite = false;
const notices = [];
const context = vm.createContext({
  $: id => elements[id],
  reglages: { equipes_types: store },
  members: [{ id:'1',prenom:'Emma',email:'emma@example.test' },{ id:'2',prenom:'Loïc',email:'loic@example.test' },{ id:'3',prenom:'Jordan',email:'jordan@example.test' }],
  picked,
  normName: s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
  esc: s => String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),
  isGest: () => true,
  estEvt: () => true,
  toast: s => notices.push(s),
  confirm: () => true,
  syncAnim: () => syncs++,
  renderPicked: () => {},
  renderTeam: () => {},
  regStore: {
    async set(data) { if (writeDenied) throw Object.assign(new Error('new row violates row-level security policy'), { code:'42501' }); if (!ignoreWrite) store = data.equipes_types; },
    async get() { return { equipes_types:store }; },
  },
  crypto: { randomUUID: () => 'new-team' },
});
vm.runInContext(html.slice(start, end), context);

(async () => {
  vm.runInContext('renderTeamsEditor()', context);
  assert.equal(elements.teamsEditorDetails.classList.hidden,true,'Les membres sont repliés par défaut');
  assert.equal(elements.teamsEditorSummary.classList.hidden,false,'Le résumé reste visible');
  vm.runInContext('renderEquipesTypes()', context);
  elements.teamPresetSel.value = 'night';
  listeners['teamPresetSel:change']();
  assert.equal(picked.length, 2, 'Ne duplique pas un membre déjà choisi');
  assert.equal(picked[1].nom, 'Loïc');
  assert.equal(picked[1].role, 'Peter Pan', 'Conserve les anciens rôles');
  assert.equal(syncs, 1);
  assert.match(notices.at(-1), /1 introuvable/);
  assert.match(elements.teamPresetSelected.textContent, /Team Nuit Magique/,'La team choisie reste visible');
  assert.equal(vm.runInContext('eventTeamIds[0]',context),'night','La team est associée à l’événement');
  assert.match(html, /team_ids: eventTeamIds\.slice\(\)/, 'Les IDs des teams sont sauvegardés dans les métadonnées de l’événement');
  assert.match(html, /ev && Array\.isArray\(ev\.km_detail\?\.team_ids\)/, 'La sélection est restaurée à la réouverture');
  assert.match(html, /km_detail: ev\.type_evenement === "evenement" \? \{ mode: "evt", team_ids:/, 'La duplication conserve la team');

  // Le notifier existant déduit les destinataires des prénoms affectés dans
  // animateurs. L'import automatique doit donc donner une nouvelle mission.
  const notifier = fs.readFileSync('notifier-index.ts','utf8');
  const nStart = notifier.indexOf('function quiPrevenir(');
  const nEnd = notifier.indexOf('\nDeno.serve(',nStart);
  assert(nStart>0 && nEnd>nStart,'Logique de notification retrouvée');
  const notifCtx=vm.createContext({
    equipeDe:ev => String(ev?.animateurs||'').split(',').map(s=>s.trim()).filter(Boolean).map(s=>{const m=s.match(/^(.*?)\s*\((.*)\)\s*$/);return m?{nom:m[1],role:m[2]}:{nom:s,role:''};}),
    norm:s=>String(s||'').toLowerCase(),
    CHAMPS_IMPORTANTS:['date','heure_debut','heure_fin','adresse','enceinte'],
  });
  vm.runInContext(notifier.slice(nStart,nEnd),notifCtx);
  const ajouts=vm.runInContext('quiPrevenir("UPDATE", actuel, ancien)',Object.assign(notifCtx,{
    actuel:{animateurs:picked.map(p=>`${p.nom}${p.role?` (${p.role})`:''}`).join(', '),statut:'confirme',date:'2027-03-13'},
    ancien:{animateurs:'Emma (Ariel)',statut:'confirme',date:'2027-03-13'},
  }));
  assert.equal(ajouts.some(a=>a.nom==='Loïc'&&a.type==='nouvelle'),true,'Notifier reconnaît le nouveau membre importé');

  elements.teamsEditorSelect.value = 'night';
  elements.teamsEditorNew.onclick();
  elements.teamsEditorName.value = 'Team Événements Fantasy';
  await elements.teamsEditorNameSave.onclick();
  assert.equal(JSON.parse(store).length, 2, 'La création conserve les teams existantes');
  assert.equal(JSON.parse(store).find(t => t.id === 'new-team').membres.length, 0, 'Une team peut être créée vide');
  assert.equal(elements.teamsEditorDetails.classList.hidden,false,'Une nouvelle team ouvre sa sélection de membres');

  elements.teamsEditorDone.onclick();
  assert.equal(elements.teamsEditorDetails.classList.hidden,true,'Terminer replie la liste');
  elements.teamsEditorToggle.onclick();
  assert.equal(elements.teamsEditorDetails.classList.hidden,false,'Modifier les membres rouvre la liste');

  async function cocher(membreId, checked) {
    const target = { dataset:{teamMember:membreId}, checked, disabled:false,
      closest: sel => sel === '[data-team-member]' ? target : null };
    await listeners['teamsEditorMembers:change']({ target });
  }
  elements.teamsEditorSelect.value = 'new-team';
  await cocher('3',true);
  await cocher('1',true);
  let list = JSON.parse(store);
  assert.deepEqual(list.find(t=>t.id==='new-team').membres.map(m=>m.nom), ['Jordan','Emma']);
  assert.equal(list.find(t=>t.id==='night').membres.some(m=>m.nom==='Emma'),true,'Emma peut appartenir à deux teams');

  elements.teamsEditorSelect.value = 'night';
  await cocher('2',false);
  list=JSON.parse(store);
  assert.equal(list.find(t=>t.id==='night').membres.some(m=>m.nom==='Loïc'),false,'Retire seulement le membre de la team choisie');
  assert.equal(list.find(t=>t.id==='new-team').membres.length,2,'La seconde team reste inchangée');
  listeners['teamsEditorSelect:change']();
  assert.equal(elements.teamsEditorDetails.classList.hidden,true,'Changer de team replie la liste');

  elements.teamsEditorSelect.value = 'new-team';
  elements.teamsEditorEdit.onclick();
  elements.teamsEditorName.value = 'Team Fantasy';
  await elements.teamsEditorNameSave.onclick();
  assert.equal(JSON.parse(store).find(t=>t.id==='new-team').nom,'Team Fantasy');

  elements.teamsEditorSelect.value = 'new-team';
  await elements.teamsEditorDelete.onclick();
  assert.equal(JSON.parse(store).length,1,'Supprime seulement la team sélectionnée');
  elements.teamsEditorNew.onclick();
  elements.teamsEditorName.value='Team test refusée';
  writeDenied=true;
  await elements.teamsEditorNameSave.onclick();
  assert.equal(JSON.parse(store).length,1,'Une erreur Supabase ne crée pas de fausse team');
  assert.match(elements.teamsEditorError.textContent,/correctif SQL/,'L’erreur RLS explique quoi faire');
  writeDenied=false;
  ignoreWrite=true;
  await elements.teamsEditorNameSave.onclick();
  assert.equal(JSON.parse(store).length,1,'Un succès sans persistance ne crée pas de fausse team');
  assert.match(elements.teamsEditorError.textContent,/pas été retrouvée/,'Le code vérifie la persistance');
  ignoreWrite=false;
  await elements.teamsEditorNameSave.onclick();
  assert.equal(JSON.parse(store).length,2,'La sauvegarde peut être retentée après correction');
  console.log('✅ Teams : création depuis Équipe, menu, multi-appartenance, import, renommage et suppression OK');
})().catch(err => { console.error(err); process.exitCode = 1; });
