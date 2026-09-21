const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { pasta } = require('../src/chat-upload');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64');

module.exports = async ({ base, tokenC, tokenP, tokenA, db, cliente, perfil }) => {
  const rota = '/api/chat/fotos-teste/mensagens';
  await db.inserir('solicitacoes', { id: 'fotos-teste', clienteUsuarioId: cliente.id, prestadorId: perfil.id, status: 'aberta', criadoEm: new Date().toISOString() });
  async function enviar(token, buffer = png, tipo = 'image/png', texto = '') {
    const form = new FormData(); form.set('texto', texto); form.set('imagem', new Blob([buffer], { type: tipo }), 'foto.png');
    return fetch(base + rota, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  }
  assert.equal((await enviar('')).status, 401);
  assert.equal((await enviar(tokenA)).status, 403);
  assert.equal((await enviar(tokenC, Buffer.from('<svg/>'), 'image/svg+xml')).status, 400);
  assert.equal((await enviar(tokenC, Buffer.from('falso'), 'image/png')).status, 400);
  assert.equal((await enviar(tokenC, Buffer.alloc(4 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await enviar(tokenC, png, 'image/png', 'a'.repeat(2001))).status, 400);
  const resposta = await enviar(tokenC);
  assert.equal(resposta.status, 201);
  const { mensagem } = await resposta.json();
  assert.equal(mensagem.texto, '');
  assert.ok(mensagem.imagem.url);
  assert.equal(mensagem.imagem.arquivo, undefined);
  assert.equal((await fetch(base + mensagem.imagem.url)).status, 401);
  const alheio = db.buscar('usuarios', u => u.papel === 'cliente' && u.id !== cliente.id);
  const tokenAlheio = require('../src/auth').criarTokenSessao(alheio);
  assert.equal((await fetch(base + mensagem.imagem.url, { headers: { Authorization: `Bearer ${tokenAlheio}` } })).status, 403);
  for (const token of [tokenC, tokenP, tokenA]) {
    const foto = await fetch(base + mensagem.imagem.url, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(foto.status, 200); assert.match(foto.headers.get('content-type'), /image\/png/);
    assert.match(foto.headers.get('cache-control'), /no-store/);
    assert.deepEqual(Buffer.from(await foto.arrayBuffer()), png);
  }
  const legenda = await enviar(tokenP, png, 'image/png', 'Foto com legenda');
  assert.equal((await legenda.json()).mensagem.texto, 'Foto com legenda');
  const historico = await fetch(base + rota, { headers: { Authorization: `Bearer ${tokenP}` } }).then(r => r.json());
  assert.equal(historico.mensagens.length, 2);
  assert.ok(historico.mensagens.every(m => m.imagem));
  const registro = db.porId('mensagens', mensagem.id);
  const publico = await fetch(base + '/uploads/' + registro.imagem.arquivo);
  assert.ok(!publico.headers.get('content-type')?.startsWith('image/'), 'foto privada não é servida em uploads');
  const antes = (await fs.readdir(pasta())).length;
  await db.atualizar('solicitacoes', 'fotos-teste', { status: 'cancelada' });
  assert.equal((await enviar(tokenC)).status, 409);
  assert.equal((await fs.readdir(pasta())).length, antes);
  console.log('Fotos do chat: upload, legenda, histórico, limites e acesso privado OK');
};
