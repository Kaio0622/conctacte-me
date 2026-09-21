// ============================================================
//  Autenticação — hash de senha (scrypt) e token de sessão
//  assinado (HMAC). Sem dependência externa: tudo com o
//  módulo "crypto" nativo do Node.
// ============================================================

const crypto = require('crypto');
const { config } = require('./config');
const db = require('./db');

const DURACAO_SESSAO_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

// ── Senhas ──────────────────────────────────────────────────

function gerarHashSenha(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const derivada = crypto.scryptSync(senha, sal, 64).toString('hex');
  return `${sal}:${derivada}`;
}

function conferirSenha(senha, hashGuardado) {
  if (!hashGuardado || !hashGuardado.includes(':')) return false;
  const [sal, esperado] = hashGuardado.split(':');
  const derivada = crypto.scryptSync(senha, sal, 64);
  const alvo = Buffer.from(esperado, 'hex');
  if (alvo.length !== derivada.length) return false;
  return crypto.timingSafeEqual(derivada, alvo);
}

// ── Tokens assinados ────────────────────────────────────────
// Formato: base64url(payloadJSON).base64url(HMAC-SHA256)
// Serve tanto para sessão quanto para os links de aprovação
// que vão dentro da mensagem de WhatsApp.

const b64 = (buf) => Buffer.from(buf).toString('base64url');

function assinar(payload) {
  const corpo = b64(JSON.stringify(payload));
  const assinatura = crypto
    .createHmac('sha256', config.segredo)
    .update(corpo)
    .digest('base64url');
  return `${corpo}.${assinatura}`;
}

function verificar(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [corpo, assinatura] = token.split('.');
  if (!corpo || !assinatura) return null;

  const esperada = crypto
    .createHmac('sha256', config.segredo)
    .update(corpo)
    .digest('base64url');

  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf-8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function criarTokenSessao(usuario) {
  return assinar({
    sub: usuario.id,
    papel: usuario.papel,
    exp: Date.now() + DURACAO_SESSAO_MS,
  });
}

// Token de uso específico (ex: aprovar prestador X pelo link do WhatsApp).
function criarTokenAcao(acao, alvoId, validadeMs = 30 * 24 * 60 * 60 * 1000) {
  return assinar({ acao, alvo: alvoId, exp: Date.now() + validadeMs });
}

// ── Middlewares ─────────────────────────────────────────────

function extrairToken(req) {
  const cabecalho = req.get('authorization') || '';
  if (cabecalho.startsWith('Bearer ')) return cabecalho.slice(7).trim();
  return req.query.token || null;
}

// Preenche req.usuario quando houver sessão válida (não bloqueia).
function sessaoOpcional(req, _res, proximo) {
  const payload = verificar(extrairToken(req));
  if (payload?.sub) {
    if (payload.papel === 'admin' && payload.sub === 'admin') {
      req.usuario = { id: 'admin', papel: 'admin', nome: 'Administrador' };
    } else {
      const usuario = db.porId('usuarios', payload.sub);
      if (usuario) req.usuario = usuario;
    }
  }
  proximo();
}

// Exige sessão. Se `papeis` for informado, exige também o papel.
function exigirSessao(...papeis) {
  return (req, res, proximo) => {
    if (!req.usuario) {
      return res.status(401).json({ erro: 'Você precisa entrar na sua conta.' });
    }
    if (papeis.length && !papeis.includes(req.usuario.papel)) {
      return res.status(403).json({ erro: 'Sua conta não tem permissão para esta ação.' });
    }
    proximo();
  };
}

module.exports = {
  gerarHashSenha,
  conferirSenha,
  assinar,
  verificar,
  criarTokenSessao,
  criarTokenAcao,
  sessaoOpcional,
  exigirSessao,
};
