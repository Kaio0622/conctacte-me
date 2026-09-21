// ============================================================
//  Montagem do app Express — middlewares, rotas e tratamento
//  de erro. O bootstrap (listen) fica em server.js.
// ============================================================

const path = require('path');
const express = require('express');
const { config } = require('./config');
const auth = require('./auth');
const db = require('./db');

const rotasAuth = require('./routes/auth');
const rotasBusca = require('./routes/busca');
const rotasPrestadores = require('./routes/prestadores');
const rotasClientes = require('./routes/clientes');
const { rotas: rotasSolicitacoes } = require('./routes/solicitacoes');
const rotasChat = require('./routes/chat');
const rotasAvaliacoes = require('./routes/avaliacoes');
const rotasAdmin = require('./routes/admin');

function criarApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Toda rota tem acesso a req.usuario quando houver token válido.
  app.use('/api', (req, res, next) => {
    if (!db.saudavel() && req.path !== '/saude') return res.status(503).json({ erro: 'Banco indisponível. Reinicie o servidor para recarregar os dados.' });
    next();
  });
  app.use(auth.sessaoOpcional);

  // Fotos do portfólio. immutable: o nome do arquivo já é único.
  // Os cabeçalhos impedem que um arquivo enviado por um prestador
  // seja interpretado como HTML/script pelo navegador.
  app.use(
    '/uploads',
    express.static(config.caminhos.uploads, {
      maxAge: '30d',
      immutable: true,
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      },
    })
  );

  // Frontend.
  app.use(express.static(config.caminhos.publico, { extensions: ['html'] }));

  // ── API ───────────────────────────────────────────────────
  app.use('/api/auth', rotasAuth);
  app.use('/api/clientes', rotasClientes);
  // rotasPrestadores trata /eu/*; rotasBusca trata /prestadores/:id.
  // A ordem importa: "eu" não pode ser capturado como ":id".
  app.use('/api/prestadores', rotasPrestadores);
  app.use('/api', rotasBusca);
  app.use('/api/solicitacoes', rotasSolicitacoes);
  app.use('/api/chat', rotasChat);
  app.use('/api/avaliacoes', rotasAvaliacoes);
  app.use('/api/admin', rotasAdmin);

  app.get('/api/saude', (_req, res) => {
    res.status(db.saudavel() ? 200 : 503).json({
      ok: db.saudavel(),
      banco: config.banco,
      versao: require('../package.json').version,
      whatsapp: {
        provider: config.whatsapp.provider,
        configurado: config.whatsapp.configurado,
      },
    });
  });

  // 404 de API responde JSON (e não o index.html).
  app.use('/api', (_req, res) => {
    res.status(404).json({ erro: 'Rota de API não encontrada.' });
  });

  // Qualquer outra rota devolve o app (navegação client-side).
  app.get('*', (_req, res) => {
    res.sendFile(path.join(config.caminhos.publico, 'index.html'));
  });

  // ── Tratamento de erro ────────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((erro, req, res, _proximo) => {
    console.error('[erro]', req.method, req.path, '—', erro.message);
    if (res.headersSent) return;
    const status = erro.status || 500;
    res.status(status).json({
      erro: status === 500 ? 'Algo deu errado no servidor. Tente de novo.' : erro.message,
    });
  });

  return app;
}

module.exports = { criarApp };
