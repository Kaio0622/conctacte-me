// ============================================================
//  Área do cliente — perfil, localização e resumo do histórico
//  de solicitações.
// ============================================================

const db = require('../db');
const auth = require('../auth');
const geo = require('../geo');

const rotas = require('../router')();

function meuCliente(req, res, proximo) {
  const cliente = db.buscar('clientes', (c) => c.usuarioId === req.usuario.id);
  if (!cliente) {
    return res.status(404).json({ erro: 'Perfil de cliente não encontrado.' });
  }
  req.cliente = cliente;
  proximo();
}

// GET /api/clientes/eu — perfil + histórico resumido
rotas.get('/eu', auth.exigirSessao('cliente'), meuCliente, (req, res) => {
  const solicitacoes = db.filtrar('solicitacoes', (s) => s.clienteUsuarioId === req.usuario.id);
  const avaliacoes = db.filtrar('avaliacoes', (a) => a.clienteUsuarioId === req.usuario.id);

  const porStatus = solicitacoes.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});

  res.json({
    id: req.cliente.id,
    nome: req.usuario.nome,
    email: req.usuario.email,
    telefone: req.usuario.telefone,
    localizacao: req.cliente.localizacao,
    membroDesde: req.cliente.criadoEm,
    historico: {
      total: solicitacoes.length,
      porStatus,
      concluidas: porStatus.concluida || 0,
      avaliacoesFeitas: avaliacoes.length,
      // Serviços concluídos ainda sem nota — o app lembra o cliente.
      aguardandoAvaliacao: solicitacoes.filter(
        (s) => s.status === 'concluida' && !avaliacoes.some((a) => a.solicitacaoId === s.id)
      ).length,
    },
  });
});

// PUT /api/clientes/eu/localizacao — trocar a localização
rotas.put('/eu/localizacao', auth.exigirSessao('cliente'), meuCliente, async (req, res) => {
  const { cidade, lat, lng } = req.body || {};
  const ponto = geo.resolverPonto({ cidade, lat, lng });

  if (!ponto) {
    return res.status(400).json({ erro: 'Não reconhecemos essa localização.' });
  }

  const atualizado = await db.atualizar('clientes', req.cliente.id, {
    localizacao: { rotulo: ponto.rotulo, lat: ponto.lat, lng: ponto.lng, origem: ponto.origem },
  });

  res.json({ mensagem: 'Localização atualizada.', localizacao: atualizado.localizacao });
});

module.exports = rotas;
