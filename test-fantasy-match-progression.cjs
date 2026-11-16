/* Non-régression : conservation du niveau même à zéro vie, reprise et sauvegarde cloud. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

let src = fs.readFileSync(path.join(__dirname, 'fantasy-match.js'), 'utf8');
const entry = /\n  init\(\)\.catch\(err=>\{[\s\S]*?\}\);\n\}\)\(\);\s*$/;
assert.match(src, entry);
src = src.replace(entry, `
  globalThis.testFM = {
    setState: input => { state = input; ensureState(); },
    getState: () => state,
    startRound, loseLevel, mergeProgress
  };
})();`);

const elements = new Map();
function element(id) {
  if (!elements.has(id)) {
    const names = new Set(['hidden']);
    elements.set(id, {
      id, innerHTML:'', textContent:'', style:{width:''}, dataset:{},
      classList:{add: name => names.add(name),remove:name => names.delete(name),
        contains:name => names.has(name),toggle:name => names.has(name) ? names.delete(name) : names.add(name)},
      appendChild(){}, addEventListener(){}, disabled:false
    });
  }
  return elements.get(id);
}
const storage = new Map();
const ctx = {
  Date, Math, Set, Array, Number, String, Object, Map, console,
  document: {getElementById:element,querySelector:element,createElement:()=>element('button')},
  localStorage: {getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  setTimeout,clearTimeout
};
vm.runInNewContext(src,ctx,{filename:'fantasy-match.js'});
const {setState,getState,startRound,loseLevel,mergeProgress} = ctx.testFM;

// Un joueur au niveau 17 sans vies doit VOIR le niveau 17, pas le « 1 » du HTML.
setState({level:17,maxUnlocked:17,lives:0,nextLifeAt:Date.now()+1800000,
  score:350,levels:{16:3},bestScores:{16:230},boosters:{color:3,bomb:3,shuffle:3}});
startRound();
assert.equal(element('levelValue').textContent,17,'L’affichage conserve le niveau courant même sans vie');
assert.equal(getState().level,17,'Le niveau sauvegardé reste inchangé');
assert.ok(!element('boardOverlay').classList.contains('hidden'),'Le plateau est verrouillé sans vies');
assert.match(element('dialogContent').innerHTML,/niveau 17/,'Le message confirme le niveau conservé');
assert.match(element('gameBoard').innerHTML,/disabled/,'Le joueur ne peut plus jouer sans vie');
assert.equal(JSON.parse(storage.get('fantasy_match_demo_v1')).level,17,'La sauvegarde locale garde le niveau');

// Au retour d’une vie, on joue au même niveau.
getState().lives=1;
startRound(getState().level);
assert.equal(element('levelValue').textContent,17,'La reprise ouvre le même niveau');
assert.ok(element('boardOverlay').classList.contains('hidden'),'Le plateau se débloque');
assert.doesNotMatch(element('gameBoard').innerHTML,/disabled/,'Les cases sont jouables');

// Perdre sa dernière vie ne doit pas modifier le niveau.
loseLevel();
assert.equal(getState().lives,0);
assert.equal(getState().level,17);
assert.equal(element('levelValue').textContent,17);
assert.ok(!element('boardOverlay').classList.contains('hidden'));

// Une sauvegarde cloud plus récente mais incomplète ne peut pas faire revenir au niveau 1.
const local = {level:17,maxUnlocked:17,score:350,levels:{16:3},bestScores:{16:230},updatedAt:100};
const oldCloud = {level:1,maxUnlocked:1,score:10,lives:0,levels:{1:2},updatedAt:200};
const joined = mergeProgress(local,oldCloud,200);
assert.equal(joined.level,17);
assert.equal(joined.maxUnlocked,17);
assert.equal(joined.lives,0,'Les vies récentes restent synchronisées');
assert.equal(joined.score,350);
assert.equal(joined.levels[16],3);
assert.equal(joined.levels[1],2);
const furtherCloud = mergeProgress(local,{level:26,maxUnlocked:26,score:920,levels:{25:3}},300);
assert.equal(furtherCloud.level,26,'Les nouveaux niveaux joués sur un autre appareil sont conservés');
assert.equal(furtherCloud.maxUnlocked,26);

console.log('✅ Fantasy Match : niveau conservé sans vies, reprise au même niveau et cloud anti-retour au niveau 1.');
