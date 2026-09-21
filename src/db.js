// ============================================================
//  Camada de persistência — arquivos JSON com escrita atômica
// ------------------------------------------------------------
//  Mantém o mesmo espírito do projeto original (JSON simples,
//  sem banco), mas corrige os dois problemas que a versão
//  anterior tinha: leitura a cada request e escrita não-atômica
//  (um crash no meio do writeFile corrompia o arquivo inteiro).
//
//  Estratégia:
//   - a coleção fica em memória depois da primeira leitura;
//   - toda escrita vai para "arquivo.tmp" e depois é renomeada,
//     o que é atômico no mesmo volume;
//   - escritas são serializadas numa fila por coleção, então
//     dois requests simultâneos nunca se sobrescrevem.
// ============================================================

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { config } = require('./config');
const { criarCliente } = require('./supabase');
let remoto = null;
let falhaRemota = null;
let pronto = false;
const revisoes = new Map();

function exigirPronto() {
  if (config.banco === 'supabase' && (!pronto || falhaRemota)) {
    const erro = new Error('Banco indisponível. Reinicie o servidor para recarregar os dados do Supabase.');
    erro.status = 503;
    throw erro;
  }
}

async function inicializarSupabase() {
  remoto = criarCliente(config.supabase);
  const base = await remoto.lerBase();
  for (const nome of COLECOES) {
    if (!Array.isArray(base?.[nome]?.registros) || !Number.isSafeInteger(base[nome].revisao)) {
      throw new Error('Estrutura do Supabase incompleta: ' + nome);
    }
  }
  for (const nome of COLECOES) {
    cache.set(nome, base[nome].registros);
    revisoes.set(nome, base[nome].revisao);
  }
  fs.mkdirSync(config.caminhos.uploads, { recursive: true });
  falhaRemota = null;
  pronto = true;
}

const COLECOES = [
  'usuarios',
  'prestadores',
  'clientes',
  'solicitacoes',
  'mensagens',
  'avaliacoes',
  'notificacoes',
];

const cache = new Map();      // nome -> array
const filas = new Map();      // nome -> Promise encadeada

function caminhoDe(nome) {
  return path.join(config.caminhos.dados, `${nome}.json`);
}

function garantirPastas() {
  for (const dir of [config.caminhos.dados, config.caminhos.uploads]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function carregarSincrono(nome) {
  const caminho = caminhoDe(nome);
  try {
    const bruto = fs.readFileSync(caminho, 'utf-8');
    const dados = JSON.parse(bruto);
    return Array.isArray(dados) ? dados : [];
  } catch (erro) {
    if (erro.code !== 'ENOENT') {
      console.warn(`[db] "${nome}.json" ilegível (${erro.message}). Começando vazio.`);
      // Preserva o arquivo problemático em vez de sobrescrever silenciosamente.
      try {
        fs.renameSync(caminho, `${caminho}.corrompido`);
        console.warn(`[db] Backup salvo em ${nome}.json.corrompido`);
      } catch { /* ignora */ }
    }
    return [];
  }
}

// Inicializa todas as coleções na subida do servidor.
function inicializar() {
  if (config.banco === 'supabase') return inicializarSupabase();
  if (config.banco !== 'json') throw new Error('DB_DRIVER deve ser json ou supabase.');
  garantirPastas();
  for (const nome of COLECOES) {
    cache.set(nome, carregarSincrono(nome));
    if (!fs.existsSync(caminhoDe(nome))) {
      fs.writeFileSync(caminhoDe(nome), '[]', 'utf-8');
    }
  }
}

// Lê a coleção inteira (referência viva do cache — não mutar fora do db).
function ler(nome) {
  exigirPronto();
  if (!cache.has(nome)) cache.set(nome, carregarSincrono(nome));
  return cache.get(nome);
}

// Enfileira a persistência para evitar escritas concorrentes.
function persistir(nome) {
  exigirPronto();
  if (config.banco === 'supabase') {
    // Snapshot por chamada; revisões impedem sobrescrever dados de outro processo.
    const registros = structuredClone(cache.get(nome));
    const anterior = filas.get(nome) || Promise.resolve();
    const proxima = anterior.then(async () => {
      exigirPronto();
      const revisao = await remoto.gravar(nome, revisoes.get(nome), registros);
      if (!Number.isSafeInteger(revisao)) throw new Error('Resposta inválida do Supabase.');
      revisoes.set(nome, revisao);
    }).catch(erro => {
      falhaRemota = erro;
      // Uma resposta perdida pode ter sido gravada. Não repetir nem cair no JSON.
      throw erro;
    });
    filas.set(nome, proxima);
    return proxima;
  }
  const anterior = filas.get(nome) || Promise.resolve();
  const proxima = anterior
    .catch(() => {})
    .then(async () => {
      const caminho = caminhoDe(nome);
      const temporario = `${caminho}.tmp`;
      const conteudo = JSON.stringify(cache.get(nome) ?? [], null, 2);
      await fsp.writeFile(temporario, conteudo, 'utf-8');
      await fsp.rename(temporario, caminho); // atômico no mesmo volume
    })
    .catch((erro) => {
      console.error(`[db] Falha ao gravar "${nome}.json":`, erro.message);
    });
  filas.set(nome, proxima);
  return proxima;
}

// ── API de conveniência ─────────────────────────────────────

async function inserir(nome, registro) {
  ler(nome).push(registro);
  await persistir(nome);
  return registro;
}

function buscar(nome, predicado) {
  return ler(nome).find(predicado) || null;
}

function filtrar(nome, predicado) {
  return ler(nome).filter(predicado);
}

function porId(nome, id) {
  return buscar(nome, (item) => item.id === id);
}

async function atualizar(nome, id, mudancas) {
  const item = porId(nome, id);
  if (!item) return null;
  Object.assign(item, mudancas, { atualizadoEm: new Date().toISOString() });
  await persistir(nome);
  return item;
}

async function remover(nome, id) {
  const lista = ler(nome);
  const indice = lista.findIndex((item) => item.id === id);
  if (indice === -1) return false;
  lista.splice(indice, 1);
  await persistir(nome);
  return true;
}

// Aguarda todas as gravações pendentes — usado no shutdown.
async function drenar() {
  await Promise.allSettled([...filas.values()]);
}

module.exports = {
  COLECOES,
  saudavel: () => config.banco === 'json' || (pronto && !falhaRemota),
  inicializar,
  ler,
  buscar,
  filtrar,
  porId,
  inserir,
  atualizar,
  remover,
  persistir,
  drenar,
};
