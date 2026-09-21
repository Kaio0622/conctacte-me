const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'contactme-test-'));
Object.assign(process.env, {
  DB_DRIVER: 'json',
  DATA_DIR: path.join(temporary, 'data'), UPLOADS_DIR: path.join(temporary, 'uploads'),
  WHATSAPP_PROVIDER: 'link', ADMIN_EMAIL: 'admin@contactme.local', ADMIN_SENHA: 'admin123',
});
const db = require('../src/db');
const auth = require('../src/auth');
const { criarApp } = require('../src/app');
const geo = require('../src/geo');

async function main() {
  const testesSupabase = spawnSync(process.execPath, ['--test', path.join(__dirname, 'supabase.test.js'), path.join(__dirname, 'google.test.js')], { env: process.env, stdio: 'inherit' });
  assert.equal(testesSupabase.status, 0, 'Testes do Supabase e do login Google');
  const seed = spawnSync(process.execPath, [path.join(__dirname, 'seed.js')], { env: process.env, encoding: 'utf8' });
  assert.equal(seed.status, 0, seed.stderr);
  db.inicializar();
  const server = criarApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  require('../src/config').config.urlPublica = base;
  async function api(route, token, body, method = 'POST') {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  try {
    await new Promise((resolve, reject) => {
      const smoke = spawn(process.execPath, [path.join(__dirname, 'smoke.js'), base], { stdio: 'inherit' });
      smoke.on('error', reject);
      smoke.on('exit', code => code === 0 ? resolve() : reject(new Error(`Smoke: ${code}`)));
    });
    assert.equal(geo.resolverPonto({ cidade: 'São Paulo', lat: '', lng: '' }).origem, 'cidade');
    assert.equal(geo.resolverPonto({ lat: 91, lng: 181 }), null);
    assert.equal(geo.resolverPonto({ lat: 0, lng: 0 }).lat, 0);
    const cliente = db.buscar('usuarios', u => u.email === 'ana@exemplo.com');
    const prestador = db.buscar('usuarios', u => u.email === 'carlos@exemplo.com');
    const perfil = db.buscar('prestadores', p => p.usuarioId === prestador.id);
    const tokenC = auth.criarTokenSessao(cliente);
    const tokenP = auth.criarTokenSessao(prestador);
    const tokenA = auth.criarTokenSessao({ id: 'admin', papel: 'admin', nome: 'Admin' });
    await require('./test-chat-fotos')({ base, tokenC, tokenP, tokenA, db, cliente, perfil });
    await db.inserir('solicitacoes', { id: 'regressao', clienteUsuarioId: cliente.id, prestadorId: perfil.id, status: 'aberta', criadoEm: new Date().toISOString() });
    const route = '/api/chat/regressao/mensagens';
    const primeira = await api(route, tokenC, { texto: 'Primeira mensagem' });
    const stamp = db.porId('mensagens', primeira.data.mensagem.id).criadoEm;
    await db.inserir('mensagens', { id: 'simultanea', solicitacaoId: 'regressao', autorId: cliente.id, texto: 'Mesmo milissegundo', criadoEm: stamp });
    const novas = await api(`${route}?desde=${primeira.data.mensagem.id}`, tokenP);
    assert.deepEqual(novas.data.mensagens.map(m => m.id), ['simultanea']);
    const segunda = await api(route, tokenC, { texto: 'Ainda não lida' });
    await api(route, tokenA);
    assert.equal(db.porId('mensagens', segunda.data.mensagem.id).lidaEm, null, 'admin não marca como lida');
    assert.equal((await api(route, tokenA, { texto: 'Admin' })).status, 403);
    const cursor = segunda.data.mensagem.id;
    let respondeu = false;
    const espera = api(`${route}?desde=${cursor}&aguardar=1&status=aberta`, tokenC).then(r => { respondeu = true; return r; });
    await new Promise(r => setTimeout(r, 150));
    assert.equal(respondeu, false, 'long polling aguarda novidade');
    await api(route, tokenP, { texto: 'Resposta em tempo real' });
    const recebida = await espera;
    assert.equal(recebida.data.mensagens[0].texto, 'Resposta em tempo real');
    const statusPendente = api(`${route}?desde=${recebida.data.cursor}&aguardar=1&status=aberta`, tokenC);
    await api('/api/solicitacoes/regressao/status', tokenP, { status: 'recusada' }, 'PATCH');
    assert.equal((await statusPendente).data.solicitacao.status, 'recusada');
    assert.equal((await api(route, tokenC, { texto: 'Encerrada' })).status, 409);
    assert.equal((await api('/api/solicitacoes', tokenC, { descricao: {}, prestadorId: perfil.id })).status, 400);
    assert.equal((await api('/api/auth/login', '', { email: cliente.email, senha: {} })).status, 400);
    const pendente = db.buscar('prestadores', p => p.status === 'pendente');
    assert.equal((await api(`/api/avaliacoes/prestador/${pendente.id}`, '')).status, 404);
    console.log('Regressões de chat, permissões, validação e localização: OK');
    if (process.env.TEST_BROWSER) {
      await require('./test-browser')({ base, tokenC, cliente, tokenP, prestador, db });
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await db.drenar();
    // Dados temporários preservados para diagnóstico; nunca toca data/ ou uploads/ reais.
    console.log(`Dados de teste: ${temporary}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
