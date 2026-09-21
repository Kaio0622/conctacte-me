// ============================================================
//  Solicitações — o pedido de serviço que o cliente abre para
//  um prestador. Cada solicitação também é a "sala" do chat
//  interno e o pré-requisito da avaliação.
//
//  Fluxo:  aberta → aceita → concluida
//                 ↘ recusada
//          (cliente pode cancelar enquanto não estiver concluída)
// ============================================================

const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const { nomeCategoria } = require('../dominio');

const rotas = require('../router')();

const TRANSICOES = {
  aberta: ['aceita', 'recusada', 'cancelada'],
  aceita: ['concluida', 'cancelada'],
  recusada: [],
  concluida: [],
  cancelada: [],
};

// Monta o objeto de solicitação que vai para a tela, já com os
// nomes das duas pontas e o resumo do chat.
function projetar(solicitacao, papelDeQuemPede) {
  const prestador = db.porId('prestadores', solicitacao.prestadorId);
  const usuarioPrestador = prestador ? db.porId('usuarios', prestador.usuarioId) : null;
  const usuarioCliente = db.porId('usuarios', solicitacao.clienteUsuarioId);

  const mensagens = db.filtrar('mensagens', (m) => m.solicitacaoId === solicitacao.id);
  const naoLidas = mensagens.filter(
    (m) => m.autorId !== papelDeQuemPede.id && !m.lidaEm
  ).length;
  const ultima = mensagens[mensagens.length - 1] || null;

  const avaliacao = db.buscar('avaliacoes', (a) => a.solicitacaoId === solicitacao.id);

  return {
    id: solicitacao.id,
    status: solicitacao.status,
    descricao: solicitacao.descricao,
    criadoEm: solicitacao.criadoEm,
    atualizadoEm: solicitacao.atualizadoEm || solicitacao.criadoEm,
    concluidaEm: solicitacao.concluidaEm || null,
    prestador: prestador && {
      id: prestador.id,
      nome: usuarioPrestador?.nome || 'Prestador',
      categoria: prestador.categoria,
      categoriaNome: nomeCategoria(prestador.categoria),
      foto: prestador.fotos?.[0] || null,
      verificado: prestador.status === 'aprovado',
      notaMedia: prestador.notaMedia,
      totalAvaliacoes: prestador.totalAvaliacoes,
    },
    cliente: {
      id: solicitacao.clienteUsuarioId,
      nome: usuarioCliente?.nome || 'Cliente',
      localizacao: solicitacao.localizacaoCliente?.rotulo || null,
    },
    chat: {
      totalMensagens: mensagens.length,
      naoLidas,
      ultimaMensagem: ultima && {
        texto: (ultima.texto || (ultima.imagem ? 'Foto' : '')).slice(0, 120),
        criadoEm: ultima.criadoEm,
        souEuAutor: ultima.autorId === papelDeQuemPede.id,
      },
    },
    // O botão "Avaliar" só aparece quando isto é true.
    podeAvaliar:
      solicitacao.status === 'concluida' &&
      !avaliacao &&
      papelDeQuemPede.id === solicitacao.clienteUsuarioId,
    avaliacao: avaliacao && { nota: avaliacao.nota, comentario: avaliacao.comentario },
  };
}

// Garante que quem pede é uma das duas pontas da solicitação.
function carregarSolicitacao(req, res, proximo) {
  const solicitacao = db.porId('solicitacoes', req.params.id);
  if (!solicitacao) {
    return res.status(404).json({ erro: 'Solicitação não encontrada.' });
  }

  const prestador = db.porId('prestadores', solicitacao.prestadorId);
  const souCliente = solicitacao.clienteUsuarioId === req.usuario.id;
  const souPrestador = prestador && prestador.usuarioId === req.usuario.id;

  if (!souCliente && !souPrestador && req.usuario.papel !== 'admin') {
    return res.status(403).json({ erro: 'Esta solicitação não é sua.' });
  }

  req.solicitacao = solicitacao;
  req.souCliente = souCliente;
  req.souPrestador = Boolean(souPrestador);
  proximo();
}

// ============================================================
//  POST /api/solicitacoes — cliente abre o pedido (e o chat)
// ============================================================
rotas.post('/', auth.exigirSessao('cliente'), async (req, res) => {
  const { prestadorId, descricao } = req.body || {};

  if (typeof descricao !== 'string' || descricao.trim().length < 10 || descricao.length > 2000) {
    return res.status(400).json({ erro: 'Descreva o que você precisa (mínimo 10 caracteres).' });
  }

  const prestador = db.porId('prestadores', prestadorId);
  if (!prestador || prestador.status !== 'aprovado') {
    return res.status(404).json({ erro: 'Prestador indisponível.' });
  }
  if (prestador.usuarioId === req.usuario.id) {
    return res.status(400).json({ erro: 'Você não pode solicitar um serviço para si mesmo.' });
  }

  // Evita abrir dez pedidos idênticos para o mesmo prestador.
  const emAberto = db.buscar(
    'solicitacoes',
    (s) =>
      s.clienteUsuarioId === req.usuario.id &&
      s.prestadorId === prestadorId &&
      ['aberta', 'aceita'].includes(s.status)
  );
  if (emAberto) {
    return res.status(409).json({
      erro: 'Você já tem uma solicitação em andamento com este profissional.',
      solicitacaoId: emAberto.id,
    });
  }

  const cliente = db.buscar('clientes', (c) => c.usuarioId === req.usuario.id);

  const solicitacao = {
    id: crypto.randomUUID(),
    clienteUsuarioId: req.usuario.id,
    prestadorId,
    descricao: descricao.trim(),
    localizacaoCliente: cliente?.localizacao || null,
    status: 'aberta',
    criadoEm: new Date().toISOString(),
    concluidaEm: null,
  };
  await db.inserir('solicitacoes', solicitacao);

  // A descrição vira a primeira mensagem do chat — assim o
  // prestador já abre a conversa com o contexto do pedido.
  await db.inserir('mensagens', {
    id: crypto.randomUUID(),
    solicitacaoId: solicitacao.id,
    autorId: req.usuario.id,
    autorNome: req.usuario.nome,
    autorPapel: 'cliente',
    texto: solicitacao.descricao,
    lidaEm: null,
    criadoEm: solicitacao.criadoEm,
  });

  res.status(201).json({
    mensagem: 'Solicitação enviada! Converse pelo chat para combinar os detalhes.',
    solicitacao: projetar(solicitacao, req.usuario),
  });
});

// ============================================================
//  GET /api/solicitacoes — histórico (cliente ou prestador)
// ============================================================
rotas.get('/', auth.exigirSessao(), (req, res) => {
  const { status } = req.query;
  let minhas;

  if (req.usuario.papel === 'prestador') {
    const prestador = db.buscar('prestadores', (p) => p.usuarioId === req.usuario.id);
    minhas = prestador ? db.filtrar('solicitacoes', (s) => s.prestadorId === prestador.id) : [];
  } else {
    minhas = db.filtrar('solicitacoes', (s) => s.clienteUsuarioId === req.usuario.id);
  }

  if (status) minhas = minhas.filter((s) => s.status === status);

  minhas.sort((a, b) => new Date(b.atualizadoEm || b.criadoEm) - new Date(a.atualizadoEm || a.criadoEm));

  res.json({
    total: minhas.length,
    solicitacoes: minhas.map((s) => projetar(s, req.usuario)),
  });
});

// GET /api/solicitacoes/:id
rotas.get('/:id', auth.exigirSessao(), carregarSolicitacao, (req, res) => {
  res.json(projetar(req.solicitacao, req.usuario));
});

// ============================================================
//  PATCH /api/solicitacoes/:id/status
//    prestador: aceita | recusada | concluida
//    cliente:   cancelada | concluida
// ============================================================
rotas.patch('/:id/status', auth.exigirSessao(), carregarSolicitacao, async (req, res) => {
  const { status } = req.body || {};
  const atual = req.solicitacao.status;

  if (!TRANSICOES[atual]?.includes(status)) {
    return res.status(409).json({
      erro: `Não dá para mudar de "${atual}" para "${status}".`,
    });
  }

  const permissoes = {
    aceita: req.souPrestador,
    recusada: req.souPrestador,
    // Qualquer uma das partes pode marcar como concluído.
    concluida: req.souPrestador || req.souCliente,
    cancelada: req.souCliente,
  };
  if (!permissoes[status]) {
    return res.status(403).json({ erro: 'Você não pode aplicar essa mudança.' });
  }

  const mudancas = { status };
  if (status === 'concluida') mudancas.concluidaEm = new Date().toISOString();

  const atualizada = await db.atualizar('solicitacoes', req.solicitacao.id, mudancas);

  const avisos = {
    aceita: 'Solicitação aceita! Combine os detalhes pelo chat.',
    recusada: 'Solicitação recusada.',
    concluida: 'Serviço concluído. O cliente já pode avaliar o profissional.',
    cancelada: 'Solicitação cancelada.',
  };

  res.json({ mensagem: avisos[status], solicitacao: projetar(atualizada, req.usuario) });
});

module.exports = { rotas, carregarSolicitacao, projetar };
