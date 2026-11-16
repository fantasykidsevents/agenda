// Test d'interface en mode démo, sans écriture dans Supabase.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');

function testStatic() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const debut = html.indexOf('  function rendreChoixTenueMembre(');
  const fin = html.indexOf('  // Attribution précise :', debut);
  assert.ok(debut > 0 && fin > debut, 'Formulaire membre introuvable');
  const p = { nom:'Cyrielle', role:'Elsa' }, ev = { id:'1' };
  const ctx = {
    demandePour: () => null, attributionPour: () => null, pieceAttribuee: () => null,
    costDe: () => [], normName: x => String(x).toLowerCase(), persoDe: c => c.proprietaire || '',
    TYPES: { costume:['👗', 'Costume'], perruque:['💇', 'Perruque'] },
    esc: x => String(x || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
    etatDe: () => 'ok', ETATS: {ok:['✅','Prêt']}, nomDe: c => c.nom,
    statutsDemande: { a_traiter:'🟠 À traiter' }, motifsDemande: { indisponible:'Ne sera pas prêt(e) à temps' },
  };
  const render = vm.runInNewContext(`${html.slice(debut, fin)}\nrendreChoixTenueMembre`, ctx);
  const costume = render(ev, p, 'costume'), perruque = render(ev, p, 'perruque');
  assert.match(costume, /value="fantasy"/, 'Demande Fantasy toujours disponible');
  assert.match(costume, /disabled.*propre costume|value="personnel".*disabled/, 'Option personnelle désactivée sans pièce encodée');
  assert.doesNotMatch(costume, /value="sans_perruque"/, 'Sans perruque interdit pour le costume');
  assert.match(perruque, /value="sans_perruque"/, 'Option sans perruque disponible');
  assert.match(costume, /data-demande-motif/, 'Motif du problème affiché');
  assert.match(costume, /data-demande-photo/, 'Photo du problème disponible');
  assert.match(html, /costDemandeStore\.setStatut/, 'Suivi administrateur branché');
  const migration = fs.readFileSync(path.join(__dirname, 'demandes-tenues.sql'), 'utf8');
  assert.match(migration, /notifications_app/, 'Notification en base prévue');
  assert.match(migration, /select e\.prenom, e\.responsable into acteur from public\.equipe e/, 'Colonne responsable qualifiée dans la fonction SQL');
  assert.match(migration, /for contact_responsable in select e\.email from public\.equipe e where e\.responsable = true/, 'Boucle de notifications sans ambiguïté SQL');
  console.log('✅ Formulaire membre, choix séparés, signalement, suivi et notification : OK (test statique)');
}

async function main() {
  testStatic();
  // En environnement sans sandbox Chromium, garder les tests statiques utilisables.
  if (process.env.RUN_BROWSER_TEST !== '1') return;
  const server = http.createServer((req, res) => {
    const filename = path.basename((req.url || '/').split('?')[0]) || 'index.html';
    const file = filename === 'config.js' ? null : path.join(__dirname, filename);
    if (filename === 'config.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end('window.APP_CONFIG={SUPABASE_URL:"",SUPABASE_ANON_KEY:""};');
      return;
    }
    if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(''); return; }
    res.setHeader('Content-Type', /\.html$/.test(file) ? 'text/html' : /\.js$/.test(file) ? 'application/javascript' : 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'], headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', err => { throw err; });
    await page.route('https://**', route => route.abort());
    await page.addInitScript(() => {
      localStorage.setItem('fk_agenda_demo', JSON.stringify([{ id:'evt1', titre:'La Nuit Magique', date:'2026-12-06',
        heure_debut:'14:00', heure_fin:'15:00', statut:'confirme', animateurs:'Cyrielle (Elsa)', type_evenement:'evenement' }]));
      localStorage.setItem('fk_agenda_team_demo', JSON.stringify([{ id:1, prenom:'Cyrielle', email:'cyrielle@test.be', responsable:false },
        { id:2, prenom:'Jordan', email:'jordan@test.be', responsable:true }]));
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil:'domcontentloaded' });
    await page.waitForSelector('#app:not(.hidden)');
    await page.evaluate(() => { demoRole = 'anim'; demoMe = 'Cyrielle'; applyRole(); openCostAssign(events[0]); });
    await page.locator('[data-demande-form]').first().waitFor();
    assert.equal(await page.locator('[data-demande-form]').count(), 2, 'Costume et perruque doivent être indépendants');
    const costume = page.locator('[data-demande-form][data-assign-type="costume"]');
    const wig = page.locator('[data-demande-form][data-assign-type="perruque"]');
    assert.equal(await costume.locator('[value="fantasy"]').count(), 1, 'Option Fantasy visible sans pièce personnelle');
    await costume.locator('[value="fantasy"]').check();
    await costume.locator('[data-demande-motif]').selectOption('indisponible');
    await costume.locator('[data-demande-detail]').fill('Ma robe est abîmée et ne sera pas prête dimanche.');
    await costume.locator('[type="submit"]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('fk_agenda_costumes_demandes_demo1') || '[]').some(x => x.type === 'costume'));
    await wig.locator('[value="sans_perruque"]').check();
    await wig.locator('[type="submit"]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('fk_agenda_costumes_demandes_demo1') || '[]').length === 2);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fk_agenda_costumes_demandes_demo1')));
    assert.equal(saved.find(x => x.type === 'costume').choix, 'fantasy');
    assert.equal(saved.find(x => x.type === 'costume').statut, 'a_traiter');
    assert.equal(saved.find(x => x.type === 'perruque').choix, 'sans_perruque');
    await page.evaluate(() => { demoRole = 'resp'; demoMe = 'Jordan'; applyRole(); renderCostAssign(); });
    const suivi = page.locator('[data-demande-statut][data-assign-type="costume"]');
    await suivi.selectOption('en_cours');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('fk_agenda_costumes_demandes_demo1')).some(x => x.type === 'costume' && x.statut === 'en_cours'));
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'test-tenues-preview.png') });
    console.log('✅ Formulaire Fantasy/personnel, choix indépendant perruque, signalement et suivi responsable : OK');
  } finally {
    if (browser) await browser.close();
    await new Promise(ok => server.close(ok));
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
