const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'contactme-google-'));
Object.assign(process.env, {
  DB_DRIVER: 'json', DATA_DIR: path.join(pasta, 'data'), UPLOADS_DIR: path.join(pasta, 'uploads'),
  WHATSAPP_PROVIDER: 'link', ADMIN_EMAIL: 'admin@teste.local', ADMIN_SENHA: 'teste-admin',
  SUPABASE_URL: 'https://google-auth.invalid', SUPABASE_PUBLISHABLE_KEY: 'publishable-test',
});
const { config } = require('../src/config');
const { criarGoogleAuth } = require('../src/google-auth');
const db = require('../src/db');
const auth = require('../src/auth');
const { criarApp } = require('../src/app');

test('Google indisponível sem configuração ou provedor habilitado', async () => {
  const ausente = criarGoogleAuth({ ...config, supabase: {} }, () => { throw Error('não deve chamar'); });
  assert.deepEqual(await ausente.status(), { disponivel: false });
  const desligado = criarGoogleAuth(config, async () => Response.json({ external: { google: false } }));
  assert.deepEqual(await desligado.status(), { disponivel: false });
});

test('Google PKCE, cadastro, vínculo e proteção de identidade pela API', async () => {
  await db.inicializar();
  const originalFetch = global.fetch;
  let challenge;
  let trocas = 0;
  let usuarioGoogle;
  global.fetch = async (url, opcoes) => {
    if (!String(url).startsWith(config.supabase.url)) return originalFetch(url, opcoes);
    assert.equal(opcoes.headers.apikey, 'publishable-test');
    const destino = new URL(url);
    if (destino.pathname.endsWith('/settings')) return Response.json({ external: { google: true } });
    if (destino.pathname.endsWith('/token')) {
      trocas++;
      const corpo = JSON.parse(opcoes.body);
      assert.equal(destino.searchParams.get('grant_type'), 'pkce');
      assert.equal(crypto.createHash('sha256').update(corpo.code_verifier).digest('base64url'), challenge);
      return Response.json({ access_token: 'supabase-token-apenas-servidor' });
    }
    assert.equal(destino.pathname, '/auth/v1/user');
    assert.equal(opcoes.headers.Authorization, 'Bearer supabase-token-apenas-servidor');
    return Response.json(usuarioGoogle);
  };
  const server = criarApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  config.urlPublica = base;
  const cookie = (res, nome) => res.headers.getSetCookie().filter(v => v.startsWith(nome + '=')).at(-1)?.split(';')[0];
  async function api(rota, sessao, corpo) {
    const res = await fetch(base + '/api/auth' + rota, {
      method: corpo ? 'POST' : 'GET', redirect: 'manual',
      headers: { Cookie: sessao || '', 'Content-Type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    return { res, dados: res.status === 302 ? null : await res.json() };
  }
  async function iniciar() {
    const { res } = await api('/google/iniciar');
    assert.equal(res.status, 302);
    const url = new URL(res.headers.get('location'));
    assert.equal(url.searchParams.get('provider'), 'google');
    assert.equal(url.searchParams.get('redirect_to'), base + '/api/auth/google/callback');
    assert.equal(url.searchParams.get('code_challenge_method'), 's256');
    challenge = url.searchParams.get('code_challenge');
    assert.match(res.headers.get('set-cookie'), /HttpOnly/);
    assert.match(res.headers.get('set-cookie'), /SameSite=Lax/);
    return cookie(res, 'cm_google_tx');
  }
  async function autenticar(id, email, extras = {}) {
    usuarioGoogle = { id, email, email_confirmed_at: '2026-01-01', identities: [{ provider: 'google' }],
      user_metadata: { full_name: 'Pessoa Google', papel: 'admin' }, ...extras };
    const tx = await iniciar();
    const { res } = await api('/google/callback?code=code-teste', tx);
    assert.equal(res.headers.get('location'), base + '/#/google');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.getSetCookie().find(v => v.startsWith('cm_google_tx=')), /Expires=Thu, 01 Jan 1970/);
    return { prova: cookie(res, 'cm_google_prova'), tx };
  }
  try {
    // Sem cookie não há troca de código nem sessão.
    const semCookie = await api('/google/callback?code=roubado');
    assert.equal(trocas, 0);
    assert.equal((await api('/google/resultado', cookie(semCookie.res, 'cm_google_prova'))).res.status, 400);
    const novo = await autenticar('google-novo', 'novo@teste.local');
    const pendente = await api('/google/resultado', novo.prova);
    assert.deepEqual(pendente.dados.cadastroGoogle, { nome: 'Pessoa Google', email: 'novo@teste.local' });
    assert.equal(pendente.dados.token, undefined);
    const contagem = trocas;
    await api('/google/callback?code=repetido', novo.tx);
    assert.equal(trocas, contagem, 'callback de uso único');
    const dadosCadastro = { nome: 'Pessoa Google', email: 'adulterado@teste.local', telefone: '62991522038', cidade: 'São Paulo', googleCadastro: true, papel: 'admin' };
    assert.equal((await api('/cadastro/cliente', null, dadosCadastro)).res.status, 400);
    const cadastrado = await api('/cadastro/cliente', novo.prova, dadosCadastro);
    assert.equal(cadastrado.res.status, 201);
    assert.equal(cadastrado.dados.usuario.email, 'novo@teste.local');
    assert.equal(cadastrado.dados.usuario.papel, 'cliente');
    assert.ok(cadastrado.dados.token);
    assert.equal(db.porId('usuarios', cadastrado.dados.usuario.id).senhaHash, null);
    assert.equal((await api('/google/resultado', novo.prova)).res.status, 400);
    const retorno = await autenticar('google-novo', 'novo@teste.local');
    assert.equal((await api('/google/resultado', retorno.prova)).dados.usuario.id, cadastrado.dados.usuario.id);
    assert.equal(db.ler('usuarios').length, 1, 'não duplica usuário no segundo login');

    await db.inserir('usuarios', { id: 'existente', email: 'existente@teste.local', nome: 'Prestador existente', papel: 'prestador', senhaHash: auth.gerarHashSenha('senha-local') });
    await db.inserir('prestadores', { id: 'perfil-existente', usuarioId: 'existente', status: 'aprovado' });
    const existente = await autenticar('google-existente', 'existente@teste.local');
    assert.equal((await api('/google/resultado', existente.prova)).dados.vincular, true);
    assert.equal((await api('/google/vincular', existente.prova, { senha: 'errada' })).res.status, 400);
    assert.equal(db.porId('usuarios', 'existente').supabaseUsuarioId, undefined);
    const vinculado = await api('/google/vincular', existente.prova, { senha: 'senha-local' });
    assert.equal(vinculado.dados.usuario.id, 'existente');
    assert.equal(vinculado.dados.usuario.papel, 'prestador');
    assert.equal(db.porId('prestadores', 'perfil-existente').status, 'aprovado');

    const prestador = await autenticar('google-prestador', 'prestador@teste.local');
    const form = new FormData();
    Object.entries({ ...dadosCadastro, categoria: 'eletrica', descricao: 'Serviços elétricos e instalações com segurança e experiência.', precoMedio: 100 }).forEach(([k, v]) => form.set(k, v));
    const criado = await fetch(base + '/api/auth/cadastro/prestador', { method: 'POST', headers: { Cookie: prestador.prova }, body: form });
    const corpo = await criado.json();
    assert.equal(criado.status, 201, JSON.stringify(corpo));
    assert.equal(corpo.prestador.status, 'pendente');
    assert.equal(corpo.usuario.email, 'prestador@teste.local');
    const admin = await autenticar('google-admin', config.admin.email);
    assert.equal((await api('/google/resultado', admin.prova)).res.status, 403);
    const naoConfirmado = await autenticar('nao-confirmado', 'nao@teste.local', { email_confirmed_at: null });
    assert.equal((await api('/google/resultado', naoConfirmado.prova)).res.status, 400);
    const semGoogle = await autenticar('sem-google', 'sem@teste.local', { identities: [{ provider: 'email' }] });
    assert.equal((await api('/google/resultado', semGoogle.prova)).res.status, 400);
    const forcaBruta = await autenticar('google-outra', 'existente@teste.local');
    for (let i = 0; i < 5; i++) assert.equal((await api('/google/vincular', forcaBruta.prova, { senha: 'errada' })).res.status, 400);
    assert.equal((await api('/google/vincular', forcaBruta.prova, { senha: 'senha-local' })).res.status, 429);
    const canceladoTx = await iniciar();
    const cancelado = await api('/google/callback?error=access_denied', canceladoTx);
    assert.match((await api('/google/resultado', cookie(cancelado.res, 'cm_google_prova'))).dados.erro, /cancelado/);
    if (process.env.TEST_BROWSER) await require('./test-google-browser')({ base });
  } finally {
    global.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await db.drenar();
  }
});
