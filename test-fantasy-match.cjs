/* Tests du moteur pur — node test-fantasy-match.cjs */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

let src = fs.readFileSync(path.join(__dirname,'fantasy-match.js'),'utf8');
const end = /\n  init\(\)\.catch\(err=>\{[\s\S]*?\}\);\n\}\)\(\);\s*$/;
assert.match(src,end,'Point d’entrée reconnu');
src = src.replace(end,`\n  globalThis.__fmTest = {levelConfig,iceCellsForLevel,findMatches,hasPossibleMove,freshBoard,isNeighbor,matchBonus,matchEffect,expandSpecials,kindOf,specialOf,specialSwapTargets,bestBombCenter};\n})();`);
const sandbox = {Math,Date,Set,Array,Number,String,Object,Map,console};
vm.runInNewContext(src,sandbox,{filename:'fantasy-match.js'});
const {levelConfig,iceCellsForLevel,findMatches,hasPossibleMove,freshBoard,isNeighbor,matchBonus,matchEffect,expandSpecials,kindOf,specialOf,specialSwapTargets,bestBombCenter} = sandbox.__fmTest;

assert.equal(levelConfig(1).world,0);
assert.equal(levelConfig(20).world,0);
assert.equal(levelConfig(21).world,1);
assert.equal(levelConfig(100).world,4);
assert.equal(levelConfig(101).world,5);
assert.equal(levelConfig(200).world,9);
assert.equal(levelConfig(110).mode,'combo','Le niveau 110 exige de fusionner deux bonus');
assert.equal(levelConfig(104).mode,'seal','Les nouveaux mondes ajoutent des sceaux');
for(let n=101;n<=200;n++){
  const l=levelConfig(n);
  assert.ok(l.moves>=14 && l.target>0,'Chapitre 2 : objectif et coups valides au niveau '+n);
  if(l.mode==='ice')assert.equal(iceCellsForLevel(n,l.target).size,l.target);
}
for(let n=1;n<=100;n++){
  const l=levelConfig(n);
  assert.equal(l.number,n);
  assert.ok(l.moves>=16 && l.moves<=28,`Coups incohérents au niveau ${n}`);
  assert.ok(l.target>0,`Objectif incohérent au niveau ${n}`);
  if(l.mode==='duo')assert.equal(l.target,Object.values(l.targets).reduce((a,b)=>a+b,0));
  if(l.mode==='ice')assert.equal(iceCellsForLevel(n,l.target).size,l.target);
}
assert.deepEqual([1,2,3,4,5].map(n=>levelConfig(n).mode),['collect','duo','ice','score','special']);
assert.notEqual(levelConfig(1).goal,levelConfig(6).goal);
const adultStages=[1,6,16,31,51].map(n=>levelConfig(n));
for(let i=1;i<adultStages.length;i++){
  assert.ok(adultStages[i].moves<adultStages[i-1].moves,'Chaque palier adulte doit avoir moins de coups');
  assert.ok(adultStages[i].target/adultStages[i].moves>adultStages[i-1].target/adultStages[i-1].moves,'Chaque palier adulte doit exiger davantage par coup');
}
assert.ok(levelConfig(10).boss && levelConfig(10).target>levelConfig(5).target,'Le niveau 10 doit être un défi');
for(let i=0;i<100;i++){
  const b=freshBoard();
  assert.equal(b.length,64);
  assert.equal(findMatches(b).size,0,'Un plateau ne doit pas débuter avec un match');
  assert.ok(hasPossibleMove(b),'Chaque plateau doit proposer au moins un coup');
}
const testBoard=Array(64).fill(null);testBoard[0]=testBoard[1]=testBoard[2]='star';
assert.deepEqual([...findMatches(testBoard)].sort((a,b)=>a-b),[0,1,2]);
assert.equal(isNeighbor(0,1),true);
assert.equal(isNeighbor(0,8),true);
assert.equal(isNeighbor(7,8),false);
assert.equal(isNeighbor(56,64),false);

// 4 pièces alignées : fusée horizontale ou verticale.
const four=Array(64).fill(null);
for(const i of [8,9,10,11])four[i]='star';
assert.equal(matchBonus(four,findMatches(four),10).value,'star|lineH');
assert.equal(matchBonus(four,findMatches(four),10).index,10);
const vertical=Array(64).fill(null);
for(const i of [2,10,18,26])vertical[i]='rose';
assert.equal(matchBonus(vertical,findMatches(vertical),18).value,'rose|lineV');

// 5 pièces et L/T : arc-en-ciel et bombe de zone.
const five=Array(64).fill(null);
for(const i of [16,17,18,19,20])five[i]='crown';
assert.equal(matchBonus(five,findMatches(five),19).value,'rainbow|color');
const rainbowEffect=matchEffect(five,findMatches(five),19,true);
assert.equal(rainbowEffect.bonus.index,19);
assert.equal(rainbowEffect.bonus.value,'rainbow|color');
assert.equal(rainbowEffect.removed.size,4,'Cinq symboles doivent laisser un arc-en-ciel sur la grille');
assert.ok(!rainbowEffect.removed.has(19),'Le bonus créé ne doit jamais être supprimé par le match');
const cross=Array(64).fill(null);
for(const i of [1,9,17,8,10])cross[i]='wand';
assert.equal(matchBonus(cross,findMatches(cross),9).value,'wand|bomb');

// Les bonbons spéciaux explosent et déclenchent les autres bonus touchés.
const line=Array(64).fill('rose');line[19]='crystal|lineH';
assert.equal(expandSpecials(line,new Set([19])).size,8);
const blast=Array(64).fill('star');blast[27]='wand|bomb';
assert.deepEqual([...expandSpecials(blast,new Set([27]))].sort((a,b)=>a-b),[18,19,20,26,27,28,34,35,36]);
const chain=Array(64).fill('snow');chain[19]='star|lineH';chain[21]='rose|bomb';
assert.equal(expandSpecials(chain,new Set([19])).size,14);
assert.equal(kindOf('rose|lineV'),'rose');
assert.equal(specialOf('rose|lineV'),'lineV');

// Une bombe créée est utilisable dès qu'on l'échange avec une pièce ordinaire.
const playableBomb=Array(64).fill('snow');playableBomb[28]='wand|bomb';playableBomb[27]='rose';
const bombUse=specialSwapTargets(playableBomb,27,28);
assert.ok(bombUse?.has(28),'La bombe doit se déclencher lors de son échange avec une pièce simple');
assert.equal(expandSpecials(playableBomb,bombUse).size,9);
const playableLine=Array(64).fill('rose');playableLine[5]='crown|lineH';
assert.ok(specialSwapTargets(playableLine,4,5)?.has(5),'Le bonus de 4 doit aussi être utilisable');
const playableRainbow=Array(64).fill('snow');playableRainbow[10]='rainbow|color';playableRainbow[11]='rose';playableRainbow[14]='rose';
assert.ok(specialSwapTargets(playableRainbow,10,11).has(14),'L’arc-en-ciel doit sélectionner toute une couleur');
const fusion=Array(64).fill('rose');fusion[27]='star|lineH';fusion[28]='wand|bomb';
const doubleSpecial=specialSwapTargets(fusion,27,28);
assert.ok(doubleSpecial.combo,'Deux bonus voisins doivent fusionner');
assert.ok(doubleSpecial.size>=24,'Une fusion doit produire un vrai effet de zone');
assert.ok(specialSwapTargets(playableBomb,27,28).combo===false,'Un bonus + pièce simple n’est pas une fusion');
const autoBoard=Array(64).fill('rose');
for(const i of [27,28,29,35,36,37,43,44,45])autoBoard[i]='star';
assert.equal(bestBombCenter(autoBoard,'star'),36,'La bombe du bas doit viser automatiquement le meilleur groupe');

console.log('Fantasy Match : niveaux, plateaux, combos, bombes créées et bonus instantanés validés.');
