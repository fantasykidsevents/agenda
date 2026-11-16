/* Fantasy Match – Fantasy Kids Events. Jeu original de combinaisons. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const MAX_LEVEL = 200, MAX_LIVES = 5, LIFE_MS = 30 * 60 * 1000, SIZE = 8, POINTS_PER_UNUSED_MOVE = 50;
  const WORLD_NAMES = ['Le Royaume des Étoiles', 'Le Jardin Enchanté', 'Le Palais des Neiges', 'La Grotte des Cristaux', 'Le Royaume de la Magie', 'L’Archipel des Comètes', 'Le Labyrinthe des Mirages', 'La Forêt des Ombres', 'La Citadelle des Tempêtes', 'Le Cœur de Lumière'];
  const KINDS = ['star', 'rose', 'crystal', 'snow', 'crown', 'wand'];
  const LABELS = {star:'Étoiles',rose:'Roses',crystal:'Cristaux',snow:'Flocons',crown:'Couronnes',wand:'Baguettes'};
  const GLYPHS = {
    star:`<path d="M32 4 39.3 22.4 59 23.7 43.7 36.4 48.8 56 32 45.5 15.2 56 20.3 36.4 5 23.7 24.7 22.4Z" fill="url(#a)" stroke="#f9a9dd" stroke-width="2"/><path d="M32 11 36.7 27 51 28.5 39.5 37 43.6 49 32 42 20.4 49 24.5 37 13 28.5 27.3 27Z" fill="#fff" opacity=".28"/>`,
    rose:`<path d="M29 48Q17 57 13 48Q22 43 27 44Q21 38 22 32L34 42Q42 37 49 44Q42 48 36 49Z" fill="#36af78"/><path d="M30 9C20 4 9 17 15 26 5 32 11 43 23 45c4 9 19 9 23 0 13-2 18-13 11-21C61 14 50 6 41 10 37 4 32 5 30 9Z" fill="url(#a)" stroke="#bb207c" stroke-width="2.4"/><path d="M33 17C16 12 17 32 32 34c11 1 16-13 5-16-8-3-15 5-8 9 4 3 10 0 7-4" fill="none" stroke="#ffa8d8" stroke-width="4" stroke-linecap="round"/>`,
    crystal:`<path d="M22 7 44 7 58 24 44 58 17 58 6 27Z" fill="url(#a)" stroke="#1685d1" stroke-width="2"/><path d="M22 7 29 27 17 58 6 27Z" fill="#b7faff" opacity=".9"/><path d="M44 7 29 27 17 58 44 58 58 24Z" fill="#137fe4" opacity=".42"/><path d="M29 27 58 24 44 7 22 7Z" fill="#8ceaff" opacity=".6"/>`,
    snow:`<g stroke="#d0edff" stroke-width="5" stroke-linecap="round"><path d="M32 6v52M6 32h52M14 14l36 36M50 14 14 50"/></g><g stroke="#52c4f8" stroke-width="3" stroke-linecap="round"><path d="m24 12 8 8 8-8M24 52l8-8 8 8M12 24l8 8-8 8M52 24l-8 8 8 8"/></g><circle cx="32" cy="32" r="6" fill="#fff"/>`,
    crown:`<path d="M9 46 5 15 20 29 32 8 44 29 59 15 55 46Z" fill="url(#a)" stroke="#ce7b22" stroke-width="2.5"/><rect x="9" y="44" width="46" height="10" rx="4" fill="#fcb737" stroke="#dd8425" stroke-width="2"/><path d="M31 29 38 36 31 43 24 36Z" fill="#e943b7" stroke="#a72e9d" stroke-width="2"/><circle cx="16" cy="39" r="3" fill="#45d5ff"/><circle cx="48" cy="39" r="3" fill="#45d5ff"/>`,
    wand:`<path d="M18 54 40 27" stroke="#9951c1" stroke-width="8" stroke-linecap="round"/><path d="M18 54 40 27" stroke="#ffd2ef" stroke-width="3" stroke-linecap="round"/><path d="M43 4 48 15 59 19 48 24 43 35 38 24 27 19 38 15Z" fill="url(#a)" stroke="#ec62cd" stroke-width="2"/><circle cx="15" cy="15" r="3" fill="#fff"/><circle cx="55" cy="43" r="3" fill="#fff"/>`
  };
  const COLORS = {
    star:['#ff8dcc','#f03f9d','#d51c89'],rose:['#ffb9db','#ff499f','#c92374'],
    crystal:['#aaf4ff','#17c8fb','#1775ec'],snow:['#e9fbff','#82d8fa','#5499e9'],
    crown:['#fff3a6','#ffcd4d','#eb8c20'],wand:['#ffd2ff','#f18dfd','#ad35e9']
  };
  // Les pièces reprennent les illustrations brillantes de l'aperçu validé.
  // Le dessin est une image, mais chaque case et chaque déplacement restent interactifs.
  const kindOf = v => String(v || '').split('|')[0];
  const specialOf = v => String(v || '').split('|')[1] || '';
  const piece = value => {
    const kind = kindOf(value), power = specialOf(value);
    return `<span class="fm-piece fm-piece-${KINDS.includes(kind) ? kind : 'rainbow'}${power ? ' fm-piece-' + power : ''}" aria-hidden="true"></span>`;
  };
  let sb = null, user = null, playerName = 'Moi', storageKey = 'fantasy_match_demo_v1', cloudReady = false;
  let state = null, board = [], selected = -1, busy = false;
  let remaining = 0, target = 0, moves = 0, roundScore = 0, current = null, toastTimer = null, saveTimer = null;
  let remainingByKind = {}, frozenCells = new Set(), bonusCreated = 0;
  let sealedCells = new Map(), timedBombs = new Map(), comboCount = 0;
  let touch = null, suppressClickUntil = 0;
  const rand = n => Math.floor(Math.random() * n);
  const randomKind = () => KINDS[rand(KINDS.length)];
  const now = () => Date.now();
  const localDefault = () => ({level:1,maxUnlocked:1,lives:5,nextLifeAt:0,score:0,levels:{},bestScores:{},boosters:{color:3,bomb:3,shuffle:3},lastGiftAt:'',updatedAt:0});
  const world = n => Math.floor((n - 1) / 20);
  function levelConfig(n) {
    // Chapitre 2 : 100 niveaux inédits, plus corsés, avec des défis de combinaisons.
    if(n>100){
      const w=world(n), sub=(n-101)%20, tier=Math.min(4,Math.floor((n-101)/20));
      const modes=['collect','duo','ice','score','special'];
      const mode=n%10===0?'combo':n%8===0?'seal':modes[(n-1)%5];
      const goal=KINDS[(sub+w*2)%KINDS.length],goal2=KINDS[(sub+w*2+2)%KINDS.length];
      const boss=n%10===0, advance=Math.floor(sub/5);
      const targets=mode==='duo' ? {
        [goal]:[21,24,27,31,35][tier]+advance,
        [goal2]:[19,23,25,28,32][tier]+advance
      } : {};
      const target=mode==='collect'?[25,30,34,39,44][tier]+advance*2
        :mode==='duo'?targets[goal]+targets[goal2]
        :mode==='ice'?[18,20,22,24,26][tier]+advance
        :mode==='score'?[1600,2000,2400,2800,3250][tier]+advance*90
        :mode==='special'?[3,4,4,5,6][tier]
        :mode==='seal'?7+tier*4+advance*2
        :tier<2?1:tier<4?2:3;
      const moves=[18,17,16,15,14][tier]+(mode==='ice'?2:mode==='special'?4:mode==='combo'?7:mode==='seal'?5:mode==='duo'?1:0);
      return {number:n,world:w,mode,goal,goal2,targets,target,moves,boss,difficulty:tier+5};
    }
    const w = world(n), sub = (n - 1) % 20, phase = (n - 1) % 5;
    const modes = ['collect','duo','ice','score','special'];
    const mode = modes[phase], goal = KINDS[(sub + w * 2) % KINDS.length];
    const goal2 = KINDS[(sub + w * 2 + 2) % KINDS.length];
    const boss = n % 10 === 0;
    // Difficulté pensée pour l'équipe adulte : tutoriel court, puis cinq paliers
    // progressifs. Les objectifs dépendent du type de défi et pas seulement du niveau.
    const tier = n <= 5 ? 0 : n <= 15 ? 1 : n <= 30 ? 2 : n <= 50 ? 3 : 4;
    const starts = [1,6,16,31,51], progression = n - starts[tier];
    const targets = mode === 'duo' ? {
      [goal]: [5,8,11,15,17][tier] + Math.floor(progression / 15),
      [goal2]: [5,7,10,14,16][tier] + Math.floor(progression / 15)
    } : {};
    const target = mode === 'collect'
      ? [9,15,20,21,20][tier] + (tier === 4 ? Math.min(2,Math.floor(progression / 15)) : Math.floor(progression / 9) * 2) + sub % 3
      : mode === 'duo' ? targets[goal] + targets[goal2]
      : mode === 'ice' ? Math.min(15,[7,10,12,14,15][tier] + Math.floor(progression / 14))
      : mode === 'score' ? [380,680,950,1350,1450][tier] + (tier >= 3 ? Math.min(6,Math.floor(progression / 9)) * 40 : Math.floor(progression / 4) * 35) + (sub % 4) * 30
      : [1,1,2,3,3][tier] + (boss ? 2 : 0);
    const extraMoves = mode === 'special' ? 2 : mode === 'ice' ? (tier >= 3 ? 1 : 2) : mode === 'duo' ? 1 : 0;
    const maxMoves = Math.max(16,[26,22,20,18,17][tier] + extraMoves - (boss ? 1 : 0));
    return {number:n,world:w,mode,goal,goal2,targets,target,moves:maxMoves,boss,difficulty:tier};
  }
  const MODE_LABELS = {collect:'Récolte magique',duo:'Double récolte',ice:'Brise la glace',score:'Course aux points',special:'Défi des bonus',combo:'Fusion des pouvoirs',seal:'Les sceaux mystérieux'};
  function iceCellsForLevel(n,count){
    const patterns = [
      [9,14,18,21,26,29,34,37,42,45,49,54,10,13,50],
      [0,7,9,14,18,21,42,45,49,54,56,63,1,6,57],
      [16,17,18,19,20,21,22,23,40,41,42,43,44,45,46],
      [3,4,11,12,19,20,27,28,35,36,43,44,51,52,59]
    ];
    const pattern = patterns[Math.floor((n - 1) / 5) % patterns.length];
    const cells=[...pattern], unique=new Set(cells);
    // Les nouveaux mondes comportent jusqu'à trente cases glacées.
    for(let k=0;unique.size<count && k<64;k++) unique.add((k*19+n*7)%64);
    return new Set([...unique].slice(0,count));
  }
  function readLocal() {
    try { return {...localDefault(),...JSON.parse(localStorage.getItem(storageKey) || '{}')}; }
    catch { return localDefault(); }
  }
  function ensureState() {
    if (!state) state = localDefault();
    state.lives = Math.max(0,Math.min(MAX_LIVES,Number(state.lives ?? 5)));
    state.maxUnlocked = Math.max(1,Math.min(MAX_LEVEL,Number(state.maxUnlocked || 1)));
    // Un joueur ayant terminé l'ancien niveau 100 reprend directement au 101.
    if(Number(state.levels?.[100]||0)>0 && state.maxUnlocked===100){state.maxUnlocked=101;state.level=101;}
    state.level = Math.max(1,Math.min(state.maxUnlocked,Number(state.level || 1)));
    state.boosters = {color:3,bomb:3,shuffle:3,...state.boosters};
    state.levels ||= {}; state.bestScores ||= {};
  }
  // Une ancienne sauvegarde cloud (ou une vie offerte depuis un autre appareil)
  // ne doit jamais effacer des niveaux déjà débloqués localement.
  function mergeProgress(local, remote, cloudUpdatedAt) {
    const online = {...localDefault(), ...remote};
    const cloudIsNewer = Number(cloudUpdatedAt || 0) > Number(local.updatedAt || 0);
    const recent = cloudIsNewer ? online : local;
    const other = cloudIsNewer ? local : online;
    const unlocked = Math.max(1, Number(local.maxUnlocked || 1), Number(online.maxUnlocked || 1));
    const progressOwner = Number(recent.maxUnlocked || 1) >= Number(other.maxUnlocked || 1) ? recent : other;
    const combineBest = (a, b) => Object.fromEntries(Array.from(
      new Set([...Object.keys(a || {}), ...Object.keys(b || {})]),
      key => [key, Math.max(Number(a?.[key] || 0), Number(b?.[key] || 0))]
    ));
    return {
      ...other, ...recent,
      maxUnlocked: unlocked,
      level: Math.max(1, Math.min(unlocked, Number(progressOwner.level || unlocked))),
      score: Math.max(Number(local.score || 0), Number(online.score || 0)),
      levels: combineBest(local.levels, online.levels),
      bestScores: combineBest(local.bestScores, online.bestScores)
    };
  }
  function tickLives() {
    if (!state) return;
    if (state.lives >= MAX_LIVES) { state.nextLifeAt = 0; renderHearts(); return; }
    if (!state.nextLifeAt) state.nextLifeAt = now() + LIFE_MS;
    let updated = false;
    while (state.lives < MAX_LIVES && now() >= state.nextLifeAt) {
      state.lives++; state.nextLifeAt += LIFE_MS; updated = true;
    }
    if (state.lives >= MAX_LIVES) state.nextLifeAt = 0;
    if (updated) save();
    renderHearts();
  }
  function renderHearts() {
    if (!state) return;
    $('hearts').innerHTML = Array.from({length:5},(_,i)=>`<span class="fm-heart ${i < state.lives ? 'full' : ''}">♥</span>`).join('');
    if (state.lives === 5) { $('lifeTimer').textContent = '5 / 5 vies'; return; }
    const t = Math.max(0,state.nextLifeAt - now());
    const mins = String(Math.floor(t / 60000)).padStart(2,'0');
    const secs = String(Math.floor(t / 1000) % 60).padStart(2,'0');
    $('lifeTimer').textContent = `${state.lives} / 5 · +1 dans ${mins}:${secs}`;
  }
  function save() {
    if (!state) return;
    state.updatedAt = now();
    localStorage.setItem(storageKey, JSON.stringify(state));
    if (!sb || !user || !cloudReady) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const {error} = await sb.from('fantasy_match_profiles').upsert({
          user_id:user.id,prenom:playerName,level:state.maxUnlocked,score:state.score,
          state,updated_at:new Date().toISOString()
        });
        $('syncStatus').textContent = error ? 'Sauvegarde sur ce téléphone · synchronisation en attente' : '✓ Progression sauvegardée dans Fantasy';
      } catch { $('syncStatus').textContent = 'Sauvegarde sur ce téléphone'; }
    }, 600);
  }
  async function setupCloud() {
    const cfg = window.APP_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) {
      $('syncStatus').textContent = 'Mode démo · sauvegarde sur cet appareil'; return;
    }
    sb = window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
    const {data:{user:u}} = await sb.auth.getUser();
    if (!u) {
      $('syncStatus').textContent = 'Connecte-toi à l’application pour synchroniser le jeu';
      showDialog('Connecte-toi à Fantasy','Cette version d’essai fonctionne sur ce téléphone. Pour le classement et la sauvegarde d’équipe, connecte-toi d’abord à l’application.',
        [{label:'Retour à Fantasy',action:()=>{location.href='index.html'}}], '✦');
      return;
    }
    user = u; storageKey = 'fantasy_match_v1_' + u.id;
    state = readLocal(); ensureState();
    try {
      const {data:member} = await sb.from('equipe').select('prenom').ilike('email',u.email || '').maybeSingle();
      if (member?.prenom) playerName = member.prenom;
    } catch { /* le jeu reste disponible */ }
    try {
      const {data,error} = await sb.from('fantasy_match_profiles').select('state,level,updated_at').eq('user_id',u.id).maybeSingle();
      if (error) throw error;
      cloudReady = true;
      if (data?.state) {
        const cloudState = {...data.state};
        const registeredLevel = Number(data.level || 1);
        if (registeredLevel > Number(cloudState.maxUnlocked || 1)) {
          cloudState.maxUnlocked = registeredLevel;
          cloudState.level = registeredLevel;
        }
        state = mergeProgress(state, cloudState, Date.parse(data.updated_at || '') || 0);
        ensureState();
        localStorage.setItem(storageKey, JSON.stringify(state));
      }
      $('syncStatus').textContent = '✓ Connecté à Fantasy';
      save();
    } catch { $('syncStatus').textContent = 'Sauvegarde locale · activer le module dans Supabase'; }
  }
  function hasMatches(b) { return findMatches(b).size > 0; }
  function matchDetails(b) {
    const matched = new Set(), groups = [];
    for (let y=0;y<SIZE;y++) for (let x=0;x<SIZE;) {
      const first = y*SIZE+x,kind = kindOf(b[first]); let end=x+1;
      while(kind && kind!=='rainbow' && end<SIZE && kindOf(b[y*SIZE+end])===kind)end++;
      if(kind && kind!=='rainbow' && end-x>=3){
        const positions=Array.from({length:end-x},(_,i)=>y*SIZE+x+i);
        groups.push({kind,orientation:'H',positions});positions.forEach(p=>matched.add(p));
      }
      x=end;
    }
    for (let x=0;x<SIZE;x++) for (let y=0;y<SIZE;) {
      const first=y*SIZE+x,kind=kindOf(b[first]);let end=y+1;
      while(kind && kind!=='rainbow' && end<SIZE && kindOf(b[end*SIZE+x])===kind)end++;
      if(kind && kind!=='rainbow' && end-y>=3){
        const positions=Array.from({length:end-y},(_,i)=>(y+i)*SIZE+x);
        groups.push({kind,orientation:'V',positions});positions.forEach(p=>matched.add(p));
      }
      y=end;
    }
    return {matched,groups};
  }
  const findMatches = b => matchDetails(b).matched;
  function matchBonus(b,matched,preferred=-1){
    const groups=matchDetails(b).groups.filter(g=>g.positions.every(p=>matched.has(p)));
    const five=groups.find(g=>g.positions.length>=5);
    if(five)return {index:five.positions.includes(preferred)?preferred:five.positions[2],value:'rainbow|color'};
    const hz=new Set(groups.filter(g=>g.orientation==='H').flatMap(g=>g.positions));
    const cross=groups.filter(g=>g.orientation==='V').flatMap(g=>g.positions).find(p=>hz.has(p));
    if(cross!==undefined)return {index:cross,value:kindOf(b[cross])+'|bomb'};
    const four=groups.find(g=>g.positions.length===4);
    if(four)return {index:four.positions.includes(preferred)?preferred:four.positions[1],value:four.kind+'|line'+four.orientation};
    return null;
  }
  function matchEffect(b,matched,preferred=-1,createBonus=true){
    const bonus = createBonus ? matchBonus(b,matched,preferred) : null;
    const removed = expandSpecials(b,new Set(matched));
    if(bonus)removed.delete(bonus.index);
    return {bonus,removed};
  }
  function expandSpecials(b,cells){
    const queue=[...cells],triggered=new Set();
    while(queue.length){
      const pos=queue.shift(),sp=specialOf(b[pos]);
      if(!sp || triggered.has(pos))continue;
      triggered.add(pos);
      let extra=[];
      if(sp==='lineH')extra=Array.from({length:8},(_,x)=>Math.floor(pos/8)*8+x);
      else if(sp==='lineV')extra=Array.from({length:8},(_,y)=>y*8+pos%8);
      else if(sp==='bomb'){
        for(let y=Math.max(0,Math.floor(pos/8)-1);y<=Math.min(7,Math.floor(pos/8)+1);y++)
          for(let x=Math.max(0,pos%8-1);x<=Math.min(7,pos%8+1);x++)extra.push(y*8+x);
      } else if(sp==='color'){
        const kind=KINDS[rand(KINDS.length)];
        extra=b.map((v,i)=>kindOf(v)===kind?i:-1).filter(i=>i>=0);
      }
      for(const i of extra)if(!cells.has(i)){cells.add(i);queue.push(i)}
    }
    return cells;
  }
  function hasPossibleMove(b) {
    for(let i=0;i<b.length;i++) for(const delta of [1,SIZE]) {
      const j=i+delta;
      if (j>=64 || (delta===1 && Math.floor(i/8)!==Math.floor(j/8)) || sealedCells.has(i) || sealedCells.has(j)) continue;
      [b[i],b[j]]=[b[j],b[i]];
      const ok=hasMatches(b) || !!specialOf(b[i]) || !!specialOf(b[j]);
      [b[i],b[j]]=[b[j],b[i]];
      if(ok)return true;
    }
    return false;
  }
  function freshBoard() {
    for(let trial=0;trial<30;trial++) {
      const b=[];
      for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++) {
        let k,tries=0;
        do{k=randomKind();tries++}while(tries<40 && ((x>=2 && b[y*8+x-1]===k && b[y*8+x-2]===k)||(y>=2 && b[(y-1)*8+x]===k && b[(y-2)*8+x]===k)));
        b.push(k);
      }
      if(hasPossibleMove(b))return b;
    }
    return Array.from({length:64},randomKind);
  }
  // Obstacles des nouveaux mondes : sceaux à plusieurs couches et bombes à retardement.
  function sealsForLevel(n,mode){
    if(n<=100 || mode==='ice')return new Map();
    const tier=Math.min(4,Math.floor((n-101)/20));
    const count=(mode==='seal'?8+tier*3+(n%4):3+tier*2+(n%3));
    const result=new Map();
    for(let k=0;result.size<count && k<64;k++){
      const i=(k*23+n*11)%64;
      if(mode==='combo' && (i===27||i===28))continue;
      const layers=1+(tier>=2&&k%4===0?1:0)+(tier>=4&&k%9===0?1:0);
      result.set(i,layers);
    }
    return result;
  }
  function timersForLevel(n,mode){
    if(n<151 || n%7!==0 || mode==='seal' || mode==='combo' || mode==='ice')return new Map();
    let i=(n*17+5)%64;
    while(sealedCells.has(i))i=(i+1)%64;
    return new Map([[i,10]]);
  }
  function tickTimers(){
    for(const [i,turns] of timedBombs)timedBombs.set(i,turns-1);
  }
  // Petites particules dessinées au-dessus de la grille (sans image externe).
  function magicEffect(indices,label=''){
    const host=document.querySelector('.fm-board-wrap');
    if(!host || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    const layer=document.createElement('div');layer.className='fm-fx-layer';
    const cells=[...indices].sort(()=>Math.random()-.5).slice(0,Math.min(22,indices.size||22));
    layer.innerHTML=cells.map(i=>{
      const x=(i%8+.5)/8*100,y=(Math.floor(i/8)+.5)/8*100;
      const dx=(Math.random()*150-75).toFixed(0),dy=(Math.random()*160-80).toFixed(0);
      return '<span class="fm-spark" style="left:'+x+'%;top:'+y+'%;--dx:'+dx+'px;--dy:'+dy+'px"></span>';
    }).join('')+(label?'<div class="fm-fx-label">'+escapeHtml(label)+'</div>':'');
    host.appendChild(layer);
    setTimeout(()=>layer.remove(),1150);
  }
  function startRound(n=state.level) {
    tickLives();
    state.level = Math.min(Math.max(1,n),state.maxUnlocked);
    current = levelConfig(state.level); target=current.target; remaining=target; moves=current.moves;roundScore=0;
    remainingByKind = {...current.targets};
    frozenCells = current.mode === 'ice' ? iceCellsForLevel(current.number,target) : new Set();
    sealedCells=sealsForLevel(current.number,current.mode);
    timedBombs=timersForLevel(current.number,current.mode);
    if(current.mode==='seal'){current.target=[...sealedCells.values()].reduce((a,b)=>a+b,0);target=current.target;remaining=target;}
    bonusCreated=0;comboCount=0;
    board=freshBoard();
    if(current.mode==='combo'){board[27]='star|lineH';board[28]='rose|bomb';}
    selected=-1;busy=false;
    $('gameTip').textContent=levelHint();
    $('boardOverlay').classList.add('hidden');
    save(); renderAll();
    if (state.lives<1) { lockBoardForLives(); showNoLives(); }
  }
  function lockBoardForLives() {
    $('boardOverlayText').textContent=`Niveau ${state.level} conservé · En attente d’une vie ♥`;
    $('boardOverlay').classList.remove('hidden');
    $('gameTip').textContent=`Tu retrouveras le niveau ${state.level} dès qu’une vie sera disponible.`;
    renderBoard();
  }
  function renderBoard(mark=new Set()) {
    $('gameBoard').innerHTML=board.map((kind,i)=>`<button type="button" class="fm-cell ${i===selected?'selected':''} ${mark.has(i)?'match':''} ${frozenCells.has(i)?'frozen':''} ${sealedCells.has(i)?'sealed':''}" role="gridcell" aria-label="${LABELS[kindOf(kind)]||'Magie arc-en-ciel'}, case ${i+1}${frozenCells.has(i)?', glacée':''}${sealedCells.has(i)?', sceau de '+sealedCells.get(i)+' couche(s)':''}${timedBombs.has(i)?', bombe '+timedBombs.get(i)+' coups':''}${specialOf(kind)?', bonus spécial':''}" data-index="${i}" ${busy||state.lives<1||moves<=0||sealedCells.has(i)?'disabled':''}>${kind?piece(kind):''}${sealedCells.has(i)?'<span class="fm-seal" aria-hidden="true">'+sealedCells.get(i)+'</span>':''}${timedBombs.has(i)?'<span class="fm-timer" aria-hidden="true">⏱'+timedBombs.get(i)+'</span>':''}</button>`).join('');
  }
  function renderAll() {
    if(!current)return;
    document.querySelector('.fm-shell').dataset.mode=current.mode;
    $('worldName').textContent=MODE_LABELS[current.mode]+' · '+WORLD_NAMES[current.world];
    $('levelValue').textContent=current.number;
    $('goalIcon').classList.toggle('duo',current.mode==='duo'||current.mode==='combo');
    $('goalIcon').innerHTML=current.mode==='duo' ? piece(current.goal)+piece(current.goal2)
      :current.mode==='combo' ? piece('star|lineH')+piece('rose|bomb')
      :current.mode==='special' ? piece('rainbow|color') : piece(current.mode==='ice'?'snow':current.mode==='seal'?'crystal':current.goal);
    $('goalName').textContent=current.mode==='duo'?'symboles':current.mode==='ice'?'cases glacées'
      :current.mode==='score'?'points':current.mode==='special'?'bonus spéciaux'
      :current.mode==='combo'?'fusions de bonus':current.mode==='seal'?'sceaux à briser':LABELS[current.goal].toLowerCase();
    $('goalDetail').textContent=current.mode==='duo'
      ? `${remainingByKind[current.goal]} ${LABELS[current.goal].toLowerCase()} · ${remainingByKind[current.goal2]} ${LABELS[current.goal2].toLowerCase()}`
      :current.mode==='special'?'Combine 4 ou 5 symboles'
      :current.mode==='combo'?'Échange deux bonus spéciaux voisins !'
      :current.mode==='seal'?'Détruis toutes les couches des sceaux.'
      :current.mode==='ice'?'Casse la glace sur la grille'
      :current.mode==='score'?'Chaque combinaison compte !':'';
    $('goalRemain').textContent=Math.max(0,remaining);
    $('progressValue').textContent=`${Math.max(0,target-remaining)} / ${target}`;
    $('progressFill').style.width=`${Math.min(100,100*(target-remaining)/target)}%`;
    $('movesValue').textContent=moves;
    $('colorCount').textContent=state.boosters.color;
    $('bombCount').textContent=state.boosters.bomb;
    $('shuffleCount').textContent=state.boosters.shuffle;
    renderHearts();renderBoard();
  }
  function levelHint(){
    return {collect:'Récolte le symbole demandé !',duo:'Récolte les deux sortes de symboles !',
      ice:'Brise les cases glacées avec des combinaisons !',score:'Marque des points avec des cascades !',
      special:'Crée des bonus avec 4 ou 5 pièces alignées !',
      combo:'Crée deux bonus, puis échange-les entre eux !',
      seal:'Brise les sceaux en faisant des combinaisons juste à côté !'}[current.mode];
  }
  function isNeighbor(a,b){return a>=0&&a<64&&b>=0&&b<64&&((Math.abs(a-b)===1&&Math.floor(a/8)===Math.floor(b/8))||Math.abs(a-b)===8)}
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function collapse(removed) {
    for(let x=0;x<8;x++){
      const keep=[];
      for(let y=7;y>=0;y--)if(!removed.has(y*8+x))keep.push(board[y*8+x]);
      for(let y=7;y>=0;y--)board[y*8+x]=keep.shift()||randomKind();
    }
  }
  async function resolve(initial=null,preferred=-1,createBonus=true) {
    let matches=initial || findMatches(board), chain=0;
    while(matches.size && chain<16){
      chain++;
      const {bonus,removed}=matchEffect(board,matches,preferred,createBonus);
      // Les sceaux perdent une couche lorsqu'une pièce disparaît dessus ou à côté.
      // Une pièce sous un sceau encore actif reste sur place.
      const impacted=new Set(removed);
      for(const [i,layers] of [...sealedCells]){
        const around=[i-8,i+8,...(i%8>0?[i-1]:[]),...(i%8<7?[i+1]:[])];
        if(!impacted.has(i) && !around.some(j=>impacted.has(j)))continue;
        if(layers<=1)sealedCells.delete(i);
        else sealedCells.set(i,layers-1);
        if(removed.has(i) && layers>1)removed.delete(i);
      }
      for(const i of removed)timedBombs.delete(i);
      if(current.mode==='seal')remaining=[...sealedCells.values()].reduce((sum,n)=>sum+n,0);
      if(current.mode==='collect'){
        for(const i of removed)if(kindOf(board[i])===current.goal)remaining=Math.max(0,remaining-1);
      }else if(current.mode==='duo'){
        for(const i of removed){const k=kindOf(board[i]);if(remainingByKind[k]>0)remainingByKind[k]--;}
        remaining=Object.values(remainingByKind).reduce((sum,n)=>sum+n,0);
      }else if(current.mode==='ice'){
        for(const i of removed)frozenCells.delete(i);
        remaining=frozenCells.size;
      }
      roundScore+=removed.size*10*chain;
      if(current.mode==='score')remaining=Math.max(0,target-roundScore);
      if(bonus){
        board[bonus.index]=bonus.value;
        bonusCreated++;
        if(current.mode==='special')remaining=Math.max(0,target-bonusCreated);
        toast(bonus.value==='rainbow|color'?'🌈 Arc-en-ciel créé ! Touche-le deux fois ou échange-le.'
          :specialOf(bonus.value)==='bomb'?'💥 Bombe créée !':'✨ Fusée créée !');
      }
      renderAll();renderBoard(removed);
      magicEffect(removed,chain>=3?'✨ Cascade ×'+chain+' !':'');
      await pause(chain===1?370:260);
      collapse(removed);renderBoard();
      await pause(140);
      matches=findMatches(board);
      preferred=-1;createBonus=true;
    }
    if(!hasPossibleMove(board)){board=freshBoard();toast('Le plateau se mélange ✨');}
    busy=false;renderAll();checkEnd();
  }
  function checkEnd(){
    if(remaining<=0){winLevel();return;}
    if([...timedBombs.values()].some(v=>v<=0)){loseLevel('💥 Une bombe à retardement a explosé !');return;}
    if(moves<=0){loseLevel();return;}
    const best=target-remaining;
    $('gameTip').textContent=best>=target*.7?'Encore un petit effort !':levelHint();
  }
  function specialSwapTargets(b,a,c){
    const sa=specialOf(b[a]),sc=specialOf(b[c]);
    if(!sa&&!sc)return null;
    const chosen=new Set([a,c]);
    const row = r => {if(r>=0&&r<8)for(let x=0;x<8;x++)chosen.add(r*8+x)};
    const col = x => {if(x>=0&&x<8)for(let y=0;y<8;y++)chosen.add(y*8+x)};
    const area = (p,radius=1) => {
      for(let y=Math.max(0,Math.floor(p/8)-radius);y<=Math.min(7,Math.floor(p/8)+radius);y++)
        for(let x=Math.max(0,p%8-radius);x<=Math.min(7,p%8+radius);x++)chosen.add(y*8+x);
    };
    if(sa && sc){
      let label='✨ Fusion magique !';
      if(sa==='color' && sc==='color'){
        for(let i=0;i<64;i++)chosen.add(i);
        label='🌈 Double arc-en-ciel !';
      }else if(sa==='color'||sc==='color'){
        const other=sa==='color'?c:a,sp=sa==='color'?sc:sa,k=kindOf(b[other]);
        for(let i=0;i<64;i++)if(kindOf(b[i])===k){
          chosen.add(i);
          if(sp==='bomb')area(i,1);
          else if(sp==='lineH')row(Math.floor(i/8));
          else if(sp==='lineV')col(i%8);
        }
        label='🌈 Tempête de couleurs !';
      }else if(sa==='bomb' && sc==='bomb'){
        area(a,2);area(c,2);label='💥 Double super-bombe !';
      }else if(sa==='bomb'||sc==='bomb'){
        const pos=sa==='bomb'?a:c,cy=Math.floor(pos/8),cx=pos%8;
        for(let d=-1;d<=1;d++){row(cy+d);col(cx+d);}
        label='💥 Méga explosion !';
      }else{
        row(Math.floor(a/8));row(Math.floor(c/8));col(a%8);col(c%8);
        label='✨ Fusées croisées !';
      }
      chosen.combo=true;chosen.label=label;return chosen;
    }
    if(sa==='color'||sc==='color'){
      const k=sa==='color'?kindOf(b[c]):kindOf(b[a]);
      for(let i=0;i<64;i++)if(kindOf(b[i])===k)chosen.add(i);
    }
    chosen.combo=false;chosen.label='✨ Bonus magique !';return chosen;
  }
  async function swap(a,b){
    if(busy||state.lives<1||moves<=0||!isNeighbor(a,b)||sealedCells.has(a)||sealedCells.has(b))return;
    busy=true;selected=-1;
    [board[a],board[b]]=[board[b],board[a]];
    renderBoard();await pause(180);
    const specialTargets=specialSwapTargets(board,a,b);
    if(specialTargets){
      moves--;tickTimers();
      if(specialTargets.combo){comboCount++;if(current.mode==='combo')remaining=Math.max(0,target-comboCount);}
      magicEffect(specialTargets,specialTargets.label);
      await resolve(specialTargets,-1,false);return;
    }
    const match=findMatches(board);
    if(!match.size){
      [board[a],board[b]]=[board[b],board[a]];
      busy=false;renderAll();toast('Essaie une autre combinaison');return;
    }
    moves--;tickTimers();await resolve(match,b,true);
  }
  function bestBombCenter(b,goal){
    let best=27,bestScore=-1;
    for(let i=0;i<64;i++){
      const cy=Math.floor(i/8),cx=i%8;let score=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const y=cy+dy,x=cx+dx;
        if(y<0||y>=8||x<0||x>=8)continue;
        const v=b[y*8+x];score+=kindOf(v)===goal?4:1;
        if(specialOf(v))score+=6;
      }
      if(score>bestScore){bestScore=score;best=i;}
    }
    return best;
  }
  async function useBooster(kind,i=-1){
    if(!kind||busy||state.lives<1||moves<=0)return;
    if(state.boosters[kind]<=0){toast('Plus de bonus disponible');return;}
    busy=true;selected=-1;state.boosters[kind]--;
    if(kind==='shuffle'){
      board=freshBoard();busy=false;save();renderAll();toast('Plateau mélangé !');return;
    }
    let chosen=new Set();
    if(kind==='color'){
      const targetKind=i>=0?kindOf(board[i]):current.goal;
      for(let j=0;j<64;j++)if(kindOf(board[j])===targetKind)chosen.add(j);
      toast('Magie arc-en-ciel !');
    }else{
      const center=i>=0?i:bestBombCenter(board,current.goal);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const y=Math.floor(center/8)+dy,x=center%8+dx;if(y>=0&&y<8&&x>=0&&x<8)chosen.add(y*8+x);
      }
      toast('Bombe magique !');
    }
    save();await resolve(chosen,-1,false);
  }
  async function activateSpecial(i){
    if(busy||state.lives<1||moves<=0||!specialOf(board[i]))return;
    busy=true;selected=-1;moves--;tickTimers();
    magicEffect(new Set([i]),'✨ Bonus spécial !');
    toast('Bonus spécial déclenché !');
    await resolve(new Set([i]),-1,false);
  }
  function tileTap(i){
    if(busy||state.lives<1||moves<=0)return;
    if(selected<0){selected=i;renderBoard();if(specialOf(board[i]))toast('Échange-le avec un autre bonus spécial pour les fusionner !');return;}
    if(selected===i){if(specialOf(board[i]))activateSpecial(i);else{selected=-1;renderBoard();}return;}
    if(isNeighbor(selected,i)){swap(selected,i);return;}
    selected=i;renderBoard();
  }
  function starsForSuccess(){return moves>=Math.ceil(current.moves*.35)?3:moves>=Math.ceil(current.moves*.15)?2:1}
  function winLevel(){
    const n=current.number,earned=starsForSuccess(),previous=Number(state.bestScores[n]||0);
    const unusedMoves=Math.max(0,Math.floor(moves));
    const bonus=unusedMoves*POINTS_PER_UNUSED_MOVE;
    const finalScore=roundScore+bonus;
    state.bestScores[n]=Math.max(previous,finalScore);
    // Rejouer un niveau ne crédite que l'amélioration du meilleur score.
    state.score+=Math.max(0,finalScore-previous);
    state.levels[n]=Math.max(earned,Number(state.levels[n]||0));
    state.maxUnlocked=Math.max(state.maxUnlocked,Math.min(MAX_LEVEL,n+1));
    if(n%10===0){state.boosters.color++;state.boosters.bomb++;state.boosters.shuffle++;}
    state.level=Math.min(MAX_LEVEL,n+1);
    save();
    const last=n===MAX_LEVEL;
    showDialog(last?'200 niveaux terminés !':'Niveau réussi !',
      `<div style="font-size:32px;color:#ffc02b">${'★'.repeat(earned)}${'☆'.repeat(3-earned)}</div><p>Bravo ${escapeHtml(playerName)} ! ${n%10===0?'Tu gagnes un bonus de chaque sorte !':''}</p><p>💎 Combinaisons : <b>${roundScore.toLocaleString('fr-BE')} pts</b><br>✨ ${unusedMoves} coup${unusedMoves>1?'s':''} restant${unusedMoves>1?'s':''} × ${POINTS_PER_UNUSED_MOVE} = <b>+${bonus.toLocaleString('fr-BE')} pts</b></p><p><b>Total : ${finalScore.toLocaleString('fr-BE')} points</b></p>`,
      [{label:last?'Rejouer le niveau 200':'Niveau suivant →',action:()=>{hideDialog();startRound(last?MAX_LEVEL:n+1)}}], '✦');
  }
  function loseLevel(reason=''){
    state.lives=Math.max(0,state.lives-1);
    if(state.lives<5 && !state.nextLifeAt)state.nextLifeAt=now()+LIFE_MS;
    save();renderHearts();
    if(state.lives<1)lockBoardForLives();
    else renderBoard();
    const goalText=current.mode==='ice'?'cases glacées à briser':current.mode==='score'?'points à marquer'
      :current.mode==='special'?'bonus spéciaux à créer'
      :current.mode==='combo'?'fusions de bonus à réaliser'
      :current.mode==='seal'?'couches de sceaux à briser'
      :current.mode==='duo'?'symboles à récolter':LABELS[current.goal].toLowerCase()+' à récolter';
    showDialog(reason?'💥 Bombe explosive !':'Presque !',`<p>${reason?escapeHtml(reason):'Il reste <b>'+remaining+' '+goalText+'</b>.'}</p><p>${state.lives ? 'Retente ta chance !' : 'Tes vies sont épuisées. Une nouvelle vie reviendra selon le compteur affiché.'}</p>`,
      state.lives?[{label:'Réessayer',action:()=>{hideDialog();startRound(current.number)}}]:[{label:'D’accord',action:hideDialog}], '♡');
  }
  function showNoLives(){
    tickLives();
    showDialog('Plus de vies',`<p>Ton <b>niveau ${state.level}</b> est bien conservé. Tu pourras le reprendre dès qu’une vie sera revenue.</p><p>Une nouvelle vie arrive automatiquement toutes les 30 minutes.</p><p><b>${$('lifeTimer').textContent}</b></p>`,[{label:'Compris',action:hideDialog}],'♡');
  }
  function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),1900)}
  function hideDialog(){$('dialogBackdrop').classList.add('hidden')}
  function showDialog(title,html,actions=[],symbol='✦'){
    $('dialogTitle').textContent=title;$('dialogSymbol').textContent=symbol;$('dialogContent').innerHTML=html;
    $('dialogActions').innerHTML='';
    for(const [i,a]of actions.entries()){
      const b=document.createElement('button');b.textContent=a.label;if(i>0)b.classList.add('secondary');b.addEventListener('click',a.action);$('dialogActions').appendChild(b);
    }
    $('dialogBackdrop').classList.remove('hidden');
  }
  function showLevels(){
    const cards=WORLD_NAMES.map((name,i)=>{
      const levels=Array.from({length:20},(_,j)=>i*20+j+1);
      return `<div class="fm-world-card"><h3>${i+1}. ${escapeHtml(name)}</h3><div class="fm-level-grid">${levels.map(n=>{
        const lock=n>state.maxUnlocked,passed=!!state.levels[n];
        return `<button class="${lock?'locked':state.level===n?'current':passed?'passed':''}" data-level="${n}" ${lock?'disabled':''}>${passed?'★ ':lock?'🔒 ':''}${n}</button>`;
      }).join('')}</div></div>`;
    }).join('');
    showDialog('Les 200 niveaux',cards,[{label:'Retour au jeu',action:hideDialog}],'✦');
    $('dialogContent').querySelectorAll('[data-level]').forEach(b=>b.addEventListener('click',()=>{
      hideDialog();startRound(Number(b.dataset.level));
    }));
  }
  async function showRanking(){
    showDialog('Classement Fantasy','<p>Chargement du classement de l’équipe…</p>',[{label:'Retour au jeu',action:hideDialog}],'♛');
    if(!sb||!user||!cloudReady){
      $('dialogContent').innerHTML=`<p>Le classement commun sera disponible après activation de la sauvegarde Fantasy.</p><div class="fm-ranking-row"><b>1. ${escapeHtml(playerName)}</b><small>${state.score} points · niveau ${state.maxUnlocked}</small></div>`;return;
    }
    try{
      const{data,error}=await sb.from('fantasy_match_profiles').select('user_id,prenom,level,score').order('score',{ascending:false}).limit(50);
      if(error)throw error;
      if($('dialogTitle').textContent!=='Classement Fantasy')return;
      $('dialogContent').innerHTML=(data?.length?data:[]).map((p,i)=>`<div class="fm-ranking-row"><b>${i+1}. ${escapeHtml(p.prenom||'Membre')}</b><small>${Number(p.score||0).toLocaleString('fr-BE')} pts · niv. ${p.level||1}</small>${p.user_id!==user.id?`<button data-gift="${escapeHtml(p.user_id)}" title="Offrir une vie">♥ +1</button>`:''}</div>`).join('') || '<p>Sois le premier à marquer des points !</p>';
      $('dialogContent').querySelectorAll('[data-gift]').forEach(b=>b.addEventListener('click',()=>giveLife(b.dataset.gift,b)));
    }catch{$('dialogContent').innerHTML='<p>Le classement sera disponible dès que le module Fantasy Match sera activé dans Supabase.</p>'}
  }
  async function showTeam(){
    showDialog('L’équipe Fantasy','<p>Chargement des membres du jeu…</p>',[{label:'Retour au jeu',action:hideDialog}],'♥');
    if(!sb||!user||!cloudReady){
      $('dialogContent').innerHTML='<p>Les membres apparaîtront ici après leur première partie connectée.</p>';return;
    }
    try {
      const {data,error}=await sb.from('fantasy_match_profiles').select('user_id,prenom,level').order('prenom',{ascending:true}).limit(60);
      if(error)throw error;
      if($('dialogTitle').textContent!=='L’équipe Fantasy')return;
      $('dialogContent').innerHTML=(data||[]).map(p=>`<div class="fm-ranking-row"><b>✦ ${escapeHtml(p.prenom||'Membre')}</b><small>Niveau ${p.level||1}</small>${p.user_id!==user.id?`<button data-gift="${escapeHtml(p.user_id)}" title="Offrir une vie">♥ +1</button>`:''}</div>`).join('')||'<p>Aucun membre n’a encore commencé à jouer.</p>';
      $('dialogContent').querySelectorAll('[data-gift]').forEach(b=>b.addEventListener('click',()=>giveLife(b.dataset.gift,b)));
    } catch { $('dialogContent').innerHTML='<p>La liste des joueurs est momentanément indisponible.</p>'; }
  }
  async function giveLife(recipient,button){
    if(!sb||!user||!cloudReady)return;
    button.disabled=true;
    try {
      const{data,error}=await sb.rpc('fantasy_match_offrir_vie',{destinataire:recipient});
      if(error)throw error;
      toast(data?'Une vie a été offerte ! ♥':'Tu as déjà offert une vie aujourd’hui, ou ce joueur a 5 vies.');
    }catch{toast('Envoi de vie indisponible pour le moment')}
    button.disabled=false;
  }
  function showRules(){
    showDialog('Comment jouer ?',`<p>Échange deux pièces voisines pour aligner <b>3 symboles identiques ou plus</b>.</p><p>✨ <b>4 à la suite</b> : une fusée qui efface une ligne ou une colonne.<br>🌈 <b>5 à la suite</b> : un arc-en-ciel qui reste sur le plateau et efface une couleur entière.<br>💥 <b>En L ou en T</b> : une bombe qui explose sur les cases voisines.</p><p>🌟 <b>Deux bonus spéciaux côte à côte ? Échange-les !</b> Fusée + bombe, deux bombes, double arc-en-ciel : chaque duo déclenche une fusion spectaculaire.</p><p>⛓️ <b>Les nouveaux sceaux</b> bloquent les pièces jusqu’à destruction de toutes leurs couches. Fais des combinaisons sur une case ou juste à côté. ⏱️ Une bombe à retardement doit être désamorcée avant la fin de son compteur.</p><p>Les 200 niveaux proposent des <b>défis variés</b> : récoltes, glace, score, bonus, sceaux et fusions. Termine l’objectif avant de manquer de coups.</p><p>Tu disposes de <b>5 vies</b> et une vie revient toutes les <b>30 minutes</b>. Tous les dix niveaux, tu gagnes trois bonus. Tu peux aussi offrir <b>une vie par jour</b> à un collègue depuis le classement. La flèche en haut ou le bouton « Quitter le jeu » en bas te ramènent à l’agenda.</p>`,[{label:'Jouer !',action:hideDialog}],'✦');
  }
  function events(){
    $('gameBoard').addEventListener('click',e=>{
      if(now()<suppressClickUntil)return;
      const cell=e.target.closest('[data-index]');if(cell)tileTap(Number(cell.dataset.index));
    });
    $('gameBoard').addEventListener('pointerdown',e=>{
      const cell=e.target.closest('[data-index]');
      if(cell)touch={i:Number(cell.dataset.index),x:e.clientX,y:e.clientY};
    });
    $('gameBoard').addEventListener('pointerup',e=>{
      if(!touch)return;
      const dx=e.clientX-touch.x,dy=e.clientY-touch.y;
      if(Math.max(Math.abs(dx),Math.abs(dy))<17){touch=null;return;}
      const from=touch.i,dir=Math.abs(dx)>Math.abs(dy)?(dx>0?1:-1):(dy>0?8:-8),to=from+dir;
      touch=null;suppressClickUntil=now()+300;
      if(isNeighbor(from,to))swap(from,to);
    });
    for(const type of ['color','bomb','shuffle']){
      $('boost'+type[0].toUpperCase()+type.slice(1)).addEventListener('click',()=>{
        if(busy||state.lives<1||moves<=0)return;
        if(!state.boosters[type]){toast('Plus de bonus disponible');return;}
        useBooster(type,selected);
      });
    }
    $('levelsBtn').addEventListener('click',showLevels);
    $('rulesBtn').addEventListener('click',showRules);
    $('dialogClose').addEventListener('click',hideDialog);
    $('dialogBackdrop').addEventListener('click',e=>{if(e.target===$('dialogBackdrop'))hideDialog()});
    document.querySelectorAll('[data-screen]').forEach(b=>b.addEventListener('click',()=>{
      document.querySelectorAll('[data-screen]').forEach(x=>x.classList.toggle('active',x===b));
      if(b.dataset.screen==='levels')showLevels();else if(b.dataset.screen==='ranking')showRanking();else if(b.dataset.screen==='team')showTeam();else hideDialog();
    }));
    setInterval(()=>{
      const wasEmpty=state?.lives===0;
      tickLives();
      if(wasEmpty && state?.lives>0 && current){
        if(['Plus de vies','Presque !'].includes($('dialogTitle').textContent))hideDialog();
        startRound(state.level);
      }
    },1000);
  }
  async function init(){
    state=readLocal();ensureState();
    events();tickLives();
    await setupCloud();ensureState();tickLives();
    startRound(state.level);
  }
  init().catch(err=>{console.error('Fantasy Match',err);$('syncStatus').textContent='Le jeu reste disponible en mode local';state||=readLocal();ensureState();startRound(state.level)});
})();
