// ============================================================
//  Camada de acesso à API + sessão do usuário
// ============================================================

const Sessao = {
  CHAVE: 'contactme.sessao',

  ler() {
    try {
      return JSON.parse(localStorage.getItem(this.CHAVE)) || null;
    } catch {
      return null;
    }
  },

  gravar(token, usuario) {
    localStorage.setItem(this.CHAVE, JSON.stringify({ token, usuario }));
  },

  limpar() {
    localStorage.removeItem(this.CHAVE);
  },

  get token() { return this.ler()?.token || null; },
  get usuario() { return this.ler()?.usuario || null; },
  get logado() { return Boolean(this.token); },
  get papel() { return this.usuario?.papel || null; },
};

// Erro com o status HTTP junto, para as telas decidirem o que fazer.
class ErroApi extends Error {
  constructor(mensagem, status, dados) {
    super(mensagem);
    this.status = status;
    this.dados = dados;
  }
}

async function api(caminho, opcoes = {}) {
  const { metodo = 'GET', corpo, form, sinal } = opcoes;

  const cabecalhos = {};
  const token = Sessao.token;
  if (token) cabecalhos.Authorization = `Bearer ${token}`;

  let body;
  if (form) {
    body = form; // o navegador põe o boundary do multipart sozinho
  } else if (corpo !== undefined) {
    cabecalhos['Content-Type'] = 'application/json';
    body = JSON.stringify(corpo);
  }

  let resposta;
  try {
    resposta = await fetch(caminho, { method: metodo, headers: cabecalhos, body, signal: sinal });
  } catch (erro) {
    if (erro.name === 'AbortError') throw erro;
    throw new ErroApi('Sem conexão com o servidor. Verifique sua internet.', 0, null);
  }

  const tipo = resposta.headers.get('content-type') || '';
  const dados = tipo.includes('application/json') ? await resposta.json().catch(() => null) : null;

  if (!resposta.ok) {
    // Token expirado ou inválido: derruba a sessão local.
    if (resposta.status === 401 && token && Sessao.token === token && caminho !== '/api/auth/login') {
      Sessao.limpar();
      window.dispatchEvent(new CustomEvent('sessao-expirada'));
    }
    throw new ErroApi(dados?.erro || `Erro ${resposta.status}`, resposta.status, dados);
  }

  return dados;
}

// Atalhos de leitura com querystring.
function comParametros(caminho, parametros = {}) {
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor !== undefined && valor !== null && valor !== '') busca.set(chave, valor);
  }
  const qs = busca.toString();
  return qs ? `${caminho}?${qs}` : caminho;
}

const API = {
  // ── Catálogo ──
  categorias: () => api('/api/categorias'),
  cidades: (q) => api(comParametros('/api/cidades', { q })),

  // ── Busca ──
  buscar: (filtros, sinal) => api(comParametros('/api/busca', filtros), { sinal }),
  prestador: (id, ponto = {}) => api(comParametros(`/api/prestadores/${id}`, ponto)),

  // ── Conta ──
  googleStatus: () => api('/api/auth/google/status'),
  googleResultado: () => api('/api/auth/google/resultado'),
  googleVincular: (senha) => api('/api/auth/google/vincular', { metodo: 'POST', corpo: { senha } }),
  login: (email, senha) => api('/api/auth/login', { metodo: 'POST', corpo: { email, senha } }),
  cadastrarCliente: (dados) => api('/api/auth/cadastro/cliente', { metodo: 'POST', corpo: dados }),
  cadastrarPrestador: (form) => api('/api/auth/cadastro/prestador', { metodo: 'POST', form }),
  eu: () => api('/api/auth/eu'),
  meuCliente: () => api('/api/clientes/eu'),
  trocarLocalizacao: (dados) => api('/api/clientes/eu/localizacao', { metodo: 'PUT', corpo: dados }),
  meuPerfilPrestador: () => api('/api/prestadores/eu/perfil'),
  editarPerfilPrestador: (dados) => api('/api/prestadores/eu/perfil', { metodo: 'PUT', corpo: dados }),
  enviarFotos: (form) => api('/api/prestadores/eu/fotos', { metodo: 'POST', form }),
  removerFoto: (url) => api('/api/prestadores/eu/fotos', { metodo: 'DELETE', corpo: { url } }),

  // ── Solicitações ──
  solicitar: (prestadorId, descricao) =>
    api('/api/solicitacoes', { metodo: 'POST', corpo: { prestadorId, descricao } }),
  solicitacoes: (status) => api(comParametros('/api/solicitacoes', { status })),
  solicitacao: (id) => api(`/api/solicitacoes/${id}`),
  mudarStatus: (id, status) =>
    api(`/api/solicitacoes/${id}/status`, { metodo: 'PATCH', corpo: { status } }),

  // ── Chat ──
  mensagens: (id, desde, aguardar, sinal, status) =>
    api(comParametros(`/api/chat/${id}/mensagens`, { desde, status, aguardar: aguardar ? 1 : undefined }), { sinal }),
  enviarMensagem: (id, texto, imagem) => {
    if (!imagem) return api(`/api/chat/${id}/mensagens`, { metodo: 'POST', corpo: { texto } });
    const form = new FormData();
    form.set('texto', texto);
    form.set('imagem', imagem);
    return api(`/api/chat/${id}/mensagens`, { metodo: 'POST', form });
  },
  naoLidas: () => api('/api/chat/nao-lidas'),

  // ── Avaliações ──
  avaliar: (solicitacaoId, nota, comentario) =>
    api('/api/avaliacoes', { metodo: 'POST', corpo: { solicitacaoId, nota, comentario } }),
  avaliacoesDe: (prestadorId) => api(`/api/avaliacoes/prestador/${prestadorId}`),
  responderAvaliacao: (id, texto) =>
    api(`/api/avaliacoes/${id}/resposta`, { metodo: 'POST', corpo: { texto } }),

  // ── Admin ──
  filaAprovacao: (status) => api(comParametros('/api/admin/prestadores', { status })),
  decidir: (id, decisao, motivo) =>
    api(`/api/admin/prestadores/${id}/decisao`, { metodo: 'POST', corpo: { decisao, motivo } }),
  notificacoes: () => api('/api/admin/notificacoes'),
  reenviarNotificacao: (id) =>
    api(`/api/admin/prestadores/${id}/reenviar-notificacao`, { metodo: 'POST' }),
  linkWhatsApp: (id) => api(`/api/admin/prestadores/${id}/link-whatsapp`),
};
