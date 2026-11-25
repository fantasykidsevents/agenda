(()=>{"use strict";
const $=id=>document.getElementById(id),W=360,H=535,R=16.5,DX=34,DY=29.45,TOP=22,ORIGIN={x:180,y:505},MAX=15,LIMIT=445,MAX_LEVEL=300,LIFE_MS=30*60*1000;
const PALETTE=[["#ffb7e4","#f51a8c","#88013f","♥"],["#9dcaff","#2363f5","#15247c","✦"],["#b9ff93","#46c92b","#17642d","◆"],["#fff3a4","#ffc427","#a35b0a","★"],["#efc2ff","#9f34e8","#4c107e","✿"],["#ffc18a","#f35e17","#a32b09","☀"],["#a9fff3","#10cfc4","#09605f","❄"]];
const WORLDS=["Le Lac des étoiles","Le Jardin des bulles","Le Palais de cristal","La Grotte des améthystes","Les Îles suspendues","Le Royaume des glaces","Le Jardin des roses","Le Ciel des lanternes","La Vallée des sortilèges","Le Château des rêves","La Forêt des enchantements","Le Royaume des aurores","La Tour de Lumi","Le Portail céleste","Le Château de Fantasy"];
const POWERS={rainbow:"Bulle arc-en-ciel",bomb:"Explosion magique",lightning:"Éclair destructeur",extra:"5 tirs supplémentaires"};
const key=(r,c)=>r+":"+c,parse=k=>k.split(":").map(Number),cols=r=>r%2===0?10:9,valid=(r,c)=>r>=0&&r<MAX&&c>=0&&c<cols(r),pos=(r,c)=>({x:27+c*DX+(r%2)*DX/2,y:TOP+r*DY}),point=k=>pos(...parse(k));
const neighborCache=new Map();
function neighbors(k){
 if(neighborCache.has(k))return neighborCache.get(k);
 const [r,c]=parse(k),p=point(k),out=[];
 for(let y=Math.max(0,r-1);y<=Math.min(MAX-1,r+1);y++)for(let x=Math.max(0,c-1);x<=Math.min(cols(y)-1,c+1);x++){
  if(y===r&&x===c)continue;const q=pos(y,x);
  if(Math.hypot(p.x-q.x,p.y-q.y)<=DX+0.2)out.push(key(y,x));
 }
 neighborCache.set(k,out);return out;
}
const rng=seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
const fmt=n=>Number(n||0).toLocaleString("fr-BE"),esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const world=n=>Math.floor((n-1)/20),types=n=>n<=2?3:n<=7?4:n<=24?5:n<=64?6:7;
function connected(board){const seen=new Set(Object.keys(board).filter(k=>parse(k)[0]===0)),q=[...seen];for(let i=0;i<q.length;i++)for(const n of neighbors(q[i]))if(board[n]&&!seen.has(n)){seen.add(n);q.push(n)}return seen}
function group(board,start,color){const seen=new Set(),q=[start];for(let i=0;i<q.length;i++){const k=q[i];if(seen.has(k)||!board[k]||board[k].color!==color)continue;seen.add(k);q.push(...neighbors(k))}return [...seen]}
// Adult difficulty, small clusters, earlier armor and deeper rescue targets.
// Budget de tirs par configuration réelle, et non uniquement par numéro de niveau.
const SHOT_BUDGET_VERSION=1;
function shotBudget(board,level,stage=1,rescue=false){
 const seen=new Set(),bubbles=Object.values(board),count=bubbles.filter(b=>b.color>=0).length;
 const armor=bubbles.reduce((sum,b)=>sum+Math.max(0,b.armor||0),0);
 const stones=bubbles.filter(b=>b.color<0).length,colors=colorsPresent(board).length;
 let groups=0,singles=0,pairs=0;
 for(const [k,b] of Object.entries(board)){
  if(b.color<0||seen.has(k))continue;
  const cells=group(board,k,b.color);for(const c of cells)seen.add(c);
  groups++;if(cells.length===1)singles++;else if(cells.length===2)pairs++;
 }
 const base=level<=2?Math.ceil(count/3)+8:Math.ceil(count/(level<=7?3.1:level<=24?3.3:3.4))+Math.ceil(armor*.48)+(rescue?9:7);
 const workload=Math.ceil(count*.29+groups*.30+singles*.65+pairs*.20+armor*.85+stones*1.5+Math.max(0,colors-3)*1.5+Math.max(0,stage-1)*1.5+(rescue?2:0)+6);
 const shots=Math.max(base,Math.min(base+Math.min(24,5+Math.floor(level/35)+stage*3),workload));
 return {shots,base,count,armor,stones,colors,groups,singles,pairs};
}
function generate(level,stage=1){
 const random=rng(level*39771+137+(stage-1)*8191),n=types(level),rows=Math.min(12,(level<=2?4:5+Math.floor((level-3)/34))+(stage-1)),board={},phase=Math.floor(random()*n),pattern=(level+stage-1)%7,rescue=level%10===0;
 for(let r=0;r<rows;r++)for(let c=0;c<cols(r);c++){
  const edge=c===0||c===cols(r)-1,center=Math.floor(cols(r)/2);
  const hole=r>0&&((pattern===0&&edge&&r>1)||(pattern===1&&r===rows-1&&(c+level)%3===0)||(pattern===2&&r>2&&(c+r)%5===0)||(pattern===3&&r>1&&c===center&&r%3===1)||(pattern===4&&r>1&&random()<.10)||(pattern===5&&r>1&&(c===1||c===cols(r)-2)&&r%3===2)||(pattern===6&&r>2&&Math.abs(c-center)<=1&&r%4===3));
  if(hole)continue;
  const width=level<=2?4:level<=7?3:2,offset=pattern%2;
  let color=(Math.floor((c+(r%2)*.5+offset)/width)+Math.floor((r+offset)/2)+phase+(pattern===3?Math.floor(r/3):0))%n;
  if(level>=8&&random()<Math.min(.24,.09+level/1500))color=Math.floor(random()*n);
  let armor=level>=6&&random()<Math.min(.23,.08+level/1300)?1:0;
  if(level>=25&&armor&&random()<Math.min(.43,.16+level/1000))armor=2;
  if(level>=45&&r===1&&edge&&random()<.50)color=-1;
  board[key(r,c)]={color,armor:color<0?0:armor,rescue:false};
 }
 const supported=connected(board);for(const k of Object.keys(board))if(!supported.has(k))delete board[k];
 if(rescue){
  const candidates=Object.keys(board).filter(k=>parse(k)[0]>=1&&parse(k)[0]<=Math.max(1,Math.floor(rows*.55))&&board[k].color>=0);
  for(let i=0;i<Math.min(2+Math.floor(level/80),candidates.length);i++){const index=Math.floor(random()*candidates.length),k=candidates.splice(index,1)[0];board[k].rescue=true;}
 }
 const budget=shotBudget(board,level,stage,rescue);
 return {board,shots:budget.shots,baseShots:budget.base,rescue,rows};
}
function countGoal(round){return Object.keys(round.board).length;}
function rescueCount(round){return Object.values(round.board).filter(b=>b.rescue).length;}
function stageCount(level){return level<=5?1:level<=20?2:level<=100?3:4;}
function upgradeRound(round){if(!round)return;round.stage=Math.max(1,Number(round.stage)||1);round.stages=Math.max(round.stage,stageCount(round.level));if(round.budgetVersion!==SHOT_BUDGET_VERSION){const setup=generate(round.level,round.stage);const bonus=Math.max(0,setup.shots-setup.baseShots);round.shots+=bonus;round.initial+=bonus;round.budgetVersion=SHOT_BUDGET_VERSION;}for(const [k,b] of Object.entries(round.board)){if(b.color<0&&parse(k)[0]===0){b.color=(parse(k)[1]+round.level)%types(round.level);b.armor=2;}}}
function roundWon(round){return !!round&&countGoal(round)===0&&round.stage>=round.stages;}
function colorsPresent(board){return [...new Set(Object.values(board).map(b=>b.color).filter(c=>c>=0))]}
function chooseColor(board,random=Math.random){const all=colorsPresent(board),front=Object.keys(board).filter(k=>board[k].color>=0&&neighbors(k).some(n=>!board[n]&&parse(n)[0]>=parse(k)[0])).map(k=>board[k].color),pool=front.length&&random()<.94?front:all;return pool.length?pool[Math.floor(random()*pool.length)]:0}
function angleFrom(x,y){return Math.max(-1.35,Math.min(1.35,Math.atan2(x-ORIGIN.x,Math.max(15,ORIGIN.y-y))))}
function trace(board,angle){
 let x=ORIGIN.x,y=ORIGIN.y,vx=Math.sin(angle)*3,vy=-Math.cos(angle)*3;
 const path=[{x,y}],occupied=Object.keys(board).map(k=>({k,...point(k)}));
 let contacts=[],ceiling=false;
 for(let i=0;i<1500;i++){
  x+=vx;y+=vy;
  if(x<R+2){x=2*(R+2)-x;vx=Math.abs(vx)}
  if(x>W-R-2){x=2*(W-R-2)-x;vx=-Math.abs(vx)}
  path.push({x,y});
  contacts=occupied.filter(p=>(p.x-x)**2+(p.y-y)**2<=(2*R-.25)**2);
  ceiling=y<=TOP;
  if(contacts.length||ceiling)break;
 }
 const candidates=new Set();
 for(const p of contacts)for(const k of neighbors(p.k))if(!board[k])candidates.add(k);
 if(ceiling)for(let c=0;c<cols(0);c++)if(!board[key(0,c)])candidates.add(key(0,c));
 const dist=k=>{const p=point(k);return (p.x-x)**2+(p.y-y)**2};
 // Never teleport to a distant cell or through an occupied layer.
 const near=[...candidates].filter(k=>dist(k)<=(DX*1.35)**2).sort((a,b)=>dist(a)-dist(b));
 const landing=near[0]||null;
 if(landing){const p=point(landing);path.push(p)}
 return {path,landing};
}
function settle(board,landing,color,power){if(!landing||board[landing])return {removed:0,fallen:0,cracked:0,matched:0};let removed=0,fallen=0,cracked=0,matched=0;const strike=k=>{const b=board[k];if(!b||b.color<0)return;if(b.armor>0){b.armor--;cracked++}else{delete board[k];removed++}};
if(power==="rainbow"){let bestColor=color,best=-1;for(const c of colorsPresent(board)){board[landing]={color:c,armor:0,rescue:false};const size=group(board,landing,c).length;delete board[landing];if(size>best){best=size;bestColor=c}}color=bestColor;}
board[landing]={color,armor:0,rescue:false};
if(power==="bomb"){const p=point(landing);for(const k of Object.keys(board)){const q=point(k);if((q.x-p.x)**2+(q.y-p.y)**2<=(DX*2.05)**2)strike(k)}}else if(power==="lightning"){const row=parse(landing)[0];for(const k of Object.keys(board))if(parse(k)[0]===row)strike(k)}else{const same=group(board,landing,color);matched=same.length;if(matched>=3)same.forEach(strike)}
const support=connected(board);for(const k of Object.keys(board))if(!support.has(k)){delete board[k];fallen++}
return {removed,fallen,cracked,matched};}
function freshRound(level){const setup=generate(level),random=rng(level*239+Date.now()%100000);return {level,designVersion:2,budgetVersion:SHOT_BUDGET_VERSION,stage:1,stages:stageCount(level),board:setup.board,rescue:setup.rescue,shots:setup.shots,initial:setup.shots,score:0,current:chooseColor(setup.board,random),next:chooseColor(setup.board,random),started:false,used:0,power:null};}
const defaultState=()=>({level:1,unlocked:1,wins:{},stars:{},lives:5,nextLifeAt:0,boosts:{rainbow:3,bomb:3,lightning:3,extra:3},claims:{},round:null});
let storage="fantasy_bubble_guest_v1",state=defaultState(),sb=null,user=null,player="Membre",cloud=false,syncing=false,syncAgain=false,syncTimer=0,busy=false,angle=0,flight=null,modalType="",modalSeq=0;
const canvas=$("board"),ctx=canvas.getContext("2d");const dpr=Math.min(2.5,window.devicePixelRatio||1);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);canvas.tabIndex=0;canvas.setAttribute("role","img");
const total=()=>Object.values(state.wins).reduce((s,v)=>s+Math.max(0,Number(v)||0),0);
function load(){try{const v=JSON.parse(localStorage.getItem(storage)||"null");if(v){state={...defaultState(),...v,boosts:{...defaultState().boosts,...v.boosts},wins:v.wins||{},stars:v.stars||{},claims:v.claims||{}};state.level=Math.min(300,Math.max(1,Number(state.level)||1));state.unlocked=Math.min(300,Math.max(state.level,Number(state.unlocked)||1));state.lives=Math.min(5,Math.max(0,Number(state.lives)||0));if(state.round&&(!state.round.board||state.round.level!==state.level))state.round=null;if(state.round)upgradeRound(state.round);}}catch{}}
function save(sync=true){try{localStorage.setItem(storage,JSON.stringify(state))}catch{}if(sync&&cloud){clearTimeout(syncTimer);syncTimer=setTimeout(syncCloud,500)}}
function mergeRemote(row){if(!row)return;for(const [n,v] of Object.entries(row.wins||{}))state.wins[n]=Math.max(Number(state.wins[n]||0),Number(v)||0);state.unlocked=Math.max(state.unlocked,Math.min(300,Number(row.level)||1));if(!state.round&&!document.body.classList.contains("playing"))state.level=Math.max(state.level,state.unlocked);}
async function syncCloud(){if(!cloud||!user)return;if(syncing){syncAgain=true;return}syncing=true;try{const {data,error}=await sb.from("fantasy_bubble_profiles").select("level,wins").eq("user_id",user.id).maybeSingle();if(error)throw error;mergeRemote(data);save(false);const result=await sb.from("fantasy_bubble_profiles").upsert({user_id:user.id,prenom:player,level:state.unlocked,score:total(),wins:state.wins,updated_at:new Date().toISOString()});if(result.error)throw result.error;$("sync").textContent="✓ Classement et niveaux synchronisés";}catch(e){$("sync").textContent="Progression locale · synchronisation à réessayer";console.warn("Fantasy Bubble sync",e)}finally{syncing=false;if(syncAgain){syncAgain=false;syncCloud()}}}
async function connect(){try{const cfg=window.APP_CONFIG||{};if(!window.supabase||!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY)throw Error("Configuration indisponible");sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);const res=await sb.auth.getUser();if(!res.data?.user)throw Error("Non connecté");user=res.data.user;storage="fantasy_bubble_v1_"+user.id;state=defaultState();load();try{const {data}=await sb.from("equipe").select("prenom").ilike("email",user.email||"").maybeSingle();if(data?.prenom)player=data.prenom}catch{}const {data,error}=await sb.from("fantasy_bubble_profiles").select("level,wins").eq("user_id",user.id).maybeSingle();if(error)throw error;mergeRemote(data);cloud=true;save();}catch(e){$("sync").textContent="Mode local · connecte-toi pour le classement";console.warn("Fantasy Bubble",e)}finally{tickLives();update();$("play").disabled=false}}
function tickLives(){if(state.lives<5){if(!state.nextLifeAt)state.nextLifeAt=Date.now()+LIFE_MS;let changed=false;while(state.lives<5&&Date.now()>=state.nextLifeAt){state.lives++;state.nextLifeAt+=LIFE_MS;changed=true}if(state.lives===5)state.nextLifeAt=0;if(changed)save(false)}else state.nextLifeAt=0;}
function loseLife(){if(state.lives===5||!state.nextLifeAt)state.nextLifeAt=Date.now()+LIFE_MS;state.lives=Math.max(0,state.lives-1);save(false)}
function update(){const r=state.round;$("homeWorld").textContent=WORLDS[world(state.level)];$("continueLevel").textContent="Niveau "+state.level;$("homeScore").textContent="★ "+fmt(total())+" pts";$("homeLives").textContent="♥ "+state.lives+"/5";$("lives").textContent=state.lives+" ♥";$("levelTitle").textContent="Niveau "+state.level;document.body.style.setProperty("--scene",world(state.level)/14*100+"%");if(r){$("goal").textContent=countGoal(r)+" bulles";$("goal").title=r.rescue?"Étoiles de Lumi restantes : "+rescueCount(r):"Vider le plateau";$("levelTitle").textContent="Niveau "+r.level+" · "+r.stage+"/"+r.stages;$("shots").textContent=r.shots;$("score").textContent=fmt(r.score)}for(const name of Object.keys(POWERS)){$("count-"+name).textContent=state.boosts[name]||0;const b=document.querySelector('[data-power="'+name+'"]');b.classList.toggle("active",r?.power===name);b.disabled=busy||!r||((state.boosts[name]||0)<1&&r.power!==name)}$("fire").disabled=busy||!r||r.shots<1;$("swap").disabled=busy||!r||!!r.power;}
function say(msg,variant="merlin"){$("message").textContent=msg;$("guide").src=variant==="gift"?"lumi-soir.webp":variant==="win"?"lumi-danse.webp":variant==="think"?"lumi-anniversaire.webp":"lumi-costumes/merlin.webp"}
// Pre-render the enchanted glass jewels at high resolution. The animation
// then blits a cached sprite instead of rebuilding gradients every frame.
const bubbleSprites=new Map();
// Actual illustrated jewels from the Fantasy art set, not tiny font glyphs.
const jewelArt=new Image();
const jewelCells=[[0,3],[1,1],[1,2],[0,0],[0,2],[1,0],[0,1]];
jewelArt.onload=()=>{bubbleSprites.clear();if(state.round)draw();};
jewelArt.src="fantasy-match-chapitre2-glossy.png";
function gemPath(g,x,y,r,points=4,inner=.28,rotation=-Math.PI/2){
 g.beginPath();for(let i=0;i<points*2;i++){const a=rotation+i*Math.PI/points,rr=i%2?r*inner:r;const xx=x+Math.cos(a)*rr,yy=y+Math.sin(a)*rr;if(i===0)g.moveTo(xx,yy);else g.lineTo(xx,yy)}g.closePath();
}
function makeBubbleSprite(color,armor,rescue){
 const size=120,c=document.createElement("canvas");c.width=c.height=size;const g=c.getContext("2d"),x=60,y=60,r=45;
 const p=color<0?["#b6b5dd","#615887","#241d40","✧"]:PALETTE[color]||PALETTE[0];
 const sphere=g.createRadialGradient(x-r*.31,y-r*.4,1,x,y,r);
 sphere.addColorStop(0,p[0]);sphere.addColorStop(.31,p[1]);sphere.addColorStop(.69,p[2]);sphere.addColorStop(.87,p[1]);sphere.addColorStop(.97,p[0]);sphere.addColorStop(1,p[0]);
 g.save();g.shadowColor=p[1];g.shadowBlur=10;g.fillStyle=sphere;g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fill();g.restore();
 g.save();g.beginPath();g.arc(x,y,r-1.4,0,Math.PI*2);g.clip();
 // Swirling suspended stardust, facets and iridescent reflections.
 g.globalAlpha=.18;g.fillStyle=p[0];g.beginPath();g.moveTo(x-r,y+r*.2);g.quadraticCurveTo(x-r*.16,y-r*.5,x+r,y-r*.16);g.quadraticCurveTo(x+r*.25,y+r*.12,x-r*.35,y+r*.8);g.closePath();g.fill();
 g.globalAlpha=.55;g.strokeStyle=p[0];g.lineWidth=1.2;g.beginPath();g.ellipse(x,y+4,r*.87,r*.29,-.55,0,Math.PI*2);g.stroke();g.globalAlpha=.3;g.strokeStyle="#fff";g.lineWidth=.8;g.beginPath();g.ellipse(x,y-2,r*.8,r*.44,.61,0,Math.PI*2);g.stroke();g.globalAlpha=1;
 const random=rng((color+3)*137+armor*97+Number(rescue)*59);
 for(let i=0;i<25;i++){const angle=random()*Math.PI*2,dist=r*(.28+random()*.58),xx=x+Math.cos(angle)*dist,yy=y+Math.sin(angle)*dist;g.globalAlpha=.3+random()*.6;g.fillStyle=i%3===0?"#fff8c9":"#fff";g.beginPath();g.arc(xx,yy,.6+random()*1.05,0,Math.PI*2);g.fill()}
 g.globalAlpha=1;
 const shine=g.createLinearGradient(x-r,y-r,x+r,y+r);shine.addColorStop(0,"#fff");shine.addColorStop(.45,"#ffffff60");shine.addColorStop(1,"#ffffff00");g.fillStyle=shine;g.beginPath();g.ellipse(x-r*.29,y-r*.54,r*.51,r*.17,-.48,0,Math.PI*2);g.fill();
 g.strokeStyle="#ffffffcc";g.lineWidth=2.3;g.lineCap="round";g.beginPath();g.arc(x,y,r-4,3.63,4.66);g.stroke();g.strokeStyle=p[0];g.lineWidth=2.6;g.beginPath();g.arc(x,y,r-3,.44,1.5);g.stroke();
 // A recognizable, faceted symbol inside every orb (not a text emoji).
 g.save();g.translate(x,y+3);const q=color;
 if(color>=0&&jewelArt.complete&&jewelArt.naturalWidth>0){const [col,row]=jewelCells[color];const sw=jewelArt.naturalWidth/3,sh=jewelArt.naturalHeight/4;g.shadowColor=p[0];g.shadowBlur=7;g.drawImage(jewelArt,col*sw,row*sh,sw,sh,-31,-33,62,62);g.shadowBlur=0;g.restore();}else{
 const jewel=g.createLinearGradient(-15,-19,15,19);jewel.addColorStop(0,"#fff");jewel.addColorStop(.36,p[0]);jewel.addColorStop(.67,p[1]);jewel.addColorStop(1,p[2]);g.fillStyle=jewel;g.strokeStyle="#fff5e8";g.lineWidth=1.7;g.shadowColor=rescue?"#ffdd54":p[0];g.shadowBlur=8;
 if(q===3){gemPath(g,0,0,27,5,.47);}
 else if(q===0){g.beginPath();g.moveTo(0,17);g.bezierCurveTo(-34,-3,-13,-25,0,-10);g.bezierCurveTo(13,-25,34,-3,0,17);g.closePath();}
 else if(q===2){g.beginPath();g.moveTo(0,-21);g.lineTo(16,0);g.lineTo(0,21);g.lineTo(-16,0);g.closePath();}
 else if(q===4){g.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?10:19;const xx=Math.cos(a)*rr,yy=Math.sin(a)*rr;i?g.lineTo(xx,yy):g.moveTo(xx,yy)}g.closePath();}
 else if(q===5){gemPath(g,0,0,19,8,.62);}
 else if(q===6){gemPath(g,0,0,19,6,.42);}
 else{gemPath(g,0,0,20,4,.35);}
 g.fill();g.stroke();g.shadowBlur=0;g.globalAlpha=.7;g.strokeStyle="#fff";g.lineWidth=.9;g.beginPath();g.moveTo(-9,-5);g.lineTo(0,0);g.lineTo(8,-5);g.moveTo(0,0);g.lineTo(0,12);g.stroke();g.restore();}
 g.restore();
 g.beginPath();g.arc(x,y,r-.9,0,Math.PI*2);g.strokeStyle=p[0];g.lineWidth=2.5;g.stroke();
 g.fillStyle="#fffdf2";gemPath(g,x-r*.59,y-r*.55,6,4,.22);g.fill();g.fillStyle="#ffffffaa";gemPath(g,x+r*.55,y+r*.48,4.8,4,.22);g.fill();
 if(armor){g.save();g.lineWidth=4.4;g.strokeStyle=armor===2?"#ffda7b":"#c4faff";g.beginPath();g.arc(x,y,r-2,0,Math.PI*2);g.stroke();
 if(armor===1){g.fillStyle="#bbf8ff30";g.fill();g.strokeStyle="#d9ffff";g.lineWidth=2;g.beginPath();g.moveTo(x-33,y-17);g.lineTo(x-9,y+3);g.lineTo(x+4,y-28);g.lineTo(x+28,y-8);g.moveTo(x-9,y+3);g.lineTo(x+3,y+24);g.lineTo(x+26,y+31);g.stroke();}
 else{for(const a of [-.65,.65]){g.save();g.translate(x,y);g.rotate(a);for(let i=-2;i<=2;i++){g.strokeStyle="#6b3515";g.lineWidth=5;g.beginPath();g.ellipse(i*13,0,9,5,0,0,Math.PI*2);g.stroke();g.strokeStyle="#ffe6a1";g.lineWidth=2.7;g.stroke()}g.restore()}}
 g.restore();}
 if(rescue){g.strokeStyle="#fff4a0";g.lineWidth=3;g.beginPath();g.arc(x,y,r-1,0,Math.PI*2);g.stroke();g.fillStyle="#fff0a0";g.strokeStyle="#9e5810";g.lineWidth=1.6;gemPath(g,x+29,y-29,13,5,.46);g.fill();g.stroke();}
 return c;
}
function drawBubble(x,y,b,r=R){
 const k=[b.color,b.armor||0,Number(!!b.rescue)].join(":");
 if(!bubbleSprites.has(k))bubbleSprites.set(k,makeBubbleSprite(b.color,b.armor||0,!!b.rescue));
 const sz=r*120/45;ctx.drawImage(bubbleSprites.get(k),x-sz/2,y-sz/2,sz,sz);
}
function drawPower(x,y,power,color,r){if(power==="rainbow"){ctx.save();const grad=ctx.createLinearGradient(x-r,y-r,x+r,y+r);["#f75cbd","#f3d94d","#49f3a6","#4cd7ff","#9e50fa"].forEach((c,i)=>grad.addColorStop(i/4,c));ctx.shadowColor="#fff";ctx.shadowBlur=10;ctx.fillStyle=grad;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.lineWidth=2;ctx.strokeStyle="#fff";ctx.stroke();ctx.fillStyle="#fff";ctx.font="bold 20px Georgia";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("✦",x,y);ctx.restore()}else{drawBubble(x,y,{color:power==="bomb"?4:power==="lightning"?1:color},r);if(power){ctx.fillStyle="#fff8c6";ctx.font="bold 22px Georgia";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(power==="bomb"?"✷":"ϟ",x,y)}}}
function draw(){ctx.clearRect(0,0,W,H);const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,"#08052591");bg.addColorStop(.55,"#180a4255");bg.addColorStop(1,"#18092f9c");ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);ctx.save();ctx.strokeStyle="#ffd98955";ctx.lineWidth=1;ctx.strokeRect(1,1,W-2,H-2);const random=rng(791);for(let i=0;i<52;i++){const x=random()*W,y=random()*H,r=random()*1.4+.25;ctx.fillStyle=i%4===0?"#ffe0a1a0":"#c4b4ff70";ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill()}ctx.restore();
const r=state.round;if(!r)return;for(const [k,b] of Object.entries(r.board)){const p=point(k);drawBubble(p.x,p.y,b)}
ctx.save();ctx.strokeStyle="#ff82af99";ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(9,LIMIT);ctx.lineTo(W-9,LIMIT);ctx.stroke();ctx.restore();
if(!busy&&r.shots>0){const prediction=trace(r.board,angle),end=prediction.path.length;ctx.save();ctx.fillStyle="#b9faff";ctx.shadowColor="#2be8ff";ctx.shadowBlur=8;for(let i=5;i<end;i+=6){const p=prediction.path[i];ctx.globalAlpha=Math.max(.25,1-i/end*.7);ctx.beginPath();ctx.arc(p.x,p.y,2.9,0,Math.PI*2);ctx.fill()}ctx.restore();if(prediction.landing){const p=point(prediction.landing);ctx.save();ctx.strokeStyle="#fff4bb";ctx.lineWidth=1.5;ctx.setLineDash([3,3]);ctx.beginPath();ctx.arc(p.x,p.y,R-1,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);if(!r.power){const test={...r.board,[prediction.landing]:{color:r.current}},same=group(test,prediction.landing,r.current);if(same.length>=3){ctx.strokeStyle="#fff8ba";ctx.shadowColor="#ffda55";ctx.shadowBlur=5;for(const k of same){const q=point(k);ctx.beginPath();ctx.arc(q.x,q.y,R+1,0,Math.PI*2);ctx.stroke()}}}ctx.restore()}}
// Jewel-mounted launcher with carved golden wings and a faceted tip.
ctx.save();ctx.translate(ORIGIN.x,ORIGIN.y);ctx.rotate(angle);
const shaft=ctx.createLinearGradient(-34,-25,34,20);shaft.addColorStop(0,"#9d5413");shaft.addColorStop(.19,"#fff6b0");shaft.addColorStop(.40,"#edb641");shaft.addColorStop(.56,"#fff1a2");shaft.addColorStop(.76,"#b36b15");shaft.addColorStop(1,"#fff1ac");
ctx.shadowColor="#f6b335";ctx.shadowBlur=8;ctx.fillStyle=shaft;ctx.strokeStyle="#fff1a9";ctx.lineWidth=1.2;
ctx.beginPath();ctx.moveTo(0,-48);ctx.bezierCurveTo(8,-30,18,-26,18,-9);ctx.bezierCurveTo(34,-25,47,-10,37,1);ctx.bezierCurveTo(34,-8,28,-5,22,4);ctx.bezierCurveTo(12,15,9,17,0,27);ctx.bezierCurveTo(-9,17,-12,15,-22,4);ctx.bezierCurveTo(-28,-5,-34,-8,-37,1);ctx.bezierCurveTo(-47,-10,-34,-25,-18,-9);ctx.bezierCurveTo(-18,-26,-8,-30,0,-48);ctx.closePath();ctx.fill();ctx.stroke();
ctx.shadowBlur=0;ctx.strokeStyle="#8d440f";ctx.lineWidth=2;for(const sign of [-1,1]){ctx.beginPath();ctx.moveTo(sign*21,-7);ctx.bezierCurveTo(sign*28,-18,sign*40,-13,sign*36,-6);ctx.stroke()}
ctx.beginPath();ctx.arc(0,0,23,0,Math.PI*2);ctx.fillStyle="#270749";ctx.fill();ctx.strokeStyle="#ffe5a0";ctx.lineWidth=3;ctx.stroke();ctx.beginPath();ctx.moveTo(0,17);ctx.lineTo(7,25);ctx.lineTo(0,32);ctx.lineTo(-7,25);ctx.closePath();ctx.fillStyle="#d150ff";ctx.fill();ctx.strokeStyle="#fff0b6";ctx.lineWidth=1;ctx.stroke();ctx.restore();
if(!flight)drawPower(ORIGIN.x,ORIGIN.y,r.power,r.current,19);
ctx.save();ctx.strokeStyle="#ffd66d";ctx.lineWidth=2;ctx.shadowColor="#e7a32f";ctx.shadowBlur=5;ctx.beginPath();ctx.arc(52,505,16.8,0,Math.PI*2);ctx.stroke();ctx.restore();drawBubble(52,505,{color:r.next},13);ctx.font="bold 10px system-ui";ctx.textAlign="center";ctx.fillStyle="#ffe6b1";ctx.fillText("SUIVANTE",52,528);if(flight)drawPower(flight.x,flight.y,flight.power,flight.color,16.5)}
function home(){if(busy)return;closeModal();document.body.classList.remove("playing");$("game").classList.add("hidden");$("home").classList.remove("hidden");update();window.scrollTo(0,0)}
function start(level=state.level,force=false){if(busy)return;tickLives();if(!state.lives){noLives();return}if(level>state.unlocked||level<1||level>MAX_LEVEL)return;closeModal();if(force||!state.round||state.round.level!==level||(!state.round.started&&state.round.designVersion!==2)){state.round=freshRound(level);state.level=level;}angle=0;busy=false;flight=null;document.body.classList.add("playing");$("home").classList.add("hidden");$("game").classList.remove("hidden");upgradeRound(state.round);say(state.round.rescue?"Libère les étoiles de Lumi et élimine toutes les bulles !":"Vague "+state.round.stage+"/"+state.round.stages+" : vide entièrement le plateau.");save(false);update();draw();window.scrollTo(0,0);if(countGoal(state.round)===0){if(roundWon(state.round))win();else advanceStage(state.round);}}
function noLives(){tickLives();const mins=Math.max(1,Math.ceil((state.nextLifeAt-Date.now())/60000));openModal("Lumi se repose…",'<img class="gift-lumi" src="lumi-nuit.webp" alt="Lumi"><p>Tu as utilisé tes cinq vies. Une vie revient dans environ '+mins+' min.</p>',[{label:"Retour",action:closeModal}],"lives")}
function shoot(){
 const r=state.round;if(busy||!r||r.shots<=0||!state.lives||!$("modal").classList.contains("hidden"))return;
 const result=trace(r.board,angle),power=r.power,color=r.current;
 if(power&&!(state.boosts[power]>0)){r.power=null;update();draw();return}
 if(!result.landing){say("Ce passage est bouché. Essaie un autre angle !","think");return;}
 busy=true;update();const points=result.path,duration=Math.min(640,Math.max(160,points.length*2.8)),t0=performance.now();
 let completed=false,raf=0,timer=0;
 function finish(){
  if(completed)return;completed=true;cancelAnimationFrame(raf);clearTimeout(timer);flight=null;
  if(state.round!==r){busy=false;update();draw();return;}
  // Only commit the shot and its cost together, after the projectile lands.
  const before=JSON.stringify(r),boosts={...state.boosts};
  let score;
  try{if(power)state.boosts[power]--;r.power=null;r.started=true;r.shots--;r.used++;score=settle(r.board,result.landing,color,power);
   r.score+=score.removed*50+score.fallen*100+score.cracked*15;
   const present=colorsPresent(r.board);r.current=present.includes(r.next)?r.next:chooseColor(r.board);r.next=chooseColor(r.board);
  }catch(err){state.round=JSON.parse(before);state.boosts=boosts;busy=false;save(false);update();say("Lumi a restauré le tir. Aucun bonus perdu.","think");draw();console.warn(err);return;}
  busy=false;save(false);update();
  if(countGoal(r)===0){if(roundWon(r)){draw();win();}else advanceStage(r);return;}
  if(r.shots===0||Object.keys(r.board).some(k=>point(k).y+R>=LIMIT)){draw();lose(r.shots===0?"Tu as utilisé tous tes tirs.":"Les bulles ont atteint la limite.");return;}
  say(score.cracked>0?"Combinaison réussie ! "+score.cracked+" protection(s) brisée(s) ou fragilisée(s).":score.fallen>0?"Magnifique ! "+score.fallen+" bulles se sont détachées.":score.removed>0?"Bien joué ! Continue ton sortilège.":score.cracked>0?"Protection fissurée : il faut encore toucher les bulles protégées.":score.matched===2?"Deux bulles reliées : il en faut une troisième.":"Il faut trois bulles identiques qui se touchent.",score.removed+score.fallen>0?"merlin":"think");
  draw();
 }
 function frame(t){if(completed)return;try{const progress=Math.max(0,Math.min(1,(t-t0)/duration)),i=Math.min(points.length-1,Math.floor(progress*(points.length-1)));flight={...points[i],power,color};draw();if(progress<1)raf=requestAnimationFrame(frame);else finish();}catch(err){console.warn(err);finish();}}
 timer=setTimeout(finish,duration+350);flight={...points[0],power,color};raf=requestAnimationFrame(frame);
}
function advanceStage(r){
 const next=r.stage+1,setup=generate(r.level,next);r.stage=next;r.board=setup.board;r.rescue=setup.rescue;r.shots=setup.shots;r.initial=setup.shots;r.budgetVersion=SHOT_BUDGET_VERSION;r.current=chooseColor(r.board);r.next=chooseColor(r.board);r.power=null;angle=0;save(false);update();draw();say("✨ Vague "+(next-1)+" réussie ! Il reste "+(r.stages-next+1)+" vague(s).","win");openModal("Vague "+(next-1)+" réussie !",'<img class="gift-lumi" src="lumi-costumes/merlin.webp" alt="Lumi"><p>Prochain défi : vague '+next+' / '+r.stages+'. Tu disposes de '+r.shots+' nouveaux tirs.</p>',[{label:"Continuer",action:closeModal}],"stage");}
function win(){const r=state.round;if(!roundWon(r))return;const n=r.level,earned=r.shots>=Math.ceil(r.initial*.28)?3:r.shots>=Math.ceil(r.initial*.12)?2:1,points=Math.round(r.score/r.stages)+r.shots*100+earned*500,first=!state.wins[n];state.wins[n]=Math.max(state.wins[n]||0,points);state.stars[n]=Math.max(state.stars[n]||0,earned);state.unlocked=Math.min(300,Math.max(state.unlocked,n+1));state.level=Math.min(300,Math.max(state.unlocked,n+1));state.round=null;if(first&&n%10===0){state.boosts.bomb++;state.boosts.rainbow++;state.boosts.lightning++;state.boosts.extra++}save();update();say("Un sortilège réussi !","win");openModal(n===300?"Le Château de Fantasy est libéré !":"Magie réussie !",'<div class="stars">'+"★".repeat(earned)+"☆".repeat(3-earned)+'</div><div class="victory-scene"><img class="victory-lumi" src="lumi-costumes/merlin.webp" alt="Lumi magicienne célèbre ta victoire"><img class="victory-chest" src="fantasy-bubble-chest.svg" alt="Coffre de cristaux enchantés"></div><p>Niveau '+n+' réussi !<br><b>'+fmt(points)+' points</b></p>'+(first&&n%10===0?"<p>🎁 Lumi t’offre un bonus de chaque sorte.</p>":""),[{label:n===300?"Accueil":"Continuer ▶",action:()=>n===300?home():start(state.level,true)},{label:"Les mondes",action:()=>{home();showWorlds()}}],"win");}
function lose(msg){busy=false;flight=null;if(!state.round)return;loseLife();state.round=null;save(false);update();openModal("Presque !",'<img class="gift-lumi" src="lumi-anniversaire.webp" alt="Lumi"><p>'+esc(msg)+'</p><p>Il te reste '+state.lives+' vie'+(state.lives>1?"s":"")+'.</p>',[{label:state.lives?"Réessayer":"Voir mes vies",action:()=>state.lives?start(state.level,true):noLives()},{label:"Accueil",action:home}],"lose")}
function openModal(title,body,actions=[],type="info"){modalSeq++;modalType=type;$("modal").querySelector(".dialog").dataset.kind=type;$("modalTitle").textContent=title;$("modalBody").innerHTML=body;$("modalActions").innerHTML="";for(const [i,a] of actions.entries()){const b=document.createElement("button");b.className="jewel "+(i===0?"primary":"");b.textContent=a.label;b.onclick=a.action;$("modalActions").appendChild(b)}$("modal").classList.remove("hidden");$("modal").querySelector(".dialog").scrollTop=0;}
function closeModal(){if(busy)return;if(modalType==="win"||modalType==="lose"){modalType="";modalSeq++;$("modal").classList.add("hidden");home();return}modalType="";modalSeq++;$("modal").classList.add("hidden")}
function showWorlds(){if(busy)return;openModal("Les mondes enchantés",'<div class="world-list">'+WORLDS.map((w,i)=>{const first=i*20+1,done=Array.from({length:20},(_,j)=>first+j).filter(n=>state.wins[n]).length;return '<button class="world-card" aria-current="'+(i===world(state.level))+'" data-world="'+i+'"><span class="world-art" style="--art:'+i/14*100+'%"></span><span><b>'+esc(w)+'</b><small>'+ (first>state.unlocked?"🔒 ":"✦ ")+done+' / 20 niveaux · '+first+'–'+(first+19)+'</small></span></button>'}).join("")+'</div>',[{label:"Retour",action:closeModal}],"worlds");$("modalBody").querySelectorAll("[data-world]").forEach(b=>b.onclick=()=>showLevels(Number(b.dataset.world)))}
function showLevels(w){const first=w*20+1;openModal(WORLDS[w],'<img class="gift-lumi" src="lumi-jour.webp" alt="Lumi"><div class="level-map" style="--art:'+w/14*100+'%">'+Array.from({length:20},(_,i)=>{const n=first+i;return '<button class="level-node '+(state.wins[n]?"done":n===state.level?"current":"")+'" data-level="'+n+'" '+(n>state.unlocked?"disabled":"")+' aria-label="Niveau '+n+'">'+(state.wins[n]?"★ ":"")+n+'</button>'}).join("")+'</div>',[{label:"Les mondes",action:showWorlds}],"levels");$("modalBody").querySelectorAll("[data-level]").forEach(b=>b.onclick=()=>start(Number(b.dataset.level)))}
const day=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Brussels",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
function showRewards(){if(busy)return;const today="daily:"+day();openModal("Les cadeaux de Lumi",'<img class="gift-lumi" src="lumi-soir.webp" alt="Lumi apporte un cadeau"><p>Un bonus quotidien et un trésor à la fin de chaque monde !</p><div class="gift-buttons"><button class="jewel" data-gift="daily" '+(state.claims[today]?"disabled":"")+'>'+(state.claims[today]?"✓ Cadeau du jour reçu":"🎁 Ouvrir mon cadeau du jour")+'</button>'+WORLDS.map((w,i)=>{const n=(i+1)*20,k="world:"+n,done=!!state.wins[n]||state.unlocked>n;return '<button class="jewel" data-gift="'+n+'" '+(!done||state.claims[k]?"disabled":"")+'>'+(state.claims[k]?"✓":done?"🎁":"🔒")+' Monde '+(i+1)+' · '+(state.claims[k]?"Récupéré":done?"Ouvrir le trésor":"Niveau "+n)+'</button>'}).join("")+'</div>',[{label:"Retour",action:closeModal}],"gifts");$("modalBody").querySelectorAll("[data-gift]").forEach(b=>b.onclick=()=>{const n=b.dataset.gift,k=n==="daily"?today:"world:"+n;if(state.claims[k]||(n!=="daily"&&!state.wins[n]&&state.unlocked<=Number(n)))return;const power=Object.keys(POWERS)[(n==="daily"?Number(day().slice(-2)):Number(n)/20)%4];state.claims[k]=true;state.boosts[power]=(state.boosts[power]||0)+(n==="daily"?1:2);save(false);update();say("Lumi t'offre "+POWERS[power]+" !","gift");showRewards();$("modalBody").insertAdjacentHTML("afterbegin","<p>✦ "+esc(POWERS[power])+" reçu !</p>")})}
async function showRanking(){if(busy)return;openModal("Classement Fantasy Bubble","<p>Chargement du classement…</p>",[{label:"Retour",action:closeModal}],"ranking");const seq=modalSeq;let rows=[{prenom:player,level:state.unlocked,score:total(),user_id:user?.id}];if(cloud){try{const {data,error}=await sb.from("fantasy_bubble_profiles").select("user_id,prenom,level,score").order("score",{ascending:false}).limit(50);if(error)throw error;if(data?.length)rows=data;}catch{}}if(modalSeq!==seq)return;$("modalBody").innerHTML=(cloud?"":"<p>Classement local · connexion Fantasy nécessaire.</p>")+rows.map((p,i)=>'<div class="rank"><strong>'+(i+1)+'.</strong><b>'+esc(p.prenom||"Membre")+'</b><small>'+fmt(p.score)+' pts<br>Niveau '+p.level+'</small></div>').join("")}
function rules(){if(busy)return;openModal("Le grimoire des bulles",'<img class="gift-lumi" src="lumi-costumes/merlin.webp" alt="Lumi magicienne"><p>Vise puis relâche le doigt pour lancer. Trois bulles de même couleur qui se touchent, dont celle que tu tires, éclatent. Le cercle pointillé indique la case visée et le contour doré confirme la combinaison. Les groupes déjà présents ne disparaissent pas avant d’être touchés ; les bulles protégées perdent une couche. Les parois permettent des rebonds.</p><p>La glace apparaît dès le niveau 6 et demande deux attaques ; les chaînes dès le niveau 25 en demandent trois. Les cristaux indestructibles ne tombent que si leur support disparaît. Tous les dix niveaux, libère les étoiles de Lumi et vide le plateau. Dès le niveau 6, plusieurs vagues composent chaque niveau. Chaque vague apporte un nombre de tirs adapté au nombre de bulles, de couleurs, de petits groupes et de protections. Aucun chronomètre ne limite le temps de réflexion. Il faut éliminer toutes les bulles de toutes les vagues pour gagner.</p><p>Quatre pouvoirs : arc-en-ciel, explosion, éclair et cinq tirs. Les vies reviennent toutes les 30 minutes. Les cadeaux quotidiens et trésors sont accessibles depuis l’accueil.</p>',[{label:"Compris",action:closeModal}],"rules")}
function pointer(e){const rect=canvas.getBoundingClientRect();const ratio=Math.min(rect.width/W,rect.height/H),left=rect.left+(rect.width-W*ratio)/2,top=rect.top+(rect.height-H*ratio)/2;angle=angleFrom((e.clientX-left)/ratio,(e.clientY-top)/ratio);draw();}
let pointerId=null;
canvas.addEventListener("pointerdown",e=>{if(busy||!state.round||pointerId!==null||!$("modal").classList.contains("hidden")||e.button>0)return;e.preventDefault();pointerId=e.pointerId;try{canvas.setPointerCapture(e.pointerId)}catch{}pointer(e)});
canvas.addEventListener("pointermove",e=>{if(!busy&&pointerId===e.pointerId)pointer(e)});
canvas.addEventListener("pointerup",e=>{if(pointerId!==e.pointerId)return;pointerId=null;if(busy)return;pointer(e);shoot()});
canvas.addEventListener("pointercancel",e=>{if(pointerId===e.pointerId)pointerId=null});
canvas.addEventListener("lostpointercapture",e=>{if(pointerId===e.pointerId)pointerId=null});
canvas.addEventListener("keydown",e=>{if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();angle=Math.max(-1.35,Math.min(1.35,angle+(e.key==="ArrowLeft"?-.07:.07)));draw()}if(e.key===" "||e.key==="Enter"){e.preventDefault();shoot()}});
$("fire").onclick=shoot;$("play").onclick=()=>start();$("goHome").onclick=home;$("worlds").onclick=$("worlds2").onclick=showWorlds;$("rewards").onclick=$("rewards2").onclick=showRewards;$("ranking").onclick=showRanking;$("help").onclick=rules;$("close").onclick=closeModal;
$("swap").onclick=()=>{if(busy||!state.round||state.round.power)return;const r=state.round;[r.current,r.next]=[r.next,r.current];save(false);draw()};
$("restart").onclick=()=>{if(busy||!state.round)return;openModal("Recommencer ?",'<p>Repartir du début de ce niveau ? '+(state.round.started?"Une vie sera utilisée.":"")+'</p>',[{label:"Recommencer",action:()=>{if(state.round?.started)loseLife();state.round=null;save(false);start(state.level,true)}},{label:"Annuler",action:closeModal}],"restart")};
document.querySelectorAll("[data-power]").forEach(b=>b.onclick=()=>{const p=b.dataset.power,r=state.round;if(busy||!r)return;if(r.power===p){r.power=null;update();draw();return}if(!state.boosts[p])return;if(p==="extra"){state.boosts.extra--;r.shots+=5;say("Lumi t'offre cinq tirs supplémentaires !","gift")}else{r.power=p;say(POWERS[p]+" prêt pour le prochain tir !","gift")}save(false);update();draw()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("modal").classList.contains("hidden"))closeModal()});window.addEventListener("online",()=>{if(cloud)syncCloud()});window.addEventListener("focus",()=>{tickLives();update();if(cloud)syncCloud()});document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")save(false)});setInterval(()=>{tickLives();update()},10000);
load();connect();draw();
})();