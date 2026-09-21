// ============================================================
//  Regras de domínio compartilhadas entre as rotas
//  (categorias, cálculo de reputação, projeção pública dos
//  prestadores e o score de match distância × avaliação).
// ============================================================

const db = require('./db');
const { distanciaKm } = require('./geo');

const CATEGORIAS = [
  { slug: 'eletrica', nome: 'Elétrica', icone: 'eletrica' },
  { slug: 'hidraulica', nome: 'Hidráulica', icone: 'hidraulica' },
  { slug: 'pintura', nome: 'Pintura', icone: 'pintura' },
  { slug: 'limpeza', nome: 'Limpeza', icone: 'limpeza' },
  { slug: 'reforma', nome: 'Reforma e Alvenaria', icone: 'reforma' },
  { slug: 'marcenaria', nome: 'Marcenaria', icone: 'marcenaria' },
  { slug: 'jardinagem', nome: 'Jardinagem', icone: 'jardinagem' },
  { slug: 'ar-condicionado', nome: 'Ar-condicionado', icone: 'ar-condicionado' },
  { slug: 'mudancas', nome: 'Mudanças e Fretes', icone: 'mudancas' },
  { slug: 'informatica', nome: 'Informática', icone: 'informatica' },
  { slug: 'beleza', nome: 'Beleza e Estética', icone: 'beleza' },
  { slug: 'aulas', nome: 'Aulas Particulares', icone: 'aulas' },
  { slug: 'fotografia', nome: 'Fotografia', icone: 'fotografia' },
  { slug: 'eventos', nome: 'Eventos e Buffet', icone: 'eventos' },
  { slug: 'pets', nome: 'Cuidados com Pets', icone: 'pets' },
  { slug: 'costura', nome: 'Costura', icone: 'costura' },
];

const MAPA_CATEGORIAS = new Map(CATEGORIAS.map((c) => [c.slug, c]));

const STATUS_PRESTADOR = ['pendente', 'aprovado', 'rejeitado', 'suspenso'];
const STATUS_SOLICITACAO = ['aberta', 'aceita', 'recusada', 'concluida', 'cancelada'];

function nomeCategoria(slug) {
  return MAPA_CATEGORIAS.get(slug)?.nome || slug;
}

// ── Reputação ───────────────────────────────────────────────

// Recalcula média e total de avaliações de um prestador.
async function recalcularReputacao(prestadorId) {
  const avaliacoes = db.filtrar('avaliacoes', (a) => a.prestadorId === prestadorId);
  const total = avaliacoes.length;
  const soma = avaliacoes.reduce((acc, a) => acc + a.nota, 0);
  const media = total ? Number((soma / total).toFixed(2)) : 0;
  return db.atualizar('prestadores', prestadorId, {
    notaMedia: media,
    totalAvaliacoes: total,
  });
}

// Média bayesiana: um prestador com uma única nota 5 não passa
// na frente de outro com 4,8 de média em 40 avaliações.
const PESO_PRIOR = 5;   // "peso" de avaliações imaginárias
const NOTA_PRIOR = 4.0; // nota neutra da plataforma

function notaPonderada(prestador) {
  const total = prestador.totalAvaliacoes || 0;
  const media = prestador.notaMedia || 0;
  return (PESO_PRIOR * NOTA_PRIOR + total * media) / (PESO_PRIOR + total);
}

// ── Score de match (distância × avaliação) ──────────────────
//
// O spec pede "ordenados por distância e avaliação". Em vez de
// um sort em cascata (que faz a avaliação quase nunca importar,
// já que distâncias raramente empatam), combinamos os dois em
// um score 0–1 — e deixamos o cliente escolher outra ordem.

function scoreProximidade(distancia, raioAtendimento) {
  if (distancia == null) return 0.5; // sem geo: não penaliza nem premia
  // Decaimento suave: 0 km → 1.0 ; no limite do raio → ~0.5
  const escala = Math.max(raioAtendimento, 5);
  return 1 / (1 + distancia / escala);
}

function scoreAvaliacao(prestador) {
  return Math.min(1, Math.max(0, (notaPonderada(prestador) - 1) / 4));
}

function calcularScore(prestador, distancia) {
  const proximidade = scoreProximidade(distancia, prestador.areaAtendimento?.raioKm || 20);
  const avaliacao = scoreAvaliacao(prestador);
  return Number((0.6 * proximidade + 0.4 * avaliacao).toFixed(4));
}

// ── Projeção pública ────────────────────────────────────────

// Monta o objeto que vai para o frontend. Nunca vaza senha,
// e o telefone só aparece para quem já tem conversa aberta.
function projetarPrestador(prestador, opcoes = {}) {
  const { distancia = null, incluirContato = false, incluirAvaliacoes = false } = opcoes;
  const usuario = db.porId('usuarios', prestador.usuarioId);

  const base = {
    id: prestador.id,
    nome: usuario?.nome || 'Prestador',
    categoria: prestador.categoria,
    categoriaNome: nomeCategoria(prestador.categoria),
    descricao: prestador.descricao,
    precoMedio: prestador.precoMedio,
    unidadePreco: prestador.unidadePreco,
    fotos: prestador.fotos || [],
    areaAtendimento: prestador.areaAtendimento,
    notaMedia: prestador.notaMedia || 0,
    totalAvaliacoes: prestador.totalAvaliacoes || 0,
    // ── O selo. Só é true depois da aprovação manual. ──
    verificado: prestador.status === 'aprovado',
    status: prestador.status,
    membroDesde: prestador.criadoEm,
    distanciaKm: distancia == null ? null : Number(distancia.toFixed(1)),
    score: calcularScore(prestador, distancia),
  };

  if (incluirContato && usuario) {
    base.telefone = usuario.telefone;
    base.email = usuario.email;
  }

  if (incluirAvaliacoes) {
    base.avaliacoes = db
      .filtrar('avaliacoes', (a) => a.prestadorId === prestador.id)
      .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm))
      .map((a) => ({
        id: a.id,
        nota: a.nota,
        comentario: a.comentario,
        clienteNome: a.clienteNome,
        criadoEm: a.criadoEm,
        respostaPrestador: a.respostaPrestador || null,
      }));
  }

  return base;
}

// Distância entre um ponto de referência e o prestador.
function distanciaAte(prestador, ponto) {
  if (!ponto || !prestador.areaAtendimento) return null;
  return distanciaKm(ponto, {
    lat: prestador.areaAtendimento.lat,
    lng: prestador.areaAtendimento.lng,
  });
}

module.exports = {
  CATEGORIAS,
  MAPA_CATEGORIAS,
  STATUS_PRESTADOR,
  STATUS_SOLICITACAO,
  nomeCategoria,
  recalcularReputacao,
  notaPonderada,
  calcularScore,
  projetarPrestador,
  distanciaAte,
};
