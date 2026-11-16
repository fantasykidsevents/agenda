/* Tests du moteur pur — node test-fantasy-match.cjs */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

let src = fs.readFileSync(path.join(__dirname,'fantasy-match.js'),'utf8');
const end = /\n  init\(\)\.catch\(err=>\{[\s\S]*?\}\);\n\}\)\(\);\s*$/;
assert.match(src,end,'Point d’entrée reconnu');
src = src.replace(end,`\n  globalThis.__fmTest = {levelConfig,findMatches,hasPossibleMove,freshBoard,isNeighbor,matchBonus,expandSpecials,kindOf,specialOf};\n})();`);
const sandbox = {Math,Date,Set,Array,Number,String,Object,Map,console};
vm.runInNewContext(src,sandbox,{filename:'fantasy-match.js'});
const {levelConfig,findMatches,hasPossibleMove,freshBoard,isNeighbor,matchBonus,expandSpecials,kindOf,specialOf} = sandbox.__fmTest;

assert.equal(levelConfig(1).world,0);
assert.equal(levelConfig(20).world,0);
assert.equal(levelConfig(21).world,1);
assert.equal(levelConfig(100).world,4);
for(let n=1;n<=100;n++){
  const l=levelConfig(n);
  assert.equal(l.number,n);
  assert.ok(l.moves>=19 && l.moves<=35,`Coups incohérents au niveau ${n}`);
  assert.ok(l.target>=7 && l.target<=35,`Objectif incohérent au niveau ${n}`);
}
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

console.log('Fantasy Match : 100 niveaux, 100 plateaux, combos de 4/5, bombes et réactions en chaîne validés.');
