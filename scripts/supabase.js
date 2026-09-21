// npm run supabase:check | npm run supabase:import
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { config } = require('../src/config');
const { COLECOES } = require('../src/db');
const { criarCliente } = require('../src/supabase');

async function executar() {
  const comando = process.argv[2];
  if (!['check', 'import'].includes(comando)) throw new Error('Use check ou import.');
  const cliente = criarCliente(config.supabase);
  const atual = await cliente.lerBase();
  for (const nome of COLECOES) {
    assert.ok(Array.isArray(atual?.[nome]?.registros), `Coleção ausente: ${nome}`);
    assert.ok(Number.isSafeInteger(atual[nome].revisao), `Revisão inválida: ${nome}`);
  }
  if (comando === 'import') {
    if (COLECOES.some(nome => atual[nome].revisao !== 0 || atual[nome].registros.length)) {
      throw new Error('Importação recusada: o banco remoto já foi utilizado. Nenhum dado foi substituído.');
    }
    const base = {};
    for (const nome of COLECOES) {
      // Arquivo ausente ou inválido interrompe tudo antes de gravar no banco.
      base[nome] = JSON.parse(await fs.readFile(path.join(config.caminhos.dados, `${nome}.json`), 'utf8'));
      assert.ok(Array.isArray(base[nome]), `Coleção inválida: ${nome}`);
      assert.equal(new Set(base[nome].map(r => r.id)).size, base[nome].length, `IDs repetidos em ${nome}`);
      assert.ok(base[nome].every(r => typeof r.id === 'string' && r.id), `Registro sem ID em ${nome}`);
    }
    await cliente.importar(base);
    const conferida = await cliente.lerBase();
    for (const nome of COLECOES) assert.deepEqual(conferida[nome].registros, base[nome], `Importação divergente: ${nome}`);
    console.log('Importação confirmada. Os arquivos locais foram preservados.');
  }
  const verificada = await cliente.lerBase();
  console.log(`Conexão confirmada: ${config.supabase.url}`);
  for (const nome of COLECOES) console.log(`  ${nome}: ${verificada[nome].registros.length} registros`);
}

executar().catch(erro => { console.error(erro.message); process.exitCode = 1; });
