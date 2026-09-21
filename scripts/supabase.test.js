const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarCliente } = require('../src/supabase');
const url = 'https://projeto-de-teste.supabase.co';

test('chave moderna fica apenas no apikey e revisão acompanha a gravação', async () => {
  let chamada;
  const cliente = criarCliente({ url, chave: 'sb_secret_somente_teste' }, async (destino, opcoes) => {
    chamada = { destino, opcoes };
    return new Response('8', { status: 200 });
  });
  assert.equal(await cliente.gravar('mensagens', 7, [{ id: 'm1', texto: 'Olá' }]), 8);
  assert.equal(chamada.destino, `${url}/rest/v1/rpc/cm_gravar_colecao`);
  assert.equal(chamada.opcoes.headers.Authorization, undefined);
  assert.equal(chamada.opcoes.headers.apikey, 'sb_secret_somente_teste');
  assert.deepEqual(JSON.parse(chamada.opcoes.body), { colecao: 'mensagens', revisao_esperada: 7, registros: [{ id: 'm1', texto: 'Olá' }] });
});

test('recusa chave pública e URL insegura antes de acessar a rede', () => {
  assert.throws(() => criarCliente({ url, chave: 'sb_publishable_teste' }), /secreta/);
  assert.throws(() => criarCliente({ url: 'http://example.com', chave: 'sb_secret_teste' }), /HTTPS/);
  assert.throws(() => criarCliente({ url, chave: '' }), /SUPABASE_SECRET_KEY/);
});

test('falha de rede não é repetida automaticamente nem revela credenciais', async () => {
  let chamadas = 0;
  const cliente = criarCliente({ url, chave: 'sb_secret_nao_exibir' }, async () => {
    chamadas++;
    throw new Error('sb_secret_nao_exibir');
  });
  await assert.rejects(cliente.gravar('mensagens', 1, []), erro => erro.status === 503 && !erro.message.includes('sb_secret'));
  assert.equal(chamadas, 1);
});

test('conflito de revisão informa que deve recarregar em vez de sobrescrever', async () => {
  const cliente = criarCliente({ url, chave: 'sb_secret_teste' }, async () => new Response(JSON.stringify({ code: '40001' }), { status: 409 }));
  await assert.rejects(cliente.gravar('mensagens', 1, []), /outra instância/);
});

test('service_role legada é aceita e erros remotos não expõem o corpo recebido', async () => {
  const cliente = criarCliente({ url, chave: 'jwt-legado-de-teste' }, async (_destino, opcoes) => {
    assert.equal(opcoes.headers.Authorization, 'Bearer jwt-legado-de-teste');
    return new Response(JSON.stringify({ message: 'conteudo confidencial' }), { status: 401 });
  });
  await assert.rejects(cliente.lerBase(), erro => erro.status === 503 && erro.message === 'Chave do Supabase inválida.');
});
