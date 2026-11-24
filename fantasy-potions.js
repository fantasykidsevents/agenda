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
  {name:'Magie',color:'#f487fa',dark:'#b22ae8',mark:'✧'}
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
function colorsFor(n){return n<=8?3:n<=25?4:n<=55?5:n<=85?6:n<=120?7:8}
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
  return b.reduce((n,t)=>n+(t.length>1?new Set(t).size-1:0),0);
}
// Départ rangé, puis mouvements inverses réversibles.
// Chaque mouvement inversé peut être rejoué dans les règles normales du jeu,
// ce qui garantit qu'un chemin de solution existe à chaque niveau.
function generate(n){
  const count=colorsFor(n), empties=n<=100?2:1, seed=(0x52f4d1+n*9631)|0;
  const rnd=randSeed(seed), attempts=38, steps=Math.min(118,22+Math.floor(n*.6)+count*5);
  let best=null,bestMix=-1;
  for(let trial=0;trial<attempts;trial++){
    const b=Array.from({length:count},(_,i)=>Array(CAP).fill(i));
    for(let i=0;i<empties;i++)b.push([]);
    let previous=null;
    for(let step=0;step<steps;step++){
      const candidates=[];
      for(let src=0;src<b.length;src++){
        const tube=b[src];if(!tube.length)continue;
        const c=tube[tube.length-1];
        if(tube.length>1 && tube[tube.length-2]!==c)continue;
        for(let dest=0;dest<b.length;dest++){
          if(src===dest||b[dest].length>=CAP)continue;
          const dst=b[dest],different=dst.length && dst[dst.length-1]!==c;
          // Écarter les déplacements qui annulent simplement le coup précédent.
          if(previous && previous[0]===dest && previous[1]===src)continue;
          const rating=(different?13:0)+(dst.length?4:0)+(tube.length===CAP?2:0)+rnd()*7;
          candidates.push([src,dest,rating]);
        }
      }
      if(!candidates.length)break;
      candidates.sort((a,b)=>b[2]-a[2]);
      const maxTop=Math.min(candidates.length,5);
      const [src,dst]=candidates[Math.floor(rnd()*maxTop)];
      b[dst].push(b[src].pop());
      previous=[src,dst];
    }
    const mixed=mixedness(b),puzzle=shuffled(b,rnd);
    if(mixed>bestMix){best=puzzle;bestMix=mixed;}
    if(mixed>=Math.max(3,count+1))return puzzle;
  }
  return best;
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
function gemHtml(g){
  const v=GEMS[g];
  return '<span class="gem" style="--gem:'+v.color+';--gem-dark:'+v.dark+'"><span class="gem-mark" aria-hidden="true">'+v.mark+'</span></span>';
}
function render(){
  if(!state)return;
  const c=state.current;
  if(!c)return;
  $('levelValue').textContent=state.level;
  $('scoreValue').textContent=fmt(state.score);
  $('movesValue').textContent=c.moves;
  $('goalValue').textContent=colorsFor(state.level);
  const w=worldFor(state.level),world=WORLDS[w];
  document.body.dataset.chapter=String(w+1);
  $('chapterValue').textContent=(w+1)+' / 5';
  $('worldName').textContent=world.name;
  $('worldDesc').textContent=world.desc;
  $('worldGlyph').textContent=world.icon;
  $('worldProgress').textContent=(state.level-w*30)+' / 30';
  const b=c.board;
  $('bottles').innerHTML=b.map((tube,i)=>{
    const complete=tube.length===CAP&&tube.every(x=>x===tube[0]);
    const classes=['bottle',i===selected?'selected':'',hintPair&&hintPair[0]===i?'hint-src':'',hintPair&&hintPair[1]===i?'hint-dst':'',complete?'complete':''].filter(Boolean).join(' ');
    const parts=tube.map(gemHtml).join('');
    const label='Fiole '+(i+1)+', '+(tube.length?tube.length+' gouttes, au-dessus : '+GEMS[top(tube)].name:'vide')+(complete?', complète':'');
    return '<button type="button" class="'+classes+'" data-tube="'+i+'" aria-label="'+escapeHtml(label)+'" aria-pressed="'+(selected===i)+'" title="'+escapeHtml(label)+'">'+parts+'</button>';
  }).join('');
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
  message('Bravo ! Continue ton mélange magique ✨');
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
  const count=colorsFor(n);
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
  const html='<p style="font-size:30px;color:#f5b525">'+('★'.repeat(answer.stars))+('☆'.repeat(3-answer.stars))+'</p>'+
    '<p>Bravo '+escapeHtml(playerName)+' ! Tu as réussi le niveau <b>'+n+'</b> en '+moves+' coup'+(moves>1?'s':'')+'.</p>'+
    '<p>✨ Score du niveau : <b>'+fmt(answer.points)+'</b> pts<br>🏆 Nouveau bonus ajouté : <b>+'+fmt(gain)+'</b> pts</p>'+
    '<p>'+ (completed?'Tu as terminé les 150 niveaux ! 👑':'Le prochain défi magique est débloqué !')+'</p>';
  openModal(completed?'Maître des potions !':'Potion réussie !','🏆',html,[
    {label:completed?'Rejouer le dernier niveau':'Niveau suivant ✨',action:()=>{
      closeModal();busy=false;startLevel(state.level,true);
    }}
  ],'win');
}
function openModal(title,icon,body,actions,type){
  lastModalType=type||'info';
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
function showLevels(){
  const body='<div class="chapters">'+WORLDS.map((w,i)=>{
    const start=i*30+1;
    const buttons=Array.from({length:30},(_,j)=>{
      const n=start+j,locked=n>state.unlocked,passed=!!state.wins[n];
      const cls=locked?'locked':state.level===n?'now':passed?'passed':'';
      return '<button type="button" data-go="'+n+'" class="'+cls+'"'+(locked?' disabled':'')+'>'+ (passed?'★ ':locked?'🔒 ':'') +n+'</button>';
    }).join('');
    return '<div class="chapter"><h3>'+w.icon+' '+escapeHtml(w.name)+' <small>· '+start+'–'+(start+29)+'</small></h3><div class="level-grid">'+buttons+'</div></div>';
  }).join('')+'</div>';
  openModal('Mes 150 niveaux','🗺️',body,[{label:'Retour au jeu',action:closeModal}],'levels');
  $('modalBody').querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>{
    const n=Number(b.dataset.go);
    closeModal();startLevel(n,true);
  }));
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
  $('levelsBtn').addEventListener('click',showLevels);
  $('mapBtn').addEventListener('click',showLevels);
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
