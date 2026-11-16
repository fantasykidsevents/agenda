// Vérifie les teams dans l'onglet Équipe, sans modifier la base Supabase.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('  // 🎭 Teams partagées');
const end = html.indexOf('  // ---------- 🎪 Événement', start);
assert(start !== -1 && end > start, 'Code des teams introuvable');

const listeners = {};
const ids = ['teamPresetSel','teamPresetApply','teamsEditor','teamsEditorSelect','teamsEditorDetails',
  'teamsEditorMembers','teamsEditorCount','teamsEditorNew','teamsEditorEdit','teamsEditorDelete',
  'teamsEditorName','teamsEditorRename','teamsEditorNameSave','teamsEditorNameCancel'];
const elements = Object.fromEntries(ids.map(id => [id, {
  value: '', checked: false, disabled: false, innerHTML: '', textContent: '',
  classList: { add() {}, remove() {}, toggle() {} },
  addEventListener(event, callback) { listeners[`${id}:${event}`] = callback; },
  focus() {},
}]));
let store = JSON.stringify([
  { id: 'night', nom: 'Team Nuit Magique', membres: [
    { nom: 'Emma', role: 'Ariel' }, { nom: 'Loïc', role: 'Peter Pan' }, { nom: 'Parti', role: 'acc' },
  ] },
]);
const picked = [{ nom: 'Emma', role: 'Ariel' }];
let syncs = 0;
const notices = [];
const context = vm.createContext({
  $: id => elements[id],
  reglages: { equipes_types: store },
  members: [{ id:'1',prenom:'Emma' },{ id:'2',prenom:'Loïc' },{ id:'3',prenom:'Jordan' }],
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
  regStore: { async set(data) { store = data.equipes_types; } },
  crypto: { randomUUID: () => 'new-team' },
});
vm.runInContext(html.slice(start, end), context);

(async () => {
  vm.runInContext('renderEquipesTypes()', context);
  elements.teamPresetSel.value = 'night';
  listeners['teamPresetApply:click']();
  assert.equal(picked.length, 2, 'Ne duplique pas un membre déjà choisi');
  assert.equal(picked[1].nom, 'Loïc');
  assert.equal(picked[1].role, 'Peter Pan', 'Conserve les anciens rôles');
  assert.equal(syncs, 1);
  assert.match(notices.at(-1), /1 hors équipe/);

  elements.teamsEditorSelect.value = 'night';
  elements.teamsEditorNew.onclick();
  elements.teamsEditorName.value = 'Team Événements Fantasy';
  await elements.teamsEditorNameSave.onclick();
  assert.equal(JSON.parse(store).length, 2, 'La création conserve les teams existantes');
  assert.equal(JSON.parse(store).find(t => t.id === 'new-team').membres.length, 0, 'Une team peut être créée vide');

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

  elements.teamsEditorSelect.value = 'new-team';
  elements.teamsEditorEdit.onclick();
  elements.teamsEditorName.value = 'Team Fantasy';
  await elements.teamsEditorNameSave.onclick();
  assert.equal(JSON.parse(store).find(t=>t.id==='new-team').nom,'Team Fantasy');

  elements.teamsEditorSelect.value = 'new-team';
  await elements.teamsEditorDelete.onclick();
  assert.equal(JSON.parse(store).length,1,'Supprime seulement la team sélectionnée');
  console.log('✅ Teams : création depuis Équipe, menu, multi-appartenance, import, renommage et suppression OK');
})().catch(err => { console.error(err); process.exitCode = 1; });
