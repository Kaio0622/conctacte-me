// ============================================================
//  Utilidades de interface — formatação, ícones, avisos,
//  modais e o autocomplete de cidade.
// ============================================================

/* ── Escape: tudo que vem do usuário passa por aqui antes de
      virar HTML. Nome de prestador, comentário de avaliação e
      mensagem de chat são texto livre. ───────────────────── */
function esc(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/* ── Formatação ─────────────────────────────────────────── */

const UNIDADES = { hora: '/hora', diaria: '/diária', servico: '/serviço', m2: '/m²' };

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 2,
  });
}

function precoCompleto(prestador) {
  return `${dinheiro(prestador.precoMedio)}<span class="preco-unidade">${UNIDADES[prestador.unidadePreco] || ''}</span>`;
}

function distanciaTexto(km) {
  if (km == null) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

function tempoRelativo(iso) {
  if (!iso) return '';
  const agora = Date.now();
  const quando = new Date(iso).getTime();
  const segundos = Math.round((agora - quando) / 1000);

  if (segundos < 60) return 'agora';
  if (segundos < 3600) return `${Math.floor(segundos / 60)} min`;
  if (segundos < 86400) return `${Math.floor(segundos / 3600)} h`;
  if (segundos < 604800) return `${Math.floor(segundos / 86400)} d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function dataCurta(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function hora(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function iniciais(nome) {
  return String(nome || '?')
    .trim().split(/\s+/).slice(0, 2)
    .map((p) => p[0]).join('').toUpperCase();
}

/* ── Ícones ─────────────────────────────────────────────── */

const ICONE_ESTRELA =
  '<path d="M12 2.4l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z"/>';

// Escudo com o check — o desenho do selo de verificação.
const ICONE_ESCUDO =
  '<path d="M12 1.8 3.8 5v6.1c0 5.1 3.5 9.9 8.2 11.1 4.7-1.2 8.2-6 8.2-11.1V5z" fill="currentColor" opacity=".18"/>' +
  '<path d="M12 1.8 3.8 5v6.1c0 5.1 3.5 9.9 8.2 11.1 4.7-1.2 8.2-6 8.2-11.1V5z" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
  '<path d="m8.4 11.9 2.5 2.5 4.7-4.8" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>';

function estrelas(nota, classe = '') {
  const cheias = Math.round(Number(nota) || 0);
  let html = `<span class="estrelas ${classe}" role="img" aria-label="${(Number(nota) || 0).toFixed(1)} de 5">`;
  for (let i = 1; i <= 5; i++) {
    html += `<svg viewBox="0 0 24 24" class="${i <= cheias ? 'estrela-cheia' : 'estrela-vazia'}">${ICONE_ESTRELA}</svg>`;
  }
  return `${html}</span>`;
}

// O selo. Só deve ser chamado quando prestador.verificado === true.
function seloVerificado(grande = false) {
  return `<span class="selo-verificado ${grande ? 'grande' : ''}" title="Perfil conferido manualmente pela equipe Contact Me">
    <svg viewBox="0 0 24 24">${ICONE_ESCUDO}</svg>Perfil verificado</span>`;
}

function seloStatus(status) {
  if (status === 'aprovado') return seloVerificado();
  const rotulos = {
    pendente: 'Em verificação',
    rejeitado: 'Cadastro rejeitado',
    suspenso: 'Perfil suspenso',
  };
  return `<span class="selo-pendente">${rotulos[status] || status}</span>`;
}

function etiquetaStatus(status) {
  const rotulos = {
    aberta: 'Aguardando resposta',
    aceita: 'Em andamento',
    concluida: 'Concluído',
    recusada: 'Recusado',
    cancelada: 'Cancelado',
  };
  return `<span class="etiqueta etiqueta-${status}">${rotulos[status] || status}</span>`;
}

/* ── Avisos flutuantes ──────────────────────────────────── */

function avisar(mensagem, tipo = '') {
  const caixa = document.getElementById('avisos');
  const elemento = document.createElement('div');
  elemento.className = `aviso ${tipo ? `aviso-${tipo}` : ''}`;
  elemento.textContent = mensagem;
  caixa.appendChild(elemento);
  setTimeout(() => {
    elemento.style.transition = 'opacity .25s, transform .25s';
    elemento.style.opacity = '0';
    elemento.style.transform = 'translateY(6px)';
    setTimeout(() => elemento.remove(), 260);
  }, 3600);
}

const avisarOk = (m) => avisar(m, 'ok');
const avisarErro = (m) => avisar(m, 'erro');

/* ── Modal ──────────────────────────────────────────────── */

let fecharModalAtual = null;

function abrirModal({ titulo, descricao = '', corpo, aoMontar }) {
  fecharModal();

  const cortina = document.createElement('div');
  cortina.className = 'cortina';
  cortina.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <div class="modal-cabecalho">
        <div>
          <h2>${esc(titulo)}</h2>
          ${descricao ? `<p class="modal-desc">${esc(descricao)}</p>` : ''}
        </div>
        <button class="modal-fechar" aria-label="Fechar">${iconeUI('fechar')}</button>
      </div>
      <div class="modal-corpo">${corpo}</div>
    </div>`;

  document.getElementById('modais').appendChild(cortina);
  document.body.style.overflow = 'hidden';

  const fechar = () => {
    cortina.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', aoTeclar);
    fecharModalAtual = null;
  };
  const aoTeclar = (evento) => { if (evento.key === 'Escape') fechar(); };

  cortina.querySelector('.modal-fechar').addEventListener('click', fechar);
  cortina.addEventListener('click', (evento) => { if (evento.target === cortina) fechar(); });
  document.addEventListener('keydown', aoTeclar);
  fecharModalAtual = fechar;

  aoMontar?.(cortina.querySelector('.modal'), fechar);

  // Foco no primeiro campo — teclado sobe direto no celular.
  const primeiro = cortina.querySelector('input, textarea, select, button:not(.modal-fechar)');
  primeiro?.focus({ preventScroll: true });

  return fechar;
}

function fecharModal() { fecharModalAtual?.(); }

/* ── Autocomplete de cidade ─────────────────────────────── */

// Liga um input de texto às sugestões de /api/cidades e guarda
// a coordenada escolhida em dataset.lat / dataset.lng.
function ligarAutocompleteCidade(input) {
  const envolve = input.closest('.auto-envolve');
  if (!envolve) return;

  let lista = null;
  let relogio = null;
  let indice = -1;
  let opcoes = [];

  const fechar = () => { lista?.remove(); lista = null; indice = -1; opcoes = []; };

  const escolher = (cidade) => {
    input.value = cidade.rotulo;
    input.dataset.lat = cidade.lat;
    input.dataset.lng = cidade.lng;
    fechar();
  };

  const desenhar = () => {
    fechar();
    if (!opcoes.length) return;
    lista = document.createElement('div');
    lista.className = 'auto-lista';
    lista.innerHTML = opcoes
      .map((c, i) => `<button type="button" data-i="${i}" class="${i === indice ? 'ativo' : ''}">${esc(c.rotulo)}</button>`)
      .join('');
    lista.addEventListener('mousedown', (evento) => {
      const botao = evento.target.closest('button');
      if (botao) { evento.preventDefault(); escolher(opcoes[Number(botao.dataset.i)]); }
    });
    envolve.appendChild(lista);
  };

  input.addEventListener('input', () => {
    // Digitou de novo: a coordenada anterior não vale mais.
    delete input.dataset.lat;
    delete input.dataset.lng;

    clearTimeout(relogio);
    const termo = input.value.trim();
    if (termo.length < 2) return fechar();

    relogio = setTimeout(async () => {
      try {
        opcoes = await API.cidades(termo);
        indice = -1;
        desenhar();
      } catch { fechar(); }
    }, 180);
  });

  input.addEventListener('keydown', (evento) => {
    if (!opcoes.length) return;
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      indice = evento.key === 'ArrowDown'
        ? (indice + 1) % opcoes.length
        : (indice - 1 + opcoes.length) % opcoes.length;
      desenhar();
    } else if (evento.key === 'Enter' && indice >= 0) {
      evento.preventDefault();
      escolher(opcoes[indice]);
    } else if (evento.key === 'Escape') {
      fechar();
    }
  });

  input.addEventListener('blur', () => setTimeout(fechar, 120));
}

// Pede a posição ao navegador e devolve { lat, lng }.
function pedirLocalizacao() {
  return new Promise((resolver, rejeitar) => {
    if (!navigator.geolocation) {
      return rejeitar(new Error('Seu navegador não suporta geolocalização.'));
    }
    navigator.geolocation.getCurrentPosition(
      (posicao) => resolver({ lat: posicao.coords.latitude, lng: posicao.coords.longitude }),
      (erro) => {
        const motivos = {
          1: 'Você bloqueou o acesso à localização. Digite sua cidade no campo.',
          2: 'Não conseguimos determinar sua posição. Digite sua cidade.',
          3: 'A busca por localização demorou demais. Digite sua cidade.',
        };
        rejeitar(new Error(motivos[erro.code] || 'Não foi possível obter sua localização.'));
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  });
}

/* ── Estado vazio / esqueleto ───────────────────────────── */

function telaVazia({ icone = 'busca', titulo, texto, acao = '' }) {
  return `<div class="vazio">
    <div class="vazio-icone">${iconeUI(icone)}</div>
    <h3>${esc(titulo)}</h3>
    <p>${esc(texto)}</p>
    ${acao}
  </div>`;
}

// Select visual para categorias: o select nativo continua presente para
// teclado, acessibilidade e formulários, enquanto o menu desenha os SVGs.
function customizarCategorias(select, categorias, placeholder = 'Todas as categorias') {
  if (!select || select.dataset.categoriasDecoradas === '1') return;
  select.dataset.categoriasDecoradas = '1';
  const campo = select.parentElement;
  campo.classList.add('categoria-picker');
  const botao = document.createElement('button');
  botao.type = 'button'; botao.className = 'categoria-trigger';
  botao.setAttribute('aria-haspopup', 'listbox');
  const menu = document.createElement('div');
  menu.className = 'categoria-menu'; menu.hidden = true; menu.setAttribute('role', 'listbox');
  const opcoes = [{ value: '', label: placeholder, icone: 'categorias' }, ...categorias];
  function escolhido() { return opcoes.find(o => o.value === select.value) || opcoes[0]; }
  function sincronizar() {
    const atual = escolhido();
    botao.innerHTML = `${iconeUI(atual.icone)}<span>${esc(atual.label || atual.nome)}</span><span class="categoria-chevron">${iconeUI('chevron')}</span>`;
    menu.querySelectorAll('[role="option"]').forEach(item => item.setAttribute('aria-selected', String(item.dataset.value === select.value)));
  }
  menu.innerHTML = opcoes.map(o => `<button type="button" role="option" data-value="${esc(o.value)}" aria-selected="false">${iconeUI(o.icone)}<span>${esc(o.label || o.nome)}</span></button>`).join('');
  campo.insertBefore(botao, select);
  campo.appendChild(menu);
  function fechar() { menu.hidden = true; botao.setAttribute('aria-expanded', 'false'); }
  function abrir() { menu.hidden = false; botao.setAttribute('aria-expanded', 'true'); }
  botao.setAttribute('aria-expanded', 'false');
  botao.addEventListener('click', () => menu.hidden ? abrir() : fechar());
  botao.addEventListener('keydown', evento => {
    if (evento.key === 'Escape') fechar();
    if (evento.key === 'ArrowDown' || evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); abrir(); menu.querySelector('[aria-selected="true"]')?.focus(); }
  });
  menu.querySelectorAll('[role="option"]').forEach(item => item.addEventListener('click', () => {
    select.value = item.dataset.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    sincronizar(); fechar(); botao.focus();
  }));
  select.addEventListener('change', sincronizar);
  document.addEventListener('click', evento => { if (!campo.contains(evento.target)) fechar(); });
  sincronizar();
}

function esqueletos(quantidade = 6) {
  return `<div class="grade">${'<div class="esqueleto esqueleto-cartao"></div>'.repeat(quantidade)}</div>`;
}

/* ── Localização preferida do visitante (lembrada no aparelho) ── */

const LocalSalvo = {
  CHAVE: 'contactme.local',
  ler() {
    try { return JSON.parse(localStorage.getItem(this.CHAVE)) || null; } catch { return null; }
  },
  gravar(local) { localStorage.setItem(this.CHAVE, JSON.stringify(local)); },
};
