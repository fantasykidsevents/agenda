/* Tests du moteur pur — node test-fantasy-match.cjs */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

let src = fs.readFileSync(path.join(__dirname,'fantasy-match.js'),'utf8');
const end = /\n  init\(\)\.catch\(err=>\{[\s\S]*?\}\);\n\}\)\(\);\s*$/;
assert.match(src,end,'Point d’entrée reconnu');
src = src.replace(end,`\n  globalThis.__fmTest = {levelConfig,findMatches,hasPossibleMove,freshBoard,isNeighbor};\n})();`);
const sandbox = {Math,Date,Set,Array,Number,String,Object,Map,console};
vm.runInNewContext(src,sandbox,{filename:'fantasy-match.js'});
const {levelConfig,findMatches,hasPossibleMove,freshBoard,isNeighbor} = sandbox.__fmTest;

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
console.log('Fantasy Match : 100 niveaux, 100 plateaux et coups adjacents validés.');
