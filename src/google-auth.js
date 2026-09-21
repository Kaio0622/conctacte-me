const crypto = require('node:crypto');
const { config } = require('./config');

// Fluxo PKCE no servidor: códigos e tokens Google/Supabase não vão ao localStorage.
function criarGoogleAuth(opcoes = config, transporte = (...args) => fetch(...args)) {
  const transacoes = new Map();
  const provas = new Map();
  const duracao = 10 * 60 * 1000;
  let estadoCache;
  const cookieOpcoes = (path) => ({ httpOnly: true, sameSite: 'lax', secure: opcoes.urlPublica.startsWith('https:'), path, maxAge: duracao });
  const cookie = (req, nome) => (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(nome + '='))?.slice(nome.length + 1);
  function guardar(mapa, valor) {
    for (const [id, item] of mapa) if (item.expira <= Date.now()) mapa.delete(id);
    if (mapa.size >= 1000) throw new Error('Muitas tentativas. Aguarde alguns minutos.');
    const id = crypto.randomBytes(32).toString('base64url');
    mapa.set(id, { ...valor, expira: Date.now() + duracao });
    return id;
  }
  function ler(mapa, id) {
    const item = mapa.get(id);
    if (!item || item.expira <= Date.now()) { mapa.delete(id); return null; }
    return item;
  }
  async function requisitar(caminho, init = {}) {
    if (!opcoes.supabase.url || !opcoes.supabase.publicavel) throw new Error('Login com Google ainda não está disponível. Use e-mail e senha.');
    let resposta;
    try {
      resposta = await transporte(`${opcoes.supabase.url}/auth/v1${caminho}`, {
        ...init, signal: AbortSignal.timeout(15000),
        headers: { apikey: opcoes.supabase.publicavel, 'Content-Type': 'application/json', ...init.headers },
      });
    } catch { throw new Error('Não foi possível conectar ao Google. Tente novamente.'); }
    if (!resposta.ok) throw new Error('Não foi possível confirmar o login com Google. Tente novamente.');
    return resposta.json();
  }
  async function status() {
    if (!opcoes.supabase.url || !opcoes.supabase.publicavel) return { disponivel: false };
    if (estadoCache?.expira > Date.now()) return estadoCache.valor;
    const dados = await requisitar('/settings');
    const valor = { disponivel: dados.external?.google === true };
    estadoCache = { valor, expira: Date.now() + 30000 };
    return valor;
  }
  async function iniciar(req, res) {
    if (!(await status()).disponivel) throw new Error('Login com Google ainda não está disponível. Use e-mail e senha.');
    const origem = new URL(opcoes.urlPublica);
    // A prova PKCE e o retorno devem usar o mesmo host de cookie.
    if (req.get('host') !== origem.host) return res.redirect(`${opcoes.urlPublica}/api/auth/google/iniciar`);
    const verifier = crypto.randomBytes(48).toString('base64url');
    const transacao = guardar(transacoes, { verifier });
    res.cookie('cm_google_tx', transacao, cookieOpcoes('/api/auth/google'));
    const destino = new URL(`${opcoes.supabase.url}/auth/v1/authorize`);
    destino.search = new URLSearchParams({ provider: 'google',
      redirect_to: `${opcoes.urlPublica}/api/auth/google/callback`,
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 's256', scopes: 'openid email profile', prompt: 'select_account' }).toString();
    res.redirect(destino.href);
  }
  function concluir(req, res) {
    provas.delete(cookie(req, 'cm_google_prova'));
    const { maxAge, ...opcoesLimpar } = cookieOpcoes('/api/auth');
    res.clearCookie('cm_google_prova', opcoesLimpar);
  }
  function salvarResultado(req, res, valor) {
    concluir(req, res);
    res.cookie('cm_google_prova', guardar(provas, valor), cookieOpcoes('/api/auth'));
  }
  async function callback(req, res) {
    const id = cookie(req, 'cm_google_tx');
    const transacao = ler(transacoes, id);
    transacoes.delete(id); // uso único, inclusive quando a troca falhar
    const { maxAge, ...opcoesLimpar } = cookieOpcoes('/api/auth/google');
    res.clearCookie('cm_google_tx', opcoesLimpar);
    try {
      if (!transacao) throw new Error('Seu login expirou. Clique em Entrar com Google novamente.');
      if (req.query.error) throw new Error('Login com Google cancelado ou recusado. Você pode tentar novamente.');
      if (typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 4096) throw new Error('Retorno de login inválido. Tente novamente.');
      const sessao = await requisitar('/token?grant_type=pkce', { method: 'POST',
        body: JSON.stringify({ auth_code: req.query.code, code_verifier: transacao.verifier }) });
      if (!sessao.access_token) throw new Error('Não foi possível confirmar sua conta Google.');
      const usuario = await requisitar('/user', { headers: { Authorization: `Bearer ${sessao.access_token}` } });
      const identidade = usuario.identities?.find(i => i.provider === 'google');
      if (!usuario.id || !usuario.email_confirmed_at || !identidade ||
          typeof usuario.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(usuario.email)) {
        throw new Error('Use uma conta Google com e-mail confirmado.');
      }
      salvarResultado(req, res, { identidade: { id: usuario.id, email: usuario.email.toLowerCase().trim(),
        nome: String(usuario.user_metadata?.full_name || usuario.user_metadata?.name || '').slice(0,150) }, tentativas: 0 });
    } catch (erro) {
      salvarResultado(req, res, { erro: erro.message });
    }
    res.redirect(`${opcoes.urlPublica}/#/google`);
  }
  const resultado = req => ler(provas, cookie(req, 'cm_google_prova'));
  function identidadeCadastro(req) {
    if (!req.body?.googleCadastro) return null;
    const identidade = resultado(req)?.identidade;
    if (!identidade) { const erro = new Error('Seu login Google expirou. Entre com Google novamente.'); erro.status = 400; throw erro; }
    if (identidade.email === opcoes.admin.email) { const erro = new Error('Use o acesso administrativo com e-mail e senha.'); erro.status = 403; throw erro; }
    return identidade;
  }
  function falhar(req, res, mensagem) {
    salvarResultado(req, res, { erro: mensagem });
    res.redirect(`${opcoes.urlPublica}/#/google`);
  }
  return { status, iniciar, callback, resultado, concluir, identidadeCadastro, falhar };
}

module.exports = { criarGoogleAuth, google: criarGoogleAuth() };
