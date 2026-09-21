// Verificação remota com um registro sintético, removido ao terminar.
// Não importa arquivos data/ nem utiliza cadastros locais.
process.env.DB_DRIVER = 'supabase';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { config } = require('../src/config');
const db = require('../src/db');
const { criarCliente } = require('../src/supabase');

async function main() {
  const cliente = criarCliente(config.supabase);
  const id = `teste-conexao-${crypto.randomUUID()}`;
  await db.inicializar();
  try {
    await db.inserir('notificacoes', { id, tipo: 'teste-sintetico', status: 'inicial' });
    await db.atualizar('notificacoes', id, { status: 'confirmado' });
    const recarregada = await cliente.lerBase();
    assert.equal(recarregada.notificacoes.registros.find(r => r.id === id)?.status, 'confirmado');
    console.log('Gravação, atualização e leitura independente no Supabase: OK');
  } finally {
    await db.remover('notificacoes', id);
    await db.drenar();
  }
  assert.equal((await cliente.lerBase()).notificacoes.registros.some(r => r.id === id), false);
  // Um cliente público não pode acessar as coleções privadas do backend.
  if (process.env.SUPABASE_PUBLISHABLE_KEY) {
    const resposta = await fetch(`${config.supabase.url}/rest/v1/rpc/cm_ler_base`, {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(20000),
    });
    assert.ok([401, 403, 404].includes(resposta.status), `Acesso público inesperado: ${resposta.status}`);
    console.log('Chave pública impedida de ler dados privados: OK');
  }
  console.log('Registro sintético removido.');
}
main().catch(erro => { console.error(erro.message); process.exitCode = 1; });
