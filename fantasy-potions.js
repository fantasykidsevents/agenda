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
function potionSvg(tube,i){
  // La fiole est une véritable illustration SVG : verre, bouchon sculpté,
  // lueurs et liquides magiques. Chaque goutte reste lisible par sa couleur et son signe.
  const layers=tube.map((g,k)=>{
    const gem=GEMS[g],id='potion-'+i+'-'+k;
    const y=189-(k+1)*30;
    return '<linearGradient id="'+id+'" x1="0" y1="0" x2="1" y2=".75">'+
      '<stop offset="0" stop-color="'+gem.dark+'"/>'+
      '<stop offset=".27" stop-color="'+gem.color+'"/>'+
      '<stop offset=".65" stop-color="'+gem.color+'"/>'+
      '<stop offset="1" stop-color="'+gem.dark+'"/></linearGradient>';
  }).join('');
  const fills=tube.map((g,k)=>{
    const gem=GEMS[g],y=189-(k+1)*30;
    const id='potion-'+i+'-'+k;
    return '<g class="potion-layer" style="--potion-color:'+gem.color+'">'+
      '<rect x="9" y="'+y+'" width="91" height="30" fill="url(#'+id+')"/>'+
      '<path d="M9 '+(y+4)+' Q32 '+(y-2)+' 54 '+(y+4)+' T100 '+(y+4)+'" fill="none" stroke="#ffffff90" stroke-width="2.4"/>'+
      '<circle cx="32" cy="'+(y+13)+'" r="2.3" fill="#fff" opacity=".62"/>'+
      '<circle cx="77" cy="'+(y+24)+'" r="1.7" fill="#fff" opacity=".73"/>'+
      '<text x="54" y="'+(y+20)+'" font-family="system-ui,sans-serif" font-size="19" font-weight="1000" text-anchor="middle" fill="#fff" stroke="#35135b" stroke-width=".65" paint-order="stroke fill">'+gem.mark+'</text>'+
      '</g>';
  }).join('');
  const clip='potion-clip-'+i, glass='potion-glass-'+i, gold='potion-gold-'+i;
  const shiny='potion-shine-'+i;
  return '<svg class="potion-art" viewBox="0 0 108 215" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">'+
    '<defs>'+
      '<clipPath id="'+clip+'"><path d="M35 67C32 80 18 85 13 106L9 157Q9 191 32 195H76Q99 191 99 157L95 106C90 85 76 80 73 67Z"/></clipPath>'+
      '<linearGradient id="'+glass+'" x1="0" y1=".1" x2=".95" y2="1">'+
        '<stop offset="0" stop-color="#ffffff" stop-opacity=".84"/>'+
        '<stop offset=".25" stop-color="#d0f9ff" stop-opacity=".24"/>'+
        '<stop offset=".54" stop-color="#ffffff" stop-opacity=".08"/>'+
        '<stop offset=".84" stop-color="#b4b2ff" stop-opacity=".38"/>'+
        '<stop offset="1" stop-color="#f8d7ff" stop-opacity=".72"/>'+
      '</linearGradient>'+
      '<linearGradient id="'+gold+'" x1="0" y1="0" x2=".85" y2="1">'+
        '<stop offset="0" stop-color="#fffdf2"/><stop offset=".25" stop-color="#ffe4a1"/>'+
        '<stop offset=".5" stop-color="#eb9bdb"/><stop offset=".77" stop-color="#c3a0ff"/>'+
        '<stop offset="1" stop-color="#683dc5"/></linearGradient>'+
      '<linearGradient id="'+shiny+'" x1="0" y1="0" x2="1" y2=".9">'+
        '<stop offset="0" stop-color="#fff" stop-opacity=".96"/>'+
        '<stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'+
      layers+
    '</defs>'+
    '<ellipse cx="54" cy="200" rx="33" ry="7" fill="#35245b" opacity=".36"/>'+
    // Glass sculpture and colored magical liquid
    '<path d="M35 67C32 80 18 85 13 106L9 157Q9 191 32 195H76Q99 191 99 157L95 106C90 85 76 80 73 67Z" fill="url(#'+glass+')" stroke="#fff8ed" stroke-width="4"/>'+
    '<g clip-path="url(#'+clip+')">'+fills+
      '<path d="M12 105C19 90 32 82 34 68H74C78 84 91 93 97 106V194H12Z" fill="url(#'+glass+')" opacity=".46"/>'+
      '<path d="M18 119Q14 137 17 161Q18 183 29 187" fill="none" stroke="#fff" stroke-width="5" opacity=".74" stroke-linecap="round"/>'+
      '<path d="M83 103Q92 117 94 139" stroke="#fff" stroke-width="2.2" opacity=".38" fill="none" stroke-linecap="round"/>'+
      '<circle cx="23" cy="146" r="2.5" fill="#fff" opacity=".7"/><circle cx="84" cy="164" r="2.5" fill="#fff" opacity=".55"/>'+
    '</g>'+
    '<path d="M35 67C32 80 18 85 13 106L9 157Q9 191 32 195H76Q99 191 99 157L95 106C90 85 76 80 73 67Z" fill="none" stroke="#d5baff" stroke-width="1.6"/>'+
    // Ornate curved neck and stopper, a small gold-and-amethyst jewel at the centre
    '<path d="M40 48V63Q54 69 68 63V48" fill="#bbdbff90" stroke="#fff" stroke-width="3"/>'+
    '<rect x="34" y="58" width="40" height="12" rx="5" fill="url(#'+gold+')" stroke="#fff3d8" stroke-width="2.6"/>'+
    '<path d="M38 38H70L68 57Q54 61 40 57Z" fill="#ddc4ff" stroke="#fff" stroke-width="2.7"/>'+
    '<path d="M42 38L35 24Q54 7 73 24L66 38Z" fill="url(#'+gold+')" stroke="#fff9e4" stroke-width="3"/>'+
    '<path d="M54 15L61 24L54 34L47 24Z" fill="#c64af6" stroke="#fff" stroke-width="2.2"/>'+
    '<path d="M45 40L49 54M63 41L59 53" stroke="#fff" stroke-width="2.4" opacity=".68"/>'+
    '<path d="M33 67Q54 74 75 67" fill="none" stroke="#fff9e4" stroke-width="3"/>'+
    '<path d="M33 191Q54 201 75 191" fill="none" stroke="#fff" stroke-width="2.2" opacity=".7"/>'+
    // ornamental charm hanging on the flask body
    '<path d="M45 87Q54 94 63 87" fill="none" stroke="#ffe7ff" stroke-width="1.5" opacity=".55"/>'+
    '<path d="M54 80l2.6 5.4L62 88l-5.4 2.4L54 96l-2.6-5.6L46 88l5.4-2.6Z" fill="#fff" opacity=".9"/>'+
    '</svg>';
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
    const label='Fiole '+(i+1)+', '+(tube.length?tube.length+' gouttes, au-dessus : '+GEMS[top(tube)].name:'vide')+(complete?', complète':'');
    return '<button type="button" class="'+classes+'" data-tube="'+i+'" aria-label="'+escapeHtml(label)+'" aria-pressed="'+(selected===i)+'" title="'+escapeHtml(label)+'">'+potionSvg(tube,i)+'</button>';
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
