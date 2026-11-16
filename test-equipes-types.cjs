// Vérifie les équipes types sans connexion à Supabase et sans modifier l'agenda.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('  // 👥 Équipes types partagées');
const end = html.indexOf('  // ---------- 🎪 Événement', start);
assert(start !== -1 && end > start, 'Code des équipes types introuvable');

const listeners = {};
const ids = ['teamPresetSel', 'teamPresetApply', 'teamPresetDelete', 'teamPresetName', 'teamPresetSave'];
const elements = Object.fromEntries(ids.map(id => [id, {
  value: '',
  disabled: false,
  addEventListener(event, callback) { listeners[`${id}:${event}`] = callback; },
}]));
let store = JSON.stringify([
  { id: 'night', nom: 'La Nuit Magique', membres: [
    { nom: 'Emma', role: 'Ariel' }, { nom: 'Loïc', role: 'Peter Pan' }, { nom: 'Parti', role: 'acc' },
  ] },
]);
const picked = [{ nom: 'Emma', role: 'Ariel' }];
let syncs = 0;
const notices = [];
const context = vm.createContext({
  $: id => elements[id],
  reglages: { equipes_types: store },
  members: [{ prenom: 'Emma' }, { prenom: 'Loïc' }, { prenom: 'Jordan' }],
  picked,
  normName: s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
  esc: s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
  isGest: () => true,
  estEvt: () => true,
  toast: s => notices.push(s),
  confirm: () => true,
  syncAnim: () => syncs++,
  renderPicked: () => {},
  regStore: { async set(data) { store = data.equipes_types; } },
});
vm.runInContext(html.slice(start, end), context);

(async () => {
  vm.runInContext('renderEquipesTypes()', context);
  elements.teamPresetSel.value = 'night';
  listeners['teamPresetApply:click']();
  assert.equal(picked.length, 2, 'N’ajoute pas un membre déjà choisi ou absent');
  assert.equal(picked[1].nom, 'Loïc');
  assert.equal(picked[1].role, 'Peter Pan', 'Conserve les rôles');
  assert.equal(syncs, 1, 'Synchronise le formulaire');
  assert.match(notices.at(-1), /1 hors équipe/);

  picked.push({ nom: 'Jordan', role: 'Technique / son' });
  elements.teamPresetName.value = 'Technique Fantasy';
  await listeners['teamPresetSave:click']();
  const saved = JSON.parse(store);
  assert.equal(saved.length, 2, 'Conserve les équipes précédentes');
  assert.deepEqual(saved.find(x => x.nom === 'Technique Fantasy').membres.map(x => x.nom), ['Emma', 'Loïc', 'Jordan']);

  elements.teamPresetSel.value = saved.find(x => x.nom === 'Technique Fantasy').id;
  await listeners['teamPresetDelete:click']();
  assert.equal(JSON.parse(store).length, 1, 'Supprime uniquement l’équipe choisie');
  console.log('Équipes types : ajout groupé, doublons, rôles, sauvegarde et suppression validés.');
})().catch(err => { console.error(err); process.exitCode = 1; });
