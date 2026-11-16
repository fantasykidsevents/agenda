// Tests de la liste personnelle et de l'édition des fiches de tenues.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const debutListe = html.indexOf('  function renderMesCostumes()');
const finListe = html.indexOf('  // ================= 🎂 Anniversaires', debutListe);
const debutEdit = html.indexOf('  function formulaireEditionCostume(c)');
const finEdit = html.indexOf('  function prochaineUtil(c)', debutEdit);
assert.ok(debutListe > 0 && finListe > debutListe && debutEdit > 0 && finEdit > debutEdit);

const costumes = [
  { id: '1', personnage: 'Rumi', nom: 'Diverses tenues', type: 'costume', proprietaire: 'Océane', chez: 'Océane' },
  { id: '2', personnage: 'Elsa', nom: 'Jaune', type: 'costume', proprietaire: 'Océane', chez: 'Océane' },
];
const myCost = { innerHTML: '', addEventListener() {} };
const ctx = {
  $: () => myCost, costumes, chatMe: () => 'Océane', isResp: () => false,
  persoDe: c => c.proprietaire || '', typeDe: c => c.type,
  TYPES: { costume: ['👗', 'Costume'], perruque: ['💇', 'Perruque'] },
  normName: v => String(v || '').toLowerCase(),
  nomDe: c => c.nom || 'Sans nom', etatDe: () => 'ok', etatTxt: () => '', prochaineUtil: () => '',
  esc: v => String(v ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),
};
const render = vm.runInNewContext(`${html.slice(debutListe, finListe)}\nrenderMesCostumes`, ctx);
render();
assert.match(myCost.innerHTML, /<b>Rumi<\/b> · Diverses tenues/, 'Le personnage apparaît devant le nom');
assert.match(myCost.innerHTML, /<b>Elsa<\/b> · Jaune/, 'Chaque tenue précise son personnage');
assert.equal((myCost.innerHTML.match(/data-my-cost-edit=/g) || []).length, 2, 'Le bouton modifier est visible');

const editCtx = {
  costAttributions: [], PERSONNAGES: { Classiques: ['Elsa', 'Rumi'] },
  pieceLieeAPrestation: id => editCtx.costAttributions.some(a => String(a.costume_id) === String(id)),
  TYPES: ctx.TYPES, typeDe: ctx.typeDe, esc: ctx.esc,
};
const edit = vm.runInNewContext(`${html.slice(debutEdit, finEdit)}\nformulaireEditionCostume`, editCtx);
assert.match(edit(costumes[0]), /name="nom"[^>]+value="Diverses tenues"/, 'Le nom existant est prérempli');
assert.match(edit(costumes[0]), /<option value="Rumi" selected>/, 'Le personnage existant est prérempli');
assert.match(edit(costumes[0]), /value="__autre__"/, 'Un autre personnage peut être précisé');
editCtx.costAttributions.push({ costume_id: '1' });
assert.match(edit(costumes[0]), /name="personnage" required disabled/, 'Rôle verrouillé si attribué');
assert.match(html, /async details\(id, fields\)/, 'La sauvegarde des modifications est disponible');
assert.match(html, /Choisissez d'abord le personnage de cette tenue/, 'Le personnage est exigé à la création');

console.log('✅ Liste avec personnage, édition sans suppression, respect des attributions : OK');
