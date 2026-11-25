/* Fantasy Potions — jeu de tri magique original, indépendant de Fantasy Match. */
(() => {
'use strict';
const MAX_LEVEL=150, CAP=4, GUEST_KEY='fantasy_potions_guest_v1', $=id=>document.getElementById(id);
const WORLDS=[
  {name:'Le Jardin des Potions',desc:"Les premiers secrets de l'alchimie",icon:'🌷'},
  {name:'Le Palais des Cristaux',desc:'Des fioles aux reflets de givre',icon:'❄️'},
  {name:'Le Royaume des Étoiles',desc:'Les mélanges des constellations',icon:'✨'},
  {name:'La Tour des Sortilèges',desc:'Les potions deviennent plus mystérieuses',icon:'🔮'},
  {name:'La Couronne des Lumières',desc:'Le défi ultime des maîtres alchimistes',icon:'👑'}
];
const GEMS=[
  {name:'Rubis',color:'#f8479a',dark:'#c20f72',mark:'♥'},
  {name:'Saphir',color:'#35c4ff',dark:'#2374e7',mark:'✦'},
  {name:'Émeraude',color:'#49d99f',dark:'#129368',mark:'❀'},
  {name:'Améthyste',color:'#bc73ff',dark:'#7436da',mark:'◆'},
  {name:'Or',color:'#ffce55',dark:'#e18a19',mark:'★'},
  {name:'Corail',color:'#ff9361',dark:'#df4564',mark:'✿'},
  {name:'Glace',color:'#a9f6ff',dark:'#3c9ecb',mark:'❄'},
  {name:'Magie',color:'#f487fa',dark:'#b22ae8',mark:'✧'},
  {name:'Grenat',color:'#ff5242',dark:'#b51b22',mark:'♠'},
  {name:'Iolite',color:'#676bff',dark:'#282aa5',mark:'☾'}
];
let sb=null,user=null,playerName='Moi',cloudReady=false,storageKey=GUEST_KEY,state=null,selected=-1,hintPair=null,busy=false,saveTimer=null,syncInFlight=null,lastModalType='';
const copyBoard=b=>b.map(t=>t.slice());
const now=()=>Date.now();
const minMax=(n,a,b)=>Math.min(b,Math.max(a,n));
const defaultState=()=>({level:1,unlocked:1,wins:{},score:0,current:null,updatedAt:0});
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n||0).toLocaleString('fr-BE');
function readLocal(){
  try{return {...defaultState(),...JSON.parse(localStorage.getItem(storageKey)||'{}')}}
  catch{return defaultState()}
}
const worldFor=n=>Math.floor((minMax(n,1,MAX_LEVEL)-1)/30);
function colorsFor(n){return n<=2?3:n<=8?4:n<=20?5:n<=40?6:n<=65?7:n<=90?8:n<=120?9:10}
function randSeed(seed){
  let a=seed|0;
  return ()=>{
    a|=0;a=a+0x6d2b79f5|0;
    let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}
const shuffled=(array,rnd)=>{
  const a=array.slice();
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];
  }
  return a;
};
function mixedness(b){
  return b.reduce((n,t)=>n+(t.length>1?t.slice(1).reduce((a,c,i)=>a+(c!==t[i]?2:0),0)+new Set(t).size-1:0),0);
}
// Every reverse move transfers one top unit and leaves its origin empty or
// topped with that same color. Reversing the entire recorded sequence is legal.
function generate(n,proof=false){
  const count=colorsFor(n),empties=n<=105?2:1,rnd=randSeed((0x52f4d1+n*9631)|0);
  const attempts=n<=2?6:14,steps=Math.min(190,35+Math.floor(n*.85)+count*8);
  let best=null,bestMix=-1,bestSolution=[];
  for(let trial=0;trial<attempts;trial++){
    const b=Array.from({length:count},(_,i)=>Array(CAP).fill(i));
    for(let i=0;i<empties;i++)b.push([]);
    let previous=null,trail=[],seen=new Set([b.map(t=>t.join(',')).join('|')]);
    for(let step=0;step<steps;step++){
      const candidates=[];
      for(let src=0;src<b.length;src++){
        const tube=b[src];if(!tube.length)continue;
        const color=tube[tube.length-1];
        if(tube.length>1&&tube[tube.length-2]!==color)continue;
        for(let dest=0;dest<b.length;dest++){
          if(src===dest||b[dest].length>=CAP||(previous&&previous[0]===dest&&previous[1]===src))continue;
          const dst=b[dest],different=dst.length&&dst[dst.length-1]!==color;
          const rating=(different?16:0)+(dst.length?4:0)+(tube.length===CAP?3:0)+rnd()*12;
          candidates.push([src,dest,rating]);
        }
      }
      if(!candidates.length)break;
      candidates.sort((a,b)=>b[2]-a[2]);
      let found=false;
      for(const [src,dst] of candidates){
        b[dst].push(b[src].pop());
        const key=b.map(t=>t.join(',')).join('|');
        if(seen.has(key)){b[src].push(b[dst].pop());continue;}
        seen.add(key);trail.push([src,dst]);previous=[src,dst];found=true;break;
      }
      if(!found)break;
      const mix=mixedness(b);
      if(mix>bestMix){
        bestMix=mix;best=copyBoard(b);bestSolution=trail.slice().reverse().map(([a,d])=>[d,a]);
      }
    }
  }
  const order=shuffled(best.map((_,i)=>i),rnd),puzzle=order.map(i=>best[i]);
  if(proof)return {board:puzzle,solution:bestSolution.map(([a,d])=>[order.indexOf(a),order.indexOf(d)]),mix:bestMix};
  return puzzle;
}
const solved=b=>b.every(t=>!t.length||(t.length===CAP && t.every(g=>g===t[0])));
const top=b=>b[b.length-1];
const legal=(b,a,c)=>a!==c && a>=0 && c>=0 && a<b.length && c<b.length &&
  b[a].length>0 && b[c].length<CAP && (!b[c].length||top(b[a])===top(b[c]));
function ensureState(){
  if(!state||typeof state!=='object')state=defaultState();
  state.wins=state.wins && typeof state.wins==='object'&&!Array.isArray(state.wins)?state.wins:{};
  state.unlocked=minMax(Number(state.unlocked)||1,1,MAX_LEVEL);
  state.level=minMax(Number(state.level)||state.unlocked,1,state.unlocked);
  state.score=Object.values(state.wins).reduce((sum,v)=>sum+Math.max(0,Number(v||0)),0);
  const c=state.current;
  if(!c||c.level!==state.level||!Array.isArray(c.board)||
      !c.board.every(t=>Array.isArray(t)&&t.length<=CAP&&t.every(g=>Number.isInteger(g)&&g>=0&&g<GEMS.length))){
    state.current={level:state.level,board:generate(state.level),moves:0,undo:[]};
  }else{
    c.moves=Math.max(0,Number(c.moves)||0);
    if(!Array.isArray(c.undo))c.undo=[];
  }
}
function mergeCloud(local,remote){
  const wins={...(remote?.wins||{})};
  for(const [k,v] of Object.entries(local.wins||{}))wins[k]=Math.max(Number(wins[k]||0),Number(v||0));
  const unlocked=minMax(Math.max(Number(local.unlocked||1),Number(remote?.level||1)),1,MAX_LEVEL);
  const preferCloud=Number(remote?.level||1)>Number(local.unlocked||1);
  const level=preferCloud?unlocked:minMax(Number(local.level||unlocked),1,unlocked);
  return {...local,wins,unlocked,level,
    score:Object.values(wins).reduce((s,n)=>s+Math.max(0,Number(n)||0),0),
    current:level===local.level?local.current:null};
}
function scheduleSave(){
  if(!state)return;
  state.updatedAt=now();
  try{localStorage.setItem(storageKey,JSON.stringify(state))}catch(err){console.warn('Fantasy Potions : sauvegarde locale',err)}
  if(!cloudReady||!user)return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>sync(false),850);
}
async function sync(refresh){
  if(!sb||!user||!cloudReady||!state)return false;
  if(syncInFlight)return syncInFlight;
  let snapshotAt=0;
  syncInFlight=(async()=>{
    try{
      if(refresh){
        const{data,error}=await sb.from('fantasy_potions_profiles')
          .select('level,score,wins,updated_at').eq('user_id',user.id).maybeSingle();
        if(error)throw error;
        if(data){
          state=mergeCloud(state,data);ensureState();
          localStorage.setItem(storageKey,JSON.stringify(state));
          render();
        }
      }
      const snapshot={...state,wins:{...state.wins}};
      snapshotAt=Number(snapshot.updatedAt||0);
      const{error}=await sb.from('fantasy_potions_profiles').upsert({
        user_id:user.id,prenom:playerName,level:snapshot.unlocked,
        score:snapshot.score,wins:snapshot.wins,updated_at:new Date().toISOString()
      });
      if(error)throw error;
      $('syncStatus').textContent='✓ Progression synchronisée avec Fantasy';
      return true;
    }catch(err){
      console.warn('Fantasy Potions : synchronisation',err);
      $('syncStatus').textContent='⚠️ Progression conservée sur cet appareil · synchronisation en attente';
      return false;
    }
  })();
  try{return await syncInFlight}finally{
    syncInFlight=null;
    if(snapshotAt && Number(state?.updatedAt||0)>snapshotAt){
      clearTimeout(saveTimer);saveTimer=setTimeout(()=>sync(false),800);
    }
  }
}
async function connectCloud(){
  const cfg=window.APP_CONFIG||{};
  if(!window.supabase||!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY){
    $('syncStatus').textContent='Mode local · connexion nécessaire pour le classement commun';return;
  }
  try{
    sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    const result=await sb.auth.getUser();
    const u=result?.data?.user;
    if(!u){$('syncStatus').textContent='Mode local · connecte-toi à Fantasy App pour le classement';return;}
    user=u;storageKey='fantasy_potions_v1_'+u.id;
    state=readLocal();ensureState();
    try{
      const{data}=await sb.from('equipe').select('prenom').ilike('email',u.email||'').maybeSingle();
      if(data?.prenom)playerName=data.prenom;
    }catch{}
    const{data,error}=await sb.from('fantasy_potions_profiles')
      .select('level,score,wins,updated_at').eq('user_id',u.id).maybeSingle();
    if(error)throw error;
    if(data){state=mergeCloud(state,data);ensureState();}
    cloudReady=true;
    scheduleSave();
    render();
  }catch(err){
    console.warn('Fantasy Potions : mode local',err);
    $('syncStatus').textContent='Progression locale · classement commun momentanément indisponible';
  }
}
function potionSvg(tube,i){
  const p='fp'+i, colors=tube.map((g,k)=>{const gem=GEMS[g];return '<linearGradient id="'+p+'c'+k+'"><stop stop-color="'+gem.dark+'"/><stop offset=".28" stop-color="'+gem.color+'"/><stop offset=".66" stop-color="'+gem.color+'"/><stop offset="1" stop-color="'+gem.dark+'"/></linearGradient>'}).join('');
  const fills=tube.map((g,k)=>{const gem=GEMS[g],y=190-(k+1)*40;return '<g><rect x="10" y="'+y+'" width="44" height="40" fill="url(#'+p+'c'+k+')"/><ellipse cx="32" cy="'+y+'" rx="22" ry="3.8" fill="'+gem.color+'" stroke="#fff" stroke-opacity=".7" stroke-width="1"/><circle cx="23" cy="'+(y+9)+'" r="1.5" fill="#fff" opacity=".7"/><circle cx="41" cy="'+(y+28)+'" r="1.8" fill="#fff" opacity=".5"/><text x="32" y="'+(y+25)+'" font-family="system-ui,sans-serif" font-size="13" text-anchor="middle" fill="#fff" stroke="#20113c" stroke-width=".55" paint-order="stroke">'+gem.mark+'</text></g>'}).join('');
  return '<svg class="potion-art" viewBox="0 0 64 207" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs><clipPath id="'+p+'clip"><path d="M10 13V168Q10 190 32 190Q54 190 54 168V13Z"/></clipPath><linearGradient id="'+p+'glass"><stop stop-color="#e8f7ff" stop-opacity=".7"/><stop offset=".2" stop-color="#fff" stop-opacity=".15"/><stop offset=".52" stop-color="#d8aaff" stop-opacity=".06"/><stop offset=".85" stop-color="#efc9ff" stop-opacity=".2"/><stop offset="1" stop-color="#fff" stop-opacity=".75"/></linearGradient>'+colors+'</defs><ellipse cx="32" cy="198" rx="26" ry="5" fill="#0c032a" opacity=".65"/><path d="M10 13V168Q10 190 32 190Q54 190 54 168V13Z" fill="url(#'+p+'glass)" stroke="#f9eaff" stroke-width="2.5"/><g clip-path="url(#'+p+'clip)">'+fills+'<rect x="10" y="10" width="44" height="185" fill="url(#'+p+'glass)" opacity=".65"/><path d="M16 23V166Q16 176 23 181" fill="none" stroke="#fff" stroke-width="2.6" opacity=".8" stroke-linecap="round"/><path d="M49 27V164" stroke="#fff" stroke-width="1" opacity=".65"/></g><path d="M10 13V168Q10 190 32 190Q54 190 54 168V13" fill="none" stroke="#f8d7ff" stroke-width="1.4"/><ellipse cx="32" cy="13" rx="25" ry="7.5" fill="#38235c" fill-opacity=".7" stroke="#fff" stroke-width="2.8"/><ellipse cx="32" cy="13" rx="19" ry="3.5" fill="#140923" stroke="#caadf8" stroke-width=".8"/><path d="M14 11Q31 3 50 11" stroke="white" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
}
function currentColors(){return state?.current?.board?new Set(state.current.board.flat()).size:colorsFor(state.level)}
function showHome(){closeModal();$('homeScreen').classList.remove('hidden');$('gameScreen').classList.add('hidden');updateHome();window.scrollTo(0,0)}
function showGame(){ $('homeScreen').classList.add('hidden');$('gameScreen').classList.remove('hidden');window.scrollTo(0,0);render(); }
function updateHome(){if(!state)return;$('homeLevel').textContent=state.level;$('homeScore').textContent=fmt(state.score);$('homeWorld').textContent=WORLDS[worldFor(state.level)].name;}
function render(){
  if(!state)return;
  updateHome();
  const c=state.current;
  if(!c)return;
  $('levelValue').textContent=state.level;
  $('scoreValue').textContent=fmt(state.score);
  $('movesValue').textContent=c.moves;
  $('goalValue').textContent=currentColors();
  const w=worldFor(state.level),world=WORLDS[w];
  document.body.dataset.chapter=String(w+1);
  $('chapterValue').textContent=(w+1)+' / 5';
  $('worldName').textContent=world.name;
  $('worldDesc').textContent=world.desc;
  $('worldGlyph').textContent=world.icon;
  $('worldProgress').textContent=(state.level-w*30)+' / 30';
  const b=c.board;
  const tubeMarkup=b.map((tube,i)=>{
    const complete=tube.length===CAP&&tube.every(x=>x===tube[0]);
    const classes=['bottle',i===selected?'selected':'',hintPair&&hintPair[0]===i?'hint-src':'',hintPair&&hintPair[1]===i?'hint-dst':'',complete?'complete':''].filter(Boolean).join(' ');
    const label='Fiole '+(i+1)+', '+(tube.length?tube.length+' gouttes, au-dessus : '+GEMS[top(tube)].name:'vide')+(complete?', complète':'');
    return '<button type="button" class="'+classes+'" data-tube="'+i+'" aria-label="'+escapeHtml(label)+'" aria-pressed="'+(selected===i)+'" title="'+escapeHtml(label)+'">'+potionSvg(tube,i)+'</button>';
  });
  const cols=b.length<=7?b.length:Math.ceil(b.length/2);
  $('bottles').innerHTML=Array.from({length:Math.ceil(b.length/cols)},(_,i)=>'<div class="potion-shelf" style="--cols:'+cols+'">'+tubeMarkup.slice(i*cols,(i+1)*cols).join('')+'</div>').join('');
  const complete=b.filter(t=>t.length===CAP&&t.every(g=>g===t[0])).length;
  $('brewProgress').style.width=Math.round(100*complete/Math.max(1,currentColors()))+'%';
  $('brewProgressText').textContent=complete+' / '+currentColors()+' fioles';
  $('undoBtn').disabled=!c.undo?.length;
}
function message(s){$('message').textContent=s;}
function chooseTube(i){
  if(busy||!state||lastModalType==='win')return;
  const c=state.current,b=c.board;
  if(!b[i])return;
  hintPair=null;
  if(selected===-1){
    if(!b[i].length){message('Cette fiole est vide : commence par une fiole remplie.');return;}
    selected=i;render();message('Maintenant, choisis une fiole vide ou de la même couleur ✨');return;
  }
  if(selected===i){selected=-1;render();message('Sélection annulée.');return;}
  if(!legal(b,selected,i)){
    selected=b[i].length?i:-1;
    render();message('Tu peux verser uniquement dans une fiole vide ou de la même couleur.');return;
  }
  const before=copyBoard(b);
  c.undo.push({board:before,moves:c.moves});
  if(c.undo.length>100)c.undo.shift();
  b[i].push(b[selected].pop());
  selected=-1;c.moves++;
  render();scheduleSave();
  if(solved(b)){win();return}
  message('Lumi : chaque fiole complète te rapproche de la victoire.');
}
function startLevel(n,force=false){
  if(!state||n<1||n>state.unlocked)return;
  selected=-1;hintPair=null;
  state.level=n;
  if(force||!state.current||state.current.level!==n){
    state.current={level:n,board:generate(n),moves:0,undo:[]};
  }
  render();scheduleSave();message('À toi de jouer : trie les potions magiques ! 🧪');
}
function undo(){
  if(!state?.current?.undo?.length)return;
  const prev=state.current.undo.pop();
  state.current.board=prev.board;state.current.moves=prev.moves;
  selected=-1;hintPair=null;render();scheduleSave();message('Un petit retour dans le temps ! ↶');
}
function hint(){
  const b=state.current.board;
  let matches=[],free=[];
  for(let a=0;a<b.length;a++)for(let d=0;d<b.length;d++){
    if(!legal(b,a,d))continue;
    if(b[d].length){
      // Les fioles terminées ne doivent pas être défaites.
      const complete=b[a].length===CAP&&b[a].every(x=>x===b[a][0]);
      if(!complete)matches.push([a,d]);
    }else if(b[a].length>1 && new Set(b[a]).size>1)free.push([a,d]);
  }
  hintPair=matches[0]||free[0]||null;selected=-1;render();
  if(hintPair)message('✨ Essaie de verser de la fiole '+(hintPair[0]+1)+' vers la fiole '+(hintPair[1]+1)+'.');
  else message('✨ Cherche à libérer une fiole : tu peux toujours recommencer ce niveau.');
}
function pointsFor(n,moves){
  const count=currentColors();
  const gold=8+count*6;
  const silver=16+count*10;
  const stars=moves<=gold?3:moves<=silver?2:1;
  const points=500+stars*250+Math.max(0,300-moves*4)+n*7;
  return {stars,points};
}
function win(){
  busy=true;
  const n=state.level,moves=state.current.moves,answer=pointsFor(n,moves);
  const prev=Number(state.wins[n]||0), gain=Math.max(0,answer.points-prev);
  state.wins[n]=Math.max(prev,answer.points);
  state.score=Object.values(state.wins).reduce((s,v)=>s+Math.max(0,Number(v)||0),0);
  state.unlocked=Math.max(state.unlocked,Math.min(MAX_LEVEL,n+1));
  state.level=Math.min(MAX_LEVEL,n+1);
  state.current=null;
  scheduleSave();
  const completed=n===MAX_LEVEL;
  updateHome();
  const html='<div class="victory-stars" aria-label="'+answer.stars+' étoiles sur 3">'+('★'.repeat(answer.stars))+('☆'.repeat(3-answer.stars))+'</div><div class="victory-art"><img class="victory-potion" src="fantasy-potions-victory.svg" alt="Potion arc-en-ciel"><img class="victory-lumi" src="lumi-danse.webp" alt="Lumi fête ta réussite"></div>'+
    '<p>Bravo '+escapeHtml(playerName)+' ! Tu as réussi le niveau <b>'+n+'</b> en '+moves+' coup'+(moves>1?'s':'')+'.</p>'+
    '<p>✨ Score du niveau : <b>'+fmt(answer.points)+'</b> pts<br>🏆 Nouveau bonus ajouté : <b>+'+fmt(gain)+'</b> pts</p>'+
    '<p>'+ (completed?'Tu as terminé les 150 niveaux ! 👑':'Le prochain défi magique est débloqué !')+'</p>';
  openModal(completed?'Maître des potions !':'Potion réussie !','🏆',html,[
    {label:completed?'Rejouer le dernier niveau':'Continuer ▶',action:()=>{
      closeModal();busy=false;startLevel(state.level,true);
    }}
  ],'win');
}
function openModal(title,icon,body,actions,type){
  lastModalType=type||'info';
  $('modal').dataset.type=lastModalType;
  $('modalTitle').textContent=title;
  $('modalIcon').textContent=icon;
  $('modalBody').innerHTML=body;
  $('modalActions').innerHTML='';
  (actions||[{label:'Retour au jeu',action:closeModal}]).forEach((a,i)=>{
    const b=document.createElement('button');b.type='button';b.textContent=a.label;
    if(i>0)b.classList.add('secondary');
    b.addEventListener('click',a.action);$('modalActions').appendChild(b);
  });
  $('modal').classList.remove('hidden');
  $('modalClose').focus();
}
function closeModal(){
  const wasWin=lastModalType==='win';
  lastModalType='';$('modal').classList.add('hidden');
  if(wasWin){busy=false;startLevel(state.level,true)}
}
function showLevels(only=null){
  const body='<div class="chapters">'+WORLDS.map((w,i)=>{
    if(only!==null&&i!==only)return '';
    const start=i*30+1;
    const buttons=Array.from({length:30},(_,j)=>{
      const n=start+j,locked=n>state.unlocked,passed=!!state.wins[n];
      const cls=locked?'locked':state.level===n?'now':passed?'passed':'';
      return '<button type="button" data-go="'+n+'" class="'+cls+'"'+(locked?' disabled':'')+'>'+ (passed?'★ ':locked?'🔒 ':'') +n+'</button>';
    }).join('');
    return '<div class="chapter"><h3>'+w.icon+' '+escapeHtml(w.name)+' <small>· '+start+'–'+(start+29)+'</small></h3><div class="level-grid">'+buttons+'</div></div>';
  }).join('')+'</div>';
  openModal(only===null?'Mes 150 niveaux':WORLDS[only].name,'✦',body,[{label:'Les mondes',action:showWorlds},{label:'Fermer',action:closeModal}],'levels');
  $('modalBody').querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>{
    const n=Number(b.dataset.go);
    closeModal();startLevel(n,n!==state.level);showGame();
  }));
}
function showWorlds(){
  const scenes=[1,2,0,12,4];
  const body='<div class="world-cards">'+WORLDS.map((w,i)=>{const done=Array.from({length:30},(_,j)=>i*30+j+1).filter(n=>state.wins[n]>0).length;return '<button class="world-card" type="button" data-world="'+i+'"><span class="world-illustration" style="--scene:'+scenes[i]/14*100+'%"></span><span class="world-card-copy"><b>'+escapeHtml(w.name)+'</b><small>'+w.icon+' '+done+' / 30 niveaux</small></span></button>'}).join('')+'</div><p class="world-total">5 Mondes ✦ 150 niveaux</p>';
  openModal('Les Mondes','✦',body,[{label:'Retour',action:closeModal}],'worlds');
  $('modalBody').querySelectorAll('[data-world]').forEach(b=>b.addEventListener('click',()=>showLevels(Number(b.dataset.world))));
}
async function showRanking(){
  openModal('Classement des alchimistes','🏆','<p>Chargement du classement de l’équipe…</p>',[{label:'Retour au jeu',action:closeModal}],'ranking');
  if(!sb||!cloudReady||!user){
    $('modalBody').innerHTML='<p>Le classement d’équipe est disponible lorsque tu es connecté à Fantasy App.</p><div class="ranking"><div class="rank-row me"><strong>★</strong><b>'+escapeHtml(playerName)+'</b><small>'+fmt(state.score)+' pts · Niv. '+state.unlocked+'</small></div></div>';
    return;
  }
  try{
    await sync(true);
    const {data,error}=await sb.from('fantasy_potions_profiles')
      .select('user_id,prenom,level,score').order('score',{ascending:false}).limit(50);
    if(error)throw error;
    if(lastModalType!=='ranking')return;
    const rows=(data||[]).map((p,i)=>'<div class="rank-row '+(p.user_id===user.id?'me':'')+'"><strong>'+(i+1)+'.</strong><b>'+escapeHtml(p.prenom||'Membre')+'</b><small>'+fmt(p.score)+' pts · Niv. '+p.level+'</small></div>').join('');
    $('modalBody').innerHTML='<p>Chaque joueur conserve sa progression et son score.</p><div class="ranking">'+(rows||'<p>Aucun joueur pour le moment.</p>')+'</div>';
  }catch(err){
    console.warn('Fantasy Potions classement',err);
    $('modalBody').innerHTML='<p>Le classement est momentanément indisponible. Ta progression reste enregistrée sur ton appareil.</p>';
  }
}
function rules(){
  openModal('Comment jouer ?','🧪',
    '<p><b>Ton objectif :</b> rassembler quatre gouttes de la même couleur dans chaque fiole.</p>'+
    '<p>1. Choisis une fiole remplie.<br>2. Choisis une fiole vide ou dont la goutte du dessus est identique.<br>3. Continue jusqu’à ce que toutes les fioles soient rangées.</p>'+
    '<p>↶ <b>Annuler</b> permet de revenir sur un coup. ✨ <b>Indice</b> suggère un déplacement, sans résoudre automatiquement le niveau.</p>'+
    '<p>150 niveaux, cinq royaumes et un classement <b>indépendant</b> de Fantasy Match. Les niveaux sont construits à partir de mélanges réversibles.</p>',
    [{label:'Jouer !',action:closeModal}],'rules');
}
function events(){
  $('bottles').addEventListener('click',ev=>{
    const b=ev.target.closest('[data-tube]');
    if(b)chooseTube(Number(b.dataset.tube));
  });
  $('undoBtn').addEventListener('click',undo);
  $('hintBtn').addEventListener('click',hint);
  $('resetBtn').addEventListener('click',()=>{
    openModal('Recommencer ce niveau ?','🔄',
      '<p>La fiole reviendra à son état de départ. Tes niveaux débloqués et tes scores resteront conservés.</p>',[
      {label:'Recommencer',action:()=>{closeModal();startLevel(state.level,true)}},
      {label:'Annuler',action:closeModal}
    ],'reset');
  });
  $('helpBtn').addEventListener('click',rules);
  $('levelsBtn').addEventListener('click',()=>showLevels(worldFor(state.level)));
  $('mapBtn').addEventListener('click',showWorlds);
  $('homePlay').addEventListener('click',showGame);
  $('homeMap').addEventListener('click',showWorlds);
  $('homeRanking').addEventListener('click',showRanking);
  $('homeHelp').addEventListener('click',rules);
  $('goHome').addEventListener('click',showHome);
  $('lumiHint').addEventListener('click',hint);
  $('rankingBtn').addEventListener('click',showRanking);
  $('playBtn').addEventListener('click',()=>{closeModal();});
  $('modalClose').addEventListener('click',closeModal);
  $('modal').addEventListener('click',e=>{if(e.target===$('modal'))closeModal()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('modal').classList.contains('hidden'))closeModal()});
  window.addEventListener('online',()=>{if(cloudReady)sync(true)});
  window.addEventListener('focus',()=>{if(cloudReady)sync(true)});
}
async function init(){
  state=readLocal();ensureState();events();render();
  message('Choisis une fiole, puis une autre pour verser ✨');
  await connectCloud();ensureState();render();
}
init().catch(err=>{console.error('Fantasy Potions',err);state ||=defaultState();ensureState();render();$('syncStatus').textContent='Mode local disponible';});
})();
