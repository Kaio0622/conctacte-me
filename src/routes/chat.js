// ============================================================
//  Chat interno — troca de mensagens entre cliente e prestador
//  dentro de uma solicitação, antes (e depois) de fechar o
//  serviço.
// ------------------------------------------------------------
//  Entrega por long polling: o GET fica até 25s esperando
//  mensagem nova em vez de devolver vazio na hora. Dá a
//  sensação de tempo real sem trazer WebSocket para o projeto.
// ============================================================

const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const path = require('node:path');
const { receberImagem, salvarImagem, pasta } = require('../chat-upload');
const { carregarSolicitacao, projetar } = require('./solicitacoes');

const rotas = require('../router')();

const ESPERA_MAXIMA_MS = 25000;
const INTERVALO_CHECAGEM_MS = 700;
const TAMANHO_MAXIMO_MENSAGEM = 2000;

// Assinantes aguardando mensagem nova, por solicitação.
const ouvintes = new Map(); // solicitacaoId -> Set<function>

function avisarOuvintes(solicitacaoId) {
  const conjunto = ouvintes.get(solicitacaoId);
  if (!conjunto) return;
  for (const avisar of conjunto) avisar();
  conjunto.clear();
  ouvintes.delete(solicitacaoId);
}

function mensagensDepoisDe(solicitacaoId, desde) {
  const todas = db.filtrar('mensagens', (m) => m.solicitacaoId === solicitacaoId);
  if (!desde || desde === 'inicio') return todas;
  const indice = todas.findIndex(m => m.id === desde);
  if (indice >= 0) return todas.slice(indice + 1);
  const corte = new Date(desde).getTime();
  if (Number.isNaN(corte)) return todas;
  return todas.filter((m) => new Date(m.criadoEm).getTime() > corte);
}

function projetarMensagem(mensagem, usuarioId) {
  return {
    id: mensagem.id,
    ordem: db.ler('mensagens').indexOf(mensagem),
    texto: mensagem.texto,
    imagem: mensagem.imagem ? { url: `/api/chat/${mensagem.solicitacaoId}/mensagens/${mensagem.id}/imagem` } : null,
    autorNome: mensagem.autorNome,
    autorPapel: mensagem.autorPapel,
    souEuAutor: mensagem.autorId === usuarioId,
    lida: Boolean(mensagem.lidaEm),
    criadoEm: mensagem.criadoEm,
  };
}

// ============================================================
//  GET /api/chat/:id/mensagens?desde=<iso>&aguardar=1
// ============================================================
rotas.get('/:id/mensagens', auth.exigirSessao(), carregarSolicitacao, async (req, res) => {
  const { id } = req.params;
  const { desde, aguardar, status } = req.query;
  res.setHeader('Cache-Control', 'no-store');
  const mudouStatus = () => status && req.solicitacao.status !== status;

  const marcarLidas = async () => {
    if (!req.souCliente && !req.souPrestador) return;
    const pendentes = db.filtrar(
      'mensagens',
      (m) => m.solicitacaoId === id && m.autorId !== req.usuario.id && !m.lidaEm
    );
    if (!pendentes.length) return;
    const agora = new Date().toISOString();
    for (const m of pendentes) m.lidaEm = agora;
    await db.persistir('mensagens');
  };

  let novas = mensagensDepoisDe(id, desde);

  // Long polling: sem novidade e o cliente pediu para aguardar.
  if (!novas.length && aguardar === '1' && !mudouStatus()) {
    novas = await new Promise((resolver) => {
      let finalizado = false;

      const concluir = () => {
        if (finalizado) return;
        finalizado = true;
        clearTimeout(relogio);
        clearInterval(batida);
        conjunto.delete(concluir);
        if (!conjunto.size) ouvintes.delete(id);
        res.off('close', concluir);
        resolver(mensagensDepoisDe(id, desde));
      };

      if (!ouvintes.has(id)) ouvintes.set(id, new Set());
      const conjunto = ouvintes.get(id);
      conjunto.add(concluir);

      // Rede de segurança caso um POST perca o aviso.
      const batida = setInterval(() => {
        if (mensagensDepoisDe(id, desde).length || mudouStatus()) concluir();
      }, INTERVALO_CHECAGEM_MS);

      const relogio = setTimeout(concluir, ESPERA_MAXIMA_MS);
      res.on('close', concluir);
    });
  }

  if (res.destroyed) return;
  await marcarLidas();

  res.json({
    solicitacaoId: id,
    statusSolicitacao: req.solicitacao.status,
    solicitacao: projetar(req.solicitacao, req.usuario),
    cursor: novas.length ? novas[novas.length - 1].id : desde || 'inicio',
    // Cursor para o próximo polling.
    ate: novas.length ? novas[novas.length - 1].criadoEm : desde || null,
    mensagens: novas.map((m) => projetarMensagem(m, req.usuario.id)),
  });
});

// ============================================================
//  POST /api/chat/:id/mensagens
// ============================================================
function podeEnviar(req, res, next) {
  if (!req.souCliente && !req.souPrestador) return res.status(403).json({ erro: 'Somente os participantes podem enviar mensagens.' });
  if (['cancelada', 'recusada'].includes(req.solicitacao.status)) return res.status(409).json({ erro: 'Esta conversa foi encerrada.' });
  next();
}

rotas.get('/:id/mensagens/:mensagemId/imagem', auth.exigirSessao(), carregarSolicitacao, (req, res) => {
  const mensagem = db.porId('mensagens', req.params.mensagemId);
  if (!mensagem?.imagem || mensagem.solicitacaoId !== req.params.id) return res.status(404).json({ erro: 'Foto não encontrada.' });
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Type': mensagem.imagem.tipo });
  res.sendFile(path.basename(mensagem.imagem.arquivo), { root: pasta() }, erro => {
    if (erro && !res.headersSent) res.status(404).json({ erro: 'Foto indisponível.' });
  });
});

rotas.post('/:id/mensagens', auth.exigirSessao(), carregarSolicitacao, podeEnviar, receberImagem, podeEnviar, async (req, res) => {
  const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : '';

  if (!texto && !req.file) {
    return res.status(400).json({ erro: 'Escreva uma mensagem ou escolha uma foto antes de enviar.' });
  }
  if (texto.length > TAMANHO_MAXIMO_MENSAGEM) {
    return res.status(400).json({ erro: `A mensagem passa de ${TAMANHO_MAXIMO_MENSAGEM} caracteres.` });
  }
  if (['cancelada', 'recusada'].includes(req.solicitacao.status)) {
    return res.status(409).json({ erro: 'Esta conversa foi encerrada.' });
  }

  const imagem = await salvarImagem(req.file);
  if (['cancelada', 'recusada'].includes(req.solicitacao.status)) {
    if (imagem) await require('node:fs/promises').unlink(path.join(pasta(), imagem.arquivo));
    return res.status(409).json({ erro: 'Esta conversa foi encerrada.' });
  }
  const mensagem = {
    id: crypto.randomUUID(),
    solicitacaoId: req.params.id,
    autorId: req.usuario.id,
    autorNome: req.usuario.nome,
    autorPapel: req.souPrestador ? 'prestador' : 'cliente',
    texto,
    ...(imagem ? { imagem } : {}),
    lidaEm: null,
    criadoEm: new Date().toISOString(),
  };

  await db.inserir('mensagens', mensagem);
  await db.atualizar('solicitacoes', req.params.id, {}); // atualiza "atualizadoEm"
  avisarOuvintes(req.params.id);

  res.status(201).json({ mensagem: projetarMensagem(mensagem, req.usuario.id) });
});

// ============================================================
//  GET /api/chat/nao-lidas — total para o badge do menu
// ============================================================
rotas.get('/nao-lidas', auth.exigirSessao(), (req, res) => {
  let minhas;
  if (req.usuario.papel === 'prestador') {
    const prestador = db.buscar('prestadores', (p) => p.usuarioId === req.usuario.id);
    minhas = prestador ? db.filtrar('solicitacoes', (s) => s.prestadorId === prestador.id) : [];
  } else {
    minhas = db.filtrar('solicitacoes', (s) => s.clienteUsuarioId === req.usuario.id);
  }

  const ids = new Set(minhas.map((s) => s.id));
  const total = db.filtrar(
    'mensagens',
    (m) => ids.has(m.solicitacaoId) && m.autorId !== req.usuario.id && !m.lidaEm
  ).length;

  res.json({ total });
});

module.exports = rotas;
