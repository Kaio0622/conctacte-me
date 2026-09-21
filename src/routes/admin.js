// ============================================================
//  Painel administrativo — fila de aprovação manual dos
//  prestadores e histórico das notificações de WhatsApp.
// ============================================================

const db = require('../db');
const auth = require('../auth');
const { config } = require('../config');
const { nomeCategoria, projetarPrestador } = require('../dominio');
const { notificarNovoPrestador, montarLinkWaMe, montarMensagem } = require('../notify');

const rotas = require('../router')();

const somenteAdmin = auth.exigirSessao('admin');

function detalharPrestador(prestador) {
  const usuario = db.porId('usuarios', prestador.usuarioId);
  const notificacao = db
    .filtrar('notificacoes', (n) => n.prestadorId === prestador.id)
    .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm))[0];

  return {
    ...projetarPrestador(prestador, { incluirContato: true }),
    categoriaNome: nomeCategoria(prestador.categoria),
    motivoRejeicao: prestador.motivoRejeicao,
    aprovadoEm: prestador.aprovadoEm,
    contato: usuario && {
      nome: usuario.nome,
      email: usuario.email,
      telefone: usuario.telefone,
      whatsapp: usuario.telefone ? `https://wa.me/${usuario.telefone}` : null,
    },
    notificacao: notificacao && {
      status: notificacao.status,
      provider: notificacao.provider,
      detalhe: notificacao.detalhe,
      linkWaMe: notificacao.linkWaMe,
      criadoEm: notificacao.criadoEm,
    },
  };
}

// ============================================================
//  GET /api/admin/prestadores?status=pendente
// ============================================================
rotas.get('/prestadores', somenteAdmin, (req, res) => {
  const { status } = req.query;
  let lista = db.filtrar('prestadores', () => true);
  if (status) lista = lista.filter((p) => p.status === status);

  lista.sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

  const todos = db.ler('prestadores');
  res.json({
    resumo: {
      pendente: todos.filter((p) => p.status === 'pendente').length,
      aprovado: todos.filter((p) => p.status === 'aprovado').length,
      rejeitado: todos.filter((p) => p.status === 'rejeitado').length,
      suspenso: todos.filter((p) => p.status === 'suspenso').length,
    },
    whatsapp: {
      provider: config.whatsapp.provider,
      destino: config.whatsapp.destino || null,
      configurado: config.whatsapp.configurado,
    },
    prestadores: lista.map(detalharPrestador),
  });
});

// ============================================================
//  POST /api/admin/prestadores/:id/decisao
//  body: { decisao: 'aprovado' | 'rejeitado' | 'suspenso', motivo? }
//  É AQUI que o selo de perfil verificado é concedido.
// ============================================================
rotas.post('/prestadores/:id/decisao', somenteAdmin, async (req, res) => {
  const { decisao, motivo } = req.body || {};

  if (!['aprovado', 'rejeitado', 'suspenso'].includes(decisao)) {
    return res.status(400).json({ erro: 'Decisão inválida.' });
  }

  const prestador = db.porId('prestadores', req.params.id);
  if (!prestador) {
    return res.status(404).json({ erro: 'Prestador não encontrado.' });
  }
  if (decisao === 'rejeitado' && !String(motivo || '').trim()) {
    return res.status(400).json({ erro: 'Explique o motivo da rejeição — o prestador vai ver.' });
  }

  const atualizado = await db.atualizar('prestadores', prestador.id, {
    status: decisao,
    motivoRejeicao: decisao === 'aprovado' ? null : String(motivo || '').trim() || null,
    aprovadoEm: decisao === 'aprovado' ? new Date().toISOString() : null,
    aprovadoPor: req.usuario.nome,
  });

  res.json({
    mensagem:
      decisao === 'aprovado'
        ? 'Prestador aprovado. O perfil já aparece nas buscas com o selo de verificado.'
        : `Prestador marcado como ${decisao}.`,
    prestador: detalharPrestador(atualizado),
  });
});

// ============================================================
//  GET /api/admin/aprovacao-rapida?token=...
//  Aberto direto do link que chegou no WhatsApp — por isso
//  responde HTML, não JSON, e valida pelo token assinado
//  (não exige estar logado no painel).
// ============================================================
rotas.get('/aprovacao-rapida', async (req, res) => {
  const payload = auth.verificar(req.query.token);

  const pagina = (titulo, corpo, cor = '#0f172a') => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo} · Contact Me</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;
       font-family:system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px;color:#0f172a}
  .cartao{background:#fff;max-width:420px;width:100%;padding:32px;border-radius:20px;
          border:1px solid #e2e8f0;box-shadow:0 12px 32px rgba(15,23,42,.08);text-align:center}
  h1{font-size:20px;margin:0 0 12px;color:${cor}}
  p{margin:0 0 8px;color:#475569;line-height:1.6;font-size:15px}
  a{display:inline-block;margin-top:20px;padding:12px 22px;border-radius:12px;
    background:#0f172a;color:#fff;text-decoration:none;font-weight:600;font-size:14px}
  @media (prefers-color-scheme:dark){
    body{background:#0b1120;color:#e2e8f0}
    .cartao{background:#111827;border-color:#1f2937}
    p{color:#94a3b8} a{background:#e2e8f0;color:#0f172a}
  }
</style></head><body><div class="cartao">${corpo}<a href="${config.urlPublica}/admin.html">Abrir o painel</a></div></body></html>`;

  if (!payload || !['aprovar', 'rejeitar'].includes(payload.acao)) {
    return res
      .status(400)
      .send(pagina('Link inválido', '<h1>Link inválido ou expirado</h1><p>Entre no painel para decidir manualmente.</p>', '#b91c1c'));
  }

  const prestador = db.porId('prestadores', payload.alvo);
  if (!prestador) {
    return res
      .status(404)
      .send(pagina('Não encontrado', '<h1>Prestador não encontrado</h1><p>O cadastro pode ter sido removido.</p>', '#b91c1c'));
  }

  const usuario = db.porId('usuarios', prestador.usuarioId);
  const nome = String(usuario?.nome || 'Prestador').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  if (prestador.status !== 'pendente') {
    return res.send(
      pagina(
        'Já decidido',
        `<h1>Nada a fazer</h1><p><strong>${nome}</strong> já está com status <strong>${prestador.status}</strong>.</p>`,
        '#b45309'
      )
    );
  }

  const aprovando = payload.acao === 'aprovar';
  await db.atualizar('prestadores', prestador.id, {
    status: aprovando ? 'aprovado' : 'rejeitado',
    motivoRejeicao: aprovando ? null : 'Rejeitado na verificação inicial.',
    aprovadoEm: aprovando ? new Date().toISOString() : null,
    aprovadoPor: 'Aprovação rápida (WhatsApp)',
  });

  res.send(
    pagina(
      aprovando ? 'Aprovado' : 'Rejeitado',
      aprovando
        ? `<h1>${nome} foi aprovado</h1><p>O perfil já aparece nas buscas com o selo de perfil verificado.</p>`
        : `<h1>Cadastro de ${nome} rejeitado</h1><p>O perfil continua fora das buscas.</p>`,
      aprovando ? '#15803d' : '#b91c1c'
    )
  );
});

// ============================================================
//  GET /api/admin/notificacoes — histórico dos disparos
// ============================================================
rotas.get('/notificacoes', somenteAdmin, (_req, res) => {
  const lista = db
    .filtrar('notificacoes', () => true)
    .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm))
    .slice(0, 100);

  res.json({
    whatsapp: {
      provider: config.whatsapp.provider,
      destino: config.whatsapp.destino || null,
      configurado: config.whatsapp.configurado,
    },
    notificacoes: lista,
  });
});

// ============================================================
//  POST /api/admin/prestadores/:id/reenviar-notificacao
//  Útil quando o Twilio falhou (crédito, sandbox, rede).
// ============================================================
rotas.post('/prestadores/:id/reenviar-notificacao', somenteAdmin, async (req, res) => {
  const prestador = db.porId('prestadores', req.params.id);
  if (!prestador) {
    return res.status(404).json({ erro: 'Prestador não encontrado.' });
  }
  const usuario = db.porId('usuarios', prestador.usuarioId);
  const notificacao = await notificarNovoPrestador(prestador, usuario);
  res.json({ mensagem: 'Notificação reenviada.', notificacao });
});

// ============================================================
//  GET /api/admin/prestadores/:id/link-whatsapp
//  Plano B: devolve o link wa.me pronto para o admin clicar.
// ============================================================
rotas.get('/prestadores/:id/link-whatsapp', somenteAdmin, (req, res) => {
  const prestador = db.porId('prestadores', req.params.id);
  if (!prestador) {
    return res.status(404).json({ erro: 'Prestador não encontrado.' });
  }
  const usuario = db.porId('usuarios', prestador.usuarioId);
  const { texto } = montarMensagem(prestador, usuario);
  res.json({
    destino: config.whatsapp.destino || null,
    link: montarLinkWaMe(config.whatsapp.destino, texto),
    texto,
  });
});

module.exports = rotas;
