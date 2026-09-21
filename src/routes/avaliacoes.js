// ============================================================
//  Avaliações — nota de 1 a 5 + comentário, só depois que a
//  solicitação foi concluída. Uma avaliação por solicitação.
//  O prestador pode responder uma vez (direito de resposta).
// ============================================================

const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const { recalcularReputacao } = require('../dominio');

const rotas = require('../router')();

// ============================================================
//  POST /api/avaliacoes
// ============================================================
rotas.post('/', auth.exigirSessao('cliente'), async (req, res) => {
  const { solicitacaoId, nota, comentario } = req.body || {};

  const solicitacao = db.porId('solicitacoes', solicitacaoId);
  if (!solicitacao) {
    return res.status(404).json({ erro: 'Solicitação não encontrada.' });
  }
  if (solicitacao.clienteUsuarioId !== req.usuario.id) {
    return res.status(403).json({ erro: 'Você só avalia serviços que você mesmo solicitou.' });
  }

  // A regra que sustenta a credibilidade das notas: sem serviço
  // concluído, não existe avaliação.
  if (solicitacao.status !== 'concluida') {
    return res.status(409).json({
      erro: 'Você só pode avaliar depois que o serviço for marcado como concluído.',
    });
  }

  if (db.buscar('avaliacoes', (a) => a.solicitacaoId === solicitacaoId)) {
    return res.status(409).json({ erro: 'Esta solicitação já foi avaliada.' });
  }

  const valor = Number(nota);
  if (!Number.isInteger(valor) || valor < 1 || valor > 5) {
    return res.status(400).json({ erro: 'A nota precisa ser um número inteiro de 1 a 5.' });
  }

  const texto = String(comentario || '').trim();
  if (texto.length > 1000) {
    return res.status(400).json({ erro: 'O comentário passa de 1000 caracteres.' });
  }

  const avaliacao = {
    id: crypto.randomUUID(),
    solicitacaoId,
    prestadorId: solicitacao.prestadorId,
    clienteUsuarioId: req.usuario.id,
    clienteNome: req.usuario.nome,
    nota: valor,
    comentario: texto,
    respostaPrestador: null,
    criadoEm: new Date().toISOString(),
  };

  await db.inserir('avaliacoes', avaliacao);
  const prestador = await recalcularReputacao(solicitacao.prestadorId);

  res.status(201).json({
    mensagem: 'Avaliação publicada. Obrigado por ajudar outros clientes a escolher!',
    avaliacao,
    reputacao: {
      notaMedia: prestador?.notaMedia ?? 0,
      totalAvaliacoes: prestador?.totalAvaliacoes ?? 0,
    },
  });
});

// ============================================================
//  GET /api/avaliacoes/prestador/:prestadorId
//  Lista pública das avaliações de um perfil.
// ============================================================
rotas.get('/prestador/:prestadorId', (req, res) => {
  const prestador = db.porId('prestadores', req.params.prestadorId);
  if (!prestador || (prestador.status !== 'aprovado' && req.usuario?.id !== prestador.usuarioId && req.usuario?.papel !== 'admin')) {
    return res.status(404).json({ erro: 'Prestador não encontrado.' });
  }

  const avaliacoes = db
    .filtrar('avaliacoes', (a) => a.prestadorId === prestador.id)
    .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

  // Distribuição 5→1 para desenhar as barrinhas do perfil.
  const distribuicao = [5, 4, 3, 2, 1].map((estrela) => ({
    estrela,
    total: avaliacoes.filter((a) => a.nota === estrela).length,
  }));

  res.json({
    notaMedia: prestador.notaMedia || 0,
    totalAvaliacoes: prestador.totalAvaliacoes || 0,
    distribuicao,
    avaliacoes: avaliacoes.map((a) => ({
      id: a.id,
      nota: a.nota,
      comentario: a.comentario,
      clienteNome: a.clienteNome,
      criadoEm: a.criadoEm,
      respostaPrestador: a.respostaPrestador,
    })),
  });
});

// ============================================================
//  POST /api/avaliacoes/:id/resposta — direito de resposta
// ============================================================
rotas.post('/:id/resposta', auth.exigirSessao('prestador'), async (req, res) => {
  const avaliacao = db.porId('avaliacoes', req.params.id);
  if (!avaliacao) {
    return res.status(404).json({ erro: 'Avaliação não encontrada.' });
  }

  const prestador = db.porId('prestadores', avaliacao.prestadorId);
  if (!prestador || prestador.usuarioId !== req.usuario.id) {
    return res.status(403).json({ erro: 'Esta avaliação não é do seu perfil.' });
  }
  if (avaliacao.respostaPrestador) {
    return res.status(409).json({ erro: 'Você já respondeu esta avaliação.' });
  }

  const texto = String(req.body?.texto || '').trim();
  if (texto.length < 3 || texto.length > 1000) {
    return res.status(400).json({ erro: 'A resposta precisa ter entre 3 e 1000 caracteres.' });
  }

  await db.atualizar('avaliacoes', avaliacao.id, {
    respostaPrestador: { texto, criadoEm: new Date().toISOString() },
  });

  res.json({ mensagem: 'Resposta publicada.' });
});

module.exports = rotas;
