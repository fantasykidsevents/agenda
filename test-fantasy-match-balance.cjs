/* Diagnostic de difficulté (joueur automatique sans bonus achetés). */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

let src = fs.readFileSync('fantasy-match.js', 'utf8');
const end = /\n  init\(\)\.catch\(err=>\{[\s\S]*?\}\);\n\}\)\(\);\s*$/;
assert.match(src,end);
src = src.replace(end,`\n  globalThis.engine = {levelConfig,iceCellsForLevel,findMatches,freshBoard,hasPossibleMove,matchEffect,specialSwapTargets,kindOf,specialOf};\n})();`);
const sandbox = {Math,Date,Set,Array,Number,String,Object,Map,console};
vm.runInNewContext(src,sandbox);
const {levelConfig,iceCellsForLevel,findMatches,freshBoard,hasPossibleMove,matchEffect,specialSwapTargets,kindOf}=sandbox.engine;
const KINDS=['star','rose','crystal','snow','crown','wand'];

function choose(b,cfg,frozen,remainingByKind){
  const moves=[];
  for(let a=0;a<64;a++)for(const delta of [1,8]){
    const c=a+delta;
    if(c>=64 || delta===1&&Math.floor(a/8)!==Math.floor(c/8))continue;
    const next=b.slice();[next[a],next[c]]=[next[c],next[a]];
    const special=specialSwapTargets(next,a,c),matched=special||findMatches(next);
    if(!matched.size)continue;
    const effect=matchEffect(next,matched,c,!special);
    const removed=[...effect.removed];let score=removed.length*.5;
    if(cfg.mode==='collect')score+=removed.filter(i=>kindOf(next[i])===cfg.goal).length*9;
    if(cfg.mode==='duo')score+=removed.filter(i=>remainingByKind[kindOf(next[i])]>0).length*9;
    if(cfg.mode==='ice')score+=removed.filter(i=>frozen.has(i)).length*12;
    if(cfg.mode==='score')score+=removed.length*5;
    if(cfg.mode==='special')score+=effect.bonus?120:0;
    else if(effect.bonus)score+=9;
    moves.push({a,c,score});
  }
  moves.sort((x,y)=>y.score-x.score);
  return moves.length ? moves[Math.floor(Math.random()*Math.min(moves.length,3))] : null;
}

function collapse(b,removed){
  for(let x=0;x<8;x++){
    const keep=[];
    for(let y=7;y>=0;y--)if(!removed.has(y*8+x))keep.push(b[y*8+x]);
    for(let y=7;y>=0;y--)b[y*8+x]=keep.shift()||KINDS[Math.floor(Math.random()*KINDS.length)];
  }
}
function simulate(n){
  const cfg=levelConfig(n),b=freshBoard(),frozen=cfg.mode==='ice'?iceCellsForLevel(n,cfg.target):new Set();
  const remainingByKind={...cfg.targets};let left=cfg.target,points=0,created=0;
  for(let move=0;move<cfg.moves && left>0;move++){
    const m=choose(b,cfg,frozen,remainingByKind);
    if(!m){b.splice(0,64,...freshBoard());continue;}
    [b[m.a],b[m.c]]=[b[m.c],b[m.a]];
    const special=specialSwapTargets(b,m.a,m.c);
    let matched=special||findMatches(b),preferred=m.c,createBonus=!special,chain=0;
    while(matched.size&&chain<16){
      chain++;
      const {bonus,removed}=matchEffect(b,matched,preferred,createBonus);
      if(cfg.mode==='collect')for(const i of removed)if(kindOf(b[i])===cfg.goal)left--;
      if(cfg.mode==='duo'){
        for(const i of removed){const k=kindOf(b[i]);if(remainingByKind[k]>0)remainingByKind[k]--;}
        left=Object.values(remainingByKind).reduce((sum,x)=>sum+x,0);
      }
      if(cfg.mode==='ice'){for(const i of removed)frozen.delete(i);left=frozen.size;}
      points+=removed.size*10*chain;
      if(cfg.mode==='score')left=cfg.target-points;
      if(bonus){b[bonus.index]=bonus.value;created++;if(cfg.mode==='special')left=cfg.target-created;}
      collapse(b,removed);
      matched=findMatches(b);preferred=-1;createBonus=true;
    }
    if(!hasPossibleMove(b))b.splice(0,64,...freshBoard());
  }
  return left<=0;
}
const picks=process.argv.length>2?process.argv.slice(2).map(Number):[1,2,3,4,5,6,7,8,9,10,16,17,18,19,20,31,32,33,34,35,51,52,53,54,55,76,77,78,79,80,96,97,98,99,100];
const trials=Number(process.env.FM_TRIALS||12);
const summary=picks.map(n=>{
  let wins=0;for(let k=0;k<trials;k++)wins+=simulate(n)?1:0;
  const c=levelConfig(n);return {niveau:n,type:c.mode,coups:c.moves,objectif:c.target,reussite:`${Math.round(wins*100/trials)}%`};
});
console.table(summary);
