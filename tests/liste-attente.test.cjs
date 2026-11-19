const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

test('Wix liste attente : importe séparément, compte les bébés à part, évite les doublons', async () => {
  let depuis = '2026-01-01T00:00:00.000Z';
  const tablesEcrites = [];
  const soumission = { id: 'wix-456', createdDate: '2026-11-20T12:00:00.000Z', submissions: {
    evenement_attente: 'Bal de Noël', nom_attente: 'Famille Dupont', email_attente: 'dupont@example.be',
    telephone_attente: '0470 11 22 33', adultes_attente: '2', enfants_attente: '1',
    bebes_attente: '', message_attente: 'Près de la scène si possible',
  } };
  const fauxSupabase = {
    from(table) {
      if (table === 'parametres') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { valeur: depuis } }) }) }),
        upsert: async (o) => { depuis = o.valeur; return { error: null }; },
      };
      if (table === 'evenements') return {
        select: () => ({ eq: () => ({ gte: () => ({ neq: () => ({ order: async () => ({
          data: [{ id: 'a0000000-0000-4000-8000-000000000001', titre: 'Grand Bal de Noël', date: '2099-12-20' }],
          error: null,
        }) }) }) }) }),
      };
      if (table === 'liste_attente') return {
        insert: async o => { tablesEcrites.push({ table, o }); return { error: null }; },
      };
      throw new Error(`Insertion inattendue dans ${table}`);
    },
  };
  const src = stripTypeScriptTypes(fs.readFileSync('notifier-index.ts', 'utf8'), { mode: 'strip' })
    .replace(/^import .*;$/gm, '');
  const context = {
    createClient: () => fauxSupabase,
    Deno: { env: { get: key => ({ SUPABASE_URL: 'mock', SUPABASE_SERVICE_ROLE_KEY: 'mock',
      WIX_API_KEY: 'mock', WIX_SITE_ID: 'mock', WIX_FORM_ATTENTE_ID: 'nouveau-formulaire' }[key] || '') },
      serve: () => {} },
    crypto: require('node:crypto').webcrypto, TextEncoder, TextDecoder, Response,
    fetch: async (_, options) => {
      const { query } = JSON.parse(options.body);
      assert.equal(query.filter.formId, 'nouveau-formulaire');
      return { ok: true, json: async () => ({ submissions: [soumission] }) };
    },
    console, Date, URL, setTimeout, clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(src, context, { filename: 'notifier-index.ts' });

  const premiere = await vm.runInContext('importerListeAttente()', context);
  assert.equal(premiere.length, 1);
  assert.equal(tablesEcrites.length, 1);
  assert.equal(tablesEcrites[0].table, 'liste_attente');
  assert.equal(tablesEcrites[0].o.places, 3);
  assert.equal(tablesEcrites[0].o.adultes, 2);
  assert.equal(tablesEcrites[0].o.enfants, 1);
  assert.equal(tablesEcrites[0].o.bebes, 0);
  assert.equal(tablesEcrites[0].o.wix_submission_id, 'wix-456');

  const seconde = await vm.runInContext('importerListeAttente()', context);
  assert.equal(seconde.length, 0);
  assert.equal(tablesEcrites.length, 1);
});

test('Une annulation partielle signale les places libérées, pas une mise à jour sans libération', async () => {
  const source = stripTypeScriptTypes(fs.readFileSync('notifier-index.ts', 'utf8'), { mode: 'strip' });
  const debut = source.indexOf('async function notifierLiberationAttente(');
  const fin = source.indexOf('async function responsableDepuisRequete(', debut);
  assert.ok(debut >= 0 && fin > debut);
  const alerts = [];
  const id = 'a0000000-0000-4000-8000-000000000001';
  const context = {
    ATTENTE_ID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    placesRestantesAttente: async evId => { assert.equal(evId, id); return 4; },
    notifierResponsablesAttente: async (payload, evId, cle) => { alerts.push({ payload, evId, cle }); return 1; },
    sb: { from: table => {
      if (table === 'liste_attente') return { select: () => ({ eq: () => ({ eq: async () => ({ count: 2, error: null }) }) }) };
      if (table === 'evenements') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { titre: 'Bal de Noël' }, error: null }) }) }) };
      throw Error('Table inattendue : ' + table);
    } },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(debut, fin), context);
  const avant = { id: 'b0000000-0000-4000-8000-000000000002', evenement_id: id, places: 5, annulations: [] };
  const apres = { ...avant, annulations: [{ n: 2 }] };
  assert.equal(await vm.runInContext('notifierLiberationAttente', context)('UPDATE', apres, avant), 1);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].payload.title, /4 place\(s\) libérée\(s\)/);
  assert.match(alerts[0].payload.body, /2 personne\(s\) en liste d'attente/);
  assert.equal(await vm.runInContext('notifierLiberationAttente', context)('UPDATE', avant, avant), 0);
  assert.equal(alerts.length, 1);
});
