// ============================================================
//  Rotas de conta — cadastro de cliente, cadastro de prestador
//  (que dispara a aprovação por WhatsApp) e login.
// ============================================================

const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const geo = require('../geo');
const { config, normalizarTelefone } = require('../config');
const { MAPA_CATEGORIAS } = require('../dominio');
const { receberFotos, urlPublicaDaFoto } = require('../upload');
const { notificarNovoPrestador } = require('../notify');
const { google } = require('../google-auth');

const rotas = require('../router')();

// ── Validações comuns ───────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validarConta({ nome, email, senha, telefone }, viaGoogle = false) {
  const erros = [];
  if (typeof nome !== 'string' || nome.trim().length < 3) erros.push('Informe seu nome completo.');
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) erros.push('Informe um e-mail válido.');
  if (!viaGoogle && (typeof senha !== 'string' || senha.length < 6)) erros.push('A senha precisa ter pelo menos 6 caracteres.');
  if (telefone !== undefined && normalizarTelefone(telefone).length < 12) {
    erros.push('Informe um telefone válido com DDD.');
  }
  return erros;
}

function emailEmUso(email) {
  const alvo = String(email).trim().toLowerCase();
  return Boolean(db.buscar('usuarios', (u) => u.email === alvo));
}

async function criarUsuario({ nome, email, senha, telefone, papel, googleId }) {
  if (googleId && db.buscar('usuarios', u => u.supabaseUsuarioId === googleId)) {
    const erro = new Error('Esta conta Google já está cadastrada. Entre novamente.'); erro.status = 409; throw erro;
  }
  const usuario = {
    id: crypto.randomUUID(),
    nome: nome.trim(),
    email: String(email).trim().toLowerCase(),
    telefone: normalizarTelefone(telefone),
    senhaHash: googleId ? null : auth.gerarHashSenha(senha),
    ...(googleId ? { supabaseUsuarioId: googleId } : {}),
    papel, // 'cliente' | 'prestador'
    criadoEm: new Date().toISOString(),
  };
  await db.inserir('usuarios', usuario);
  return usuario;
}

function respostaSessao(usuario, extras = {}) {
  return {
    token: auth.criarTokenSessao(usuario),
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      telefone: usuario.telefone,
      papel: usuario.papel,
    },
    ...extras,
  };
}

// Cookies temporários guardam a prova do Google; nunca aceitamos identidade do navegador.
rotas.use('/google', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});
rotas.get('/google/status', async (_req, res) => {
  try { res.json(await google.status()); }
  catch { res.status(503).json({ erro: 'Login com Google indisponível no momento.' }); }
});
rotas.get('/google/iniciar', async (req, res) => {
  try { await google.iniciar(req, res); }
  catch (erro) { google.falhar(req, res, erro.message); }
});
rotas.get('/google/callback', (req, res) => google.callback(req, res));

function provaGoogle(req, res) {
  const prova = google.resultado(req);
  if (!prova?.identidade) {
    google.concluir(req, res);
    res.status(400).json({ erro: prova?.erro || 'Seu login expirou. Entre com Google novamente.' });
    return null;
  }
  if (prova.identidade.email === config.admin.email) {
    google.concluir(req, res);
    res.status(403).json({ erro: 'Use o acesso administrativo com e-mail e senha.' });
    return null;
  }
  return prova;
}

rotas.get('/google/resultado', (req, res) => {
  const prova = provaGoogle(req, res);
  if (!prova) return;
  const { identidade } = prova;
  const usuario = db.buscar('usuarios', u => u.supabaseUsuarioId === identidade.id);
  if (usuario) {
    google.concluir(req, res);
    if (usuario.papel === 'admin') return res.status(403).json({ erro: 'Use o acesso administrativo com e-mail e senha.' });
    return res.json(respostaSessao(usuario));
  }
  const existente = db.buscar('usuarios', u => u.email === identidade.email);
  if (existente) return res.json({ vincular: true, email: identidade.email });
  res.json({ cadastroGoogle: { nome: identidade.nome, email: identidade.email } });
});

rotas.post('/google/vincular', async (req, res) => {
  const prova = provaGoogle(req, res);
  if (!prova) return;
  if (++prova.tentativas > 5) {
    google.concluir(req, res);
    return res.status(429).json({ erro: 'Muitas tentativas. Entre com Google novamente.' });
  }
  const usuario = db.buscar('usuarios', u => u.email === prova.identidade.email);
  const outro = db.buscar('usuarios', u => u.supabaseUsuarioId === prova.identidade.id && u.id !== usuario?.id);
  if (!usuario || usuario.papel === 'admin' || outro ||
      (usuario.supabaseUsuarioId && usuario.supabaseUsuarioId !== prova.identidade.id) ||
      typeof req.body?.senha !== 'string' || req.body.senha.length > 1024 ||
      !auth.conferirSenha(req.body.senha, usuario.senhaHash)) {
    return res.status(400).json({ erro: 'Não foi possível vincular. Confira a senha da sua conta Contact Me.' });
  }
  google.concluir(req, res);
  await db.atualizar('usuarios', usuario.id, { supabaseUsuarioId: prova.identidade.id });
  res.json(respostaSessao(usuario));
});

// ============================================================
//  POST /api/auth/cadastro/cliente
// ============================================================
rotas.post('/cadastro/cliente', async (req, res) => {
  const identidade = google.identidadeCadastro(req);
  const { nome, senha, telefone, cidade, lat, lng } = req.body || {};
  const email = identidade?.email || req.body?.email;

  const erros = validarConta({ nome, email, senha, telefone }, Boolean(identidade));
  if (!cidade || !String(cidade).trim()) erros.push('Informe sua localização.');
  if (erros.length) return res.status(400).json({ erro: erros[0], erros });

  if (emailEmUso(email)) {
    return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
  }

  const ponto = geo.resolverPonto({ cidade, lat, lng });
  if (!ponto) {
    return res.status(400).json({
      erro: 'Não reconhecemos essa cidade. Escolha uma da lista de sugestões ou use "Usar minha localização".',
    });
  }

  const usuario = await criarUsuario({ nome, email, senha, telefone, papel: 'cliente', googleId: identidade?.id });

  const cliente = {
    id: crypto.randomUUID(),
    usuarioId: usuario.id,
    localizacao: { rotulo: ponto.rotulo, lat: ponto.lat, lng: ponto.lng, origem: ponto.origem },
    criadoEm: new Date().toISOString(),
  };
  await db.inserir('clientes', cliente);
  if (identidade) google.concluir(req, res);

  res.status(201).json(
    respostaSessao(usuario, {
      mensagem: 'Conta criada! Já pode buscar profissionais na sua região.',
      cliente,
    })
  );
});

// ============================================================
//  POST /api/auth/cadastro/prestador   (multipart/form-data)
//  Cria a conta com status "pendente" e dispara o WhatsApp
//  para aprovação manual. O perfil NÃO aparece na busca até
//  ser aprovado.
// ============================================================
rotas.post('/cadastro/prestador', receberFotos('fotos'), async (req, res) => {
  const identidade = google.identidadeCadastro(req);
  const {
    nome, senha, telefone,
    categoria, cidade, lat, lng, raioKm,
    descricao, precoMedio, unidadePreco,
  } = req.body || {};
  const email = identidade?.email || req.body?.email;

  const erros = validarConta({ nome, email, senha, telefone }, Boolean(identidade));
  if (!categoria || !MAPA_CATEGORIAS.has(categoria)) erros.push('Escolha uma categoria de serviço.');
  if (!cidade || !String(cidade).trim()) erros.push('Informe sua área de atendimento.');
  if (typeof descricao !== 'string' || descricao.trim().length < 30) {
    erros.push('Escreva uma descrição com pelo menos 30 caracteres — é o que gera confiança.');
  }
  const preco = Number(String(precoMedio).replace(',', '.'));
  if (!Number.isFinite(preco) || preco <= 0) erros.push('Informe um preço médio válido.');

  if (erros.length) return res.status(400).json({ erro: erros[0], erros });

  if (emailEmUso(email)) {
    return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
  }

  const ponto = geo.resolverPonto({ cidade, lat, lng });
  if (!ponto) {
    return res.status(400).json({
      erro: 'Não reconhecemos essa cidade. Escolha uma das sugestões.',
    });
  }

  const raio = Math.min(200, Math.max(1, Number(raioKm) || 20));
  const usuario = await criarUsuario({ nome, email, senha, telefone, papel: 'prestador', googleId: identidade?.id });

  const prestador = {
    id: crypto.randomUUID(),
    usuarioId: usuario.id,
    categoria,
    descricao: descricao.trim(),
    precoMedio: Number(preco.toFixed(2)),
    unidadePreco: ['hora', 'diaria', 'servico', 'm2'].includes(unidadePreco) ? unidadePreco : 'servico',
    areaAtendimento: {
      rotulo: ponto.rotulo,
      lat: ponto.lat,
      lng: ponto.lng,
      raioKm: raio,
    },
    fotos: (req.files || []).map(urlPublicaDaFoto),
    // ── Estado da moderação ──────────────────────────────────
    status: 'pendente',       // vira 'aprovado' só na aprovação manual
    motivoRejeicao: null,
    aprovadoEm: null,
    aprovadoPor: null,
    // ── Reputação ────────────────────────────────────────────
    notaMedia: 0,
    totalAvaliacoes: 0,
    criadoEm: new Date().toISOString(),
  };
  await db.inserir('prestadores', prestador);

  // Dispara a notificação de aprovação. Nunca derruba o cadastro.
  const notificacao = await notificarNovoPrestador(prestador, usuario);
  if (identidade) google.concluir(req, res);

  res.status(201).json(
    respostaSessao(usuario, {
      mensagem:
        'Cadastro enviado! Seu perfil passa por uma verificação manual antes de aparecer nas buscas. ' +
        'Assim que for aprovado você recebe o selo de perfil verificado.',
      prestador: { id: prestador.id, status: prestador.status },
      notificacao: {
        status: notificacao.status,
        provider: notificacao.provider,
        detalhe: notificacao.detalhe,
      },
    })
  );
});

// ============================================================
//  POST /api/auth/login
// ============================================================
rotas.post('/login', async (req, res) => {
  const { email, senha } = req.body || {};
  if (typeof email !== 'string' || typeof senha !== 'string' || !email || !senha) {
    return res.status(400).json({ erro: 'Informe e-mail e senha.' });
  }

  const alvo = String(email).trim().toLowerCase();

  // Login do administrador — não fica na base de usuários.
  if (alvo === config.admin.email && senha === config.admin.senha) {
    const admin = { id: 'admin', papel: 'admin', nome: 'Administrador', email: alvo };
    return res.json({ token: auth.criarTokenSessao(admin), usuario: admin });
  }

  const usuario = db.buscar('usuarios', (u) => u.email === alvo);
  // Mensagem genérica de propósito: não revela se o e-mail existe.
  if (!usuario || !auth.conferirSenha(senha, usuario.senhaHash)) {
    return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
  }

  const extras = {};
  if (usuario.papel === 'prestador') {
    const prestador = db.buscar('prestadores', (p) => p.usuarioId === usuario.id);
    if (prestador) extras.prestador = { id: prestador.id, status: prestador.status };
  }

  res.json(respostaSessao(usuario, extras));
});

// ============================================================
//  GET /api/auth/eu — quem está logado
// ============================================================
rotas.get('/eu', auth.exigirSessao(), (req, res) => {
  const usuario = req.usuario;

  const corpo = {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    telefone: usuario.telefone,
    papel: usuario.papel,
  };

  if (usuario.papel === 'prestador') {
    const prestador = db.buscar('prestadores', (p) => p.usuarioId === usuario.id);
    if (prestador) {
      corpo.prestador = {
        id: prestador.id,
        status: prestador.status,
        verificado: prestador.status === 'aprovado',
        motivoRejeicao: prestador.motivoRejeicao,
        notaMedia: prestador.notaMedia,
        totalAvaliacoes: prestador.totalAvaliacoes,
      };
    }
  }

  if (usuario.papel === 'cliente') {
    const cliente = db.buscar('clientes', (c) => c.usuarioId === usuario.id);
    if (cliente) corpo.cliente = { id: cliente.id, localizacao: cliente.localizacao };
  }

  res.json(corpo);
});

module.exports = rotas;
