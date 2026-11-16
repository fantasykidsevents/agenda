/* Vérifications des attributions exactes : node test-costumes-attributions.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const debut = html.indexOf('  const persoDe = (c) =>');
const fin = html.indexOf('  // Écran « Costumes »', debut);
assert.ok(debut > 0 && fin > debut, 'Fonctions de gestion des costumes introuvables');

const e1 = { id: 'ev1', date: '2030-12-12', heure_debut: '10:00', heure_fin: '11:00',
  animateurs: 'Cyrielle (Elsa)', statut: 'confirme' };
const e2 = { id: 'ev2', date: '2030-12-12', heure_debut: '11:15', heure_fin: '12:00',
  animateurs: 'Emma (Elsa)', statut: 'confirme' };
const e3 = { id: 'ev3', date: '2030-12-12', heure_debut: '16:00', heure_fin: '17:00',
  animateurs: 'Emma (Elsa)', statut: 'confirme' };
const costumes = [
  { id: 'robe01', personnage: 'Elsa', type: 'costume', nom: 'Robe Elsa couronnement', chez: 'stock', etat: 'ok' },
  { id: 'robe02', personnage: 'Elsa', type: 'costume', nom: 'Robe Elsa hiver', chez: 'stock', etat: 'ok' },
  { id: 'robe03', personnage: 'Elsa', type: 'costume', nom: 'Robe Elsa de Cyrielle', chez: 'Cyrielle', proprietaire: 'Cyrielle', etat: 'ok' },
  { id: 'wig01', personnage: 'Elsa', type: 'perruque', nom: 'Perruque Elsa', chez: 'stock', etat: 'laver' },
];
let costAttributions = [
  { evenement_id: 'ev1', membre: 'Cyrielle', personnage: 'Elsa', type: 'costume', costume_id: 'robe03' },
  { evenement_id: 'ev1', membre: 'Cyrielle', personnage: 'Elsa', type: 'perruque', costume_id: 'wig01' },
  { evenement_id: 'ev2', membre: 'Emma', personnage: 'Elsa', type: 'costume', costume_id: 'robe01' },
];
const contexte = {
  costumes, costAttributions, events: [e1, e2, e3], costAttributionsOK: true, STOCK: 'stock',
  TYPES: { costume: ['👗', 'Costume'], perruque: ['💇', 'Perruque'] },
  ETATS: { ok: ['✅', 'Prêt'], laver: ['🧺', 'À laver'] },
  normName: s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
  typeDe: c => c.type === 'perruque' ? 'perruque' : 'costume',
  etatDe: c => c.etat || 'ok',
  nomDe: c => c.nom,
  etatTxt: c => c.etat,
  costDe: (role, type) => costumes.filter(c => c.personnage === role && (!type || c.type === type)),
  parseTeam: str => (str || '').split(',').map(x => x.trim()).filter(Boolean).map(x => {
    const m = x.match(/^(.*?)\s*\((.*)\)\s*$/); return m ? { nom: m[1].trim(), role: m[2].trim() } : { nom: x, role: '' };
  }),
  estRoleCostume: p => !!p.role && p.role !== 'acc',
  todayISO: () => '2030-12-01',
  demandePour: () => null,
};
const api = vm.runInNewContext(`${html.slice(debut, fin)}\n({ utilisable, attributionPour, pieceAttribuee, conflitsPiece, besoinsCostumes })`, contexte);
const roleC = { nom: 'Cyrielle', role: 'Elsa' }, roleE = { nom: 'Emma', role: 'Elsa' };

assert.equal(api.pieceAttribuee(e1, roleC, 'costume').id, 'robe03', 'Seule la robe exacte de Cyrielle est retenue');
assert.equal(api.pieceAttribuee(e1, roleC, 'perruque').id, 'wig01', 'La perruque est indépendante');
assert.equal(api.utilisable(costumes[2], 'Emma'), false, 'Le costume personnel ne peut pas être prêté');
assert.equal(api.besoinsCostumes(e1).length, 2, 'Une robe et une perruque, pas les trois robes Elsa');
assert.equal(api.besoinsCostumes(e1).find(x => x.type === 'perruque').pret, false, 'La perruque sale est signalée');
assert.equal(api.conflitsPiece(e1, costumes[0]).length, 1, 'Même pièce à deux horaires chevauchants détectée');

contexte.costAttributions[0].costume_id = 'robe01';
assert.match(api.besoinsCostumes(e1).find(x => x.type === 'costume').conflit, /réservé/, 'Le conflit est visible');
contexte.costAttributions[0].costume_id = 'robe03';
contexte.costAttributions[2].costume_id = 'robe03';
assert.equal(api.pieceAttribuee(e2, roleE, 'costume'), null, 'Aucune attribution invalide d’une pièce personnelle à Emma');
contexte.costAttributions.splice(2, 1);
assert.match(api.besoinsCostumes(e2).find(x => x.type === 'costume').conflit, /à attribuer/, 'Sans choix, pas de robe supposée');

console.log('✅ Attribution exacte, pièces personnelles, état, conflits et absence de choix : OK');
