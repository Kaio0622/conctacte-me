// ============================================================
//  Telas do app. Cada função desenha em #tela e devolve uma
//  função de limpeza (para cancelar polling ao trocar de tela).
// ============================================================

const Telas = {};

const alvo = () => document.getElementById('tela');

/* ════════════════════════════════════════════════════════════
   BUSCA — categoria + localização → prestadores mais próximos
════════════════════════════════════════════════════════════ */

const filtros = {
  categoria: '',
  q: '',
  cidade: '',
  lat: '',
  lng: '',
  ordenar: 'relevancia',
  raio: 50,
};

Telas.busca = async function busca() {
  const versao = versaoTela;
  const salvo = LocalSalvo.ler();
  if (salvo && !filtros.cidade) {
    filtros.cidade = salvo.rotulo || '';
    filtros.lat = salvo.lat || '';
    filtros.lng = salvo.lng || '';
  }

  alvo().innerHTML = `
    <section class="capa">
      <div class="envolve">
        <h1>Profissionais verificados perto de você</h1>
        <p>Todo prestador passa por conferência manual antes de aparecer aqui. Compare avaliações reais e converse antes de fechar.</p>

        <form class="painel-busca" id="formBusca">
          <div class="campo" style="margin:0">
            <label class="campo-rotulo" for="fCategoria">O que você precisa</label>
            <select class="selecao" id="fCategoria"><option value="">Todas as categorias</option></select>
          </div>

          <div class="campo auto-envolve" style="margin:0">
            <label class="campo-rotulo" for="fCidade">Onde</label>
            <input class="entrada" id="fCidade" placeholder="Sua cidade" autocomplete="off"
                   value="${esc(filtros.cidade)}" />
            <button type="button" class="localizar" id="btnLocalizar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
              </svg>
              Usar minha localização
            </button>
          </div>

          <button class="btn btn-principal" type="submit" style="height:46px">Buscar</button>
        </form>
      </div>
    </section>

    <div class="trilha-categorias" id="chips"></div>

    <div class="envolve">
      <div class="barra-resultados">
        <span class="contagem" id="contagem"></span>
        <label class="ordenar">
          Ordenar por
          <select class="selecao" id="fOrdenar">
            <option value="relevancia">Distância + avaliação</option>
            <option value="distancia">Mais perto</option>
            <option value="avaliacao">Melhor avaliado</option>
            <option value="preco">Menor preço</option>
          </select>
        </label>
      </div>
      <div id="resultados">${esqueletos(6)}</div>
    </div>

    <footer class="rodape">
      <div class="rodape-links">
        <button data-ir="cadastro">Quero ser prestador</button>
        <button data-ir="conta">Minha conta</button>
        <a href="/admin.html">Painel do administrador</a>
      </div>
      <div>Contact Me · marketplace de serviços locais</div>
    </footer>`;

  document.getElementById('fOrdenar').value = filtros.ordenar;

  const inputCidade = document.getElementById('fCidade');
  ligarAutocompleteCidade(inputCidade);

  // ── Categorias (select + chips) ──
  let categorias = [];
  try {
    categorias = await API.categorias();
  } catch {
    avisarErro('Não foi possível carregar as categorias.');
  }

  if (versao !== versaoTela) return;
  const select = document.getElementById('fCategoria');
  select.innerHTML =
    '<option value="">Todas as categorias</option>' +
    categorias.map((c) => `<option value="${c.slug}">${esc(c.nome)}</option>`).join('');
  select.value = filtros.categoria;
  customizarCategorias(select, categorias.map(c => ({ ...c, label: c.nome })));

  const chips = document.getElementById('chips');
  const desenharChips = () => {
    chips.innerHTML =
      `<button class="chip" data-cat="" aria-pressed="${!filtros.categoria}">Todas</button>` +
      categorias
        .map(
          (c) => `<button class="chip" data-cat="${c.slug}" aria-pressed="${filtros.categoria === c.slug}">
            ${iconeUI(c.slug)} ${esc(c.nome)}${c.total ? `<span class="chip-total">${c.total}</span>` : ''}
          </button>`
        )
        .join('');
  };
  desenharChips();

  chips.addEventListener('click', (evento) => {
    const chip = evento.target.closest('.chip');
    if (!chip) return;
    filtros.categoria = chip.dataset.cat;
    select.value = filtros.categoria;
    desenharChips();
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // ── Submissão e ordenação ──
  document.getElementById('formBusca').addEventListener('submit', (evento) => {
    evento.preventDefault();
    aplicarCampos();
    carregar();
  });
  select.addEventListener('change', () => {
    filtros.categoria = select.value;
    desenharChips();
    carregar();
  });
  document.getElementById('fOrdenar').addEventListener('change', (evento) => {
    filtros.ordenar = evento.target.value;
    carregar();
  });

  document.getElementById('btnLocalizar').addEventListener('click', async (evento) => {
    const botao = evento.currentTarget;
    const original = botao.innerHTML;
    botao.textContent = 'Localizando...';
    botao.disabled = true;
    try {
      const posicao = await pedirLocalizacao();
      inputCidade.value = 'Minha localização atual';
      inputCidade.dataset.lat = posicao.lat;
      inputCidade.dataset.lng = posicao.lng;
      aplicarCampos();
      carregar();
      avisarOk('Localização detectada.');
    } catch (erro) {
      avisarErro(erro.message);
    } finally {
      botao.innerHTML = original;
      botao.disabled = false;
    }
  });

  function aplicarCampos() {
    filtros.cidade = inputCidade.value.trim();
    filtros.lat = inputCidade.dataset.lat || '';
    filtros.lng = inputCidade.dataset.lng || '';
    if (filtros.cidade) {
      LocalSalvo.gravar({ rotulo: filtros.cidade, lat: filtros.lat, lng: filtros.lng });
    }
  }

  // ── Carregamento dos resultados ──
  let requisicaoAtual = null;

  async function carregar() {
    if (versao !== versaoTela) return;
    requisicaoAtual?.abort();
    const controle = new AbortController();
    requisicaoAtual = controle;

    const caixa = document.getElementById('resultados');
    caixa.innerHTML = esqueletos(6);

    try {
      const dados = await API.buscar(filtros, controle.signal);
      if (versao === versaoTela && !controle.signal.aborted) desenharResultados(dados);
    } catch (erro) {
      if (erro.name === 'AbortError') return;
      caixa.innerHTML = telaVazia({
        icone: 'alerta',
        titulo: 'Não conseguimos buscar agora',
        texto: erro.message,
      });
    }
  }

  function desenharResultados(dados) {
    const caixa = document.getElementById('resultados');
    const contagem = document.getElementById('contagem');

    if (dados.avisoSemLocalizacao) {
      contagem.innerHTML = `<strong>${dados.total}</strong> ${dados.total === 1 ? 'profissional' : 'profissionais'} · informe sua cidade para ordenar por distância`;
    } else {
      contagem.innerHTML = `<strong>${dados.total}</strong> ${dados.total === 1 ? 'profissional' : 'profissionais'} perto de ${esc(dados.referencia?.rotulo || '')}`;
    }

    if (!dados.total) {
      caixa.innerHTML = telaVazia({
        titulo: 'Nenhum profissional por aqui ainda',
        texto: 'Tente outra categoria, aumente a distância ou busque numa cidade vizinha.',
        acao: '<button class="btn btn-contorno" id="btnLimpar">Limpar filtros</button>',
      });
      document.getElementById('btnLimpar')?.addEventListener('click', () => {
        filtros.categoria = '';
        filtros.q = '';
        select.value = '';
        desenharChips();
        carregar();
      });
      return;
    }

    caixa.innerHTML = `<div class="grade">${dados.resultados.map(cartaoPrestador).join('')}</div>`;
  }

  carregar();
  return () => requisicaoAtual?.abort();
};

// Cartão do resultado: foto grande, selo visível, avaliação em evidência.
function cartaoPrestador(p) {
  const distancia = distanciaTexto(p.distanciaKm);
  const foto = p.fotos?.[0];

  return `<button class="cartao" data-perfil="${p.id}">
    <div class="cartao-foto">
      ${foto
        ? `<img src="${esc(foto)}" alt="Trabalho de ${esc(p.nome)}" loading="lazy" />`
        : `<div class="cartao-foto-vazia">${esc(p.categoriaNome?.[0] || '·')}</div>`}
      ${p.verificado ? `<div class="cartao-selo-flutuante">${seloVerificado()}</div>` : ''}
      ${distancia ? `<span class="cartao-distancia">a ${distancia}</span>` : ''}
      ${p.fotos?.length > 1 ? `<span class="cartao-galeria-contagem">${p.fotos.length} fotos</span>` : ''}
    </div>
    <div class="cartao-corpo">
      <div class="cartao-topo">
        <div>
          <div class="cartao-nome">${esc(p.nome)}</div>
          <div class="cartao-categoria">${esc(p.categoriaNome)} · ${esc(p.areaAtendimento?.rotulo || '')}</div>
        </div>
      </div>
      <div class="nota-linha">
        ${estrelas(p.notaMedia)}
        ${p.totalAvaliacoes
          ? `<span class="nota-valor">${p.notaMedia.toFixed(1).replace('.', ',')}</span>
             <span class="nota-total">(${p.totalAvaliacoes})</span>`
          : '<span class="nota-total">Sem avaliações ainda</span>'}
      </div>
      <div class="cartao-descricao">${esc(p.descricao)}</div>
      <div class="cartao-rodape">
        <span class="preco">${precoCompleto(p)}</span>
        <span class="btn btn-contorno btn-pequeno">Ver perfil</span>
      </div>
    </div>
  </button>`;
}

/* ════════════════════════════════════════════════════════════
   PERFIL DO PRESTADOR
════════════════════════════════════════════════════════════ */

Telas.perfil = async function perfil(id) {
  const versao = versaoTela;
  alvo().innerHTML = `<div class="envolve" style="padding-top:20px">${esqueletos(1)}</div>`;

  let p;
  try {
    const salvo = LocalSalvo.ler() || {};
    p = await API.prestador(id, { cidade: salvo.rotulo, lat: salvo.lat, lng: salvo.lng });
    if (versao !== versaoTela) return;
  } catch (erro) {
    if (versao !== versaoTela) return;
    alvo().innerHTML = `<div class="envolve" style="padding-top:24px">${telaVazia({
      icone: 'proibido',
      titulo: 'Perfil indisponível',
      texto: erro.status === 404
        ? 'Este profissional não existe ou ainda não passou pela verificação.'
        : erro.message,
      acao: '<button class="btn btn-contorno" data-ir="busca">Voltar para a busca</button>',
    })}</div>`;
    return;
  }

  const distancia = distanciaTexto(p.distanciaKm);
  const avaliacoes = p.avaliacoes || [];

  const distribuicao = [5, 4, 3, 2, 1].map((estrela) => ({
    estrela,
    total: avaliacoes.filter((a) => a.nota === estrela).length,
  }));
  const maiorFaixa = Math.max(1, ...distribuicao.map((d) => d.total));

  alvo().innerHTML = `
  <article class="perfil">
    <div class="galeria" role="region" aria-label="Fotos do trabalho" aria-roledescription="carrossel">
      <div class="galeria-trilha" id="galeria" tabindex="0" aria-label="Fotos; use as setas do teclado para navegar">
        ${p.fotos?.length
          ? p.fotos.map((f, i) => `<img src="${esc(f)}" alt="Trabalho de ${esc(p.nome)} — foto ${i + 1}" ${i ? 'loading="lazy"' : ''} />`).join('')
          : `<div class="cartao-foto-vazia">${esc(p.categoriaNome?.[0] || '·')}</div>`}
      </div>
      ${p.fotos?.length > 1
        ? `<button type="button" class="galeria-seta galeria-anterior" id="fotoAnterior" aria-label="Foto anterior" aria-controls="galeria" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>
          </button>
          <button type="button" class="galeria-seta galeria-proxima" id="fotoProxima" aria-label="Próxima foto" aria-controls="galeria">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg>
          </button>
          <span class="galeria-contador" id="fotoContador" aria-live="polite" aria-atomic="true">1 / ${p.fotos.length}</span>
          <div class="galeria-pontos" id="pontos">${p.fotos.map((_, i) => `<button type="button" class="galeria-ponto ${i ? '' : 'ativo'}" data-i="${i}" aria-label="Foto ${i + 1}" aria-controls="galeria" aria-current="${i === 0 ? 'true' : 'false'}"></button>`).join('')}</div>`
        : ''}
    </div>

    <header class="perfil-cabecalho">
      <div class="envolve">
        <div class="perfil-nome-linha">
          <h1 class="perfil-nome">${esc(p.nome)}</h1>
          ${p.verificado ? seloVerificado(true) : seloStatus(p.status)}
        </div>

        <div class="nota-linha">
          ${estrelas(p.notaMedia, 'grande')}
          ${p.totalAvaliacoes
            ? `<span class="nota-valor">${p.notaMedia.toFixed(1).replace('.', ',')}</span>
               <span class="nota-total">· ${p.totalAvaliacoes} ${p.totalAvaliacoes === 1 ? 'avaliação' : 'avaliações'}</span>`
            : '<span class="nota-total">Ainda sem avaliações</span>'}
        </div>

        <div class="perfil-meta">
          <span class="perfil-meta-item">${esc(p.categoriaNome)}</span>
          <span class="perfil-meta-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/></svg>
            ${esc(p.areaAtendimento?.rotulo || '')}${distancia ? ` · a ${distancia}` : ''}
          </span>
        </div>

        <div class="faixa-confianca">
          <div class="confianca-item">
            <span class="confianca-valor">${p.notaMedia ? p.notaMedia.toFixed(1).replace('.', ',') : '—'}</span>
            <span class="confianca-rotulo">Nota média</span>
          </div>
          <div class="confianca-item">
            <span class="confianca-valor">${p.totalAvaliacoes}</span>
            <span class="confianca-rotulo">Avaliações</span>
          </div>
          <div class="confianca-item">
            <span class="confianca-valor">${p.areaAtendimento?.raioKm || '—'} km</span>
            <span class="confianca-rotulo">Atende até</span>
          </div>
        </div>
      </div>
    </header>

    <div class="envolve">
      <section class="secao">
        <h2 class="secao-titulo">Sobre o trabalho</h2>
        <p style="color:var(--tinta-suave);white-space:pre-wrap">${esc(p.descricao)}</p>
        ${p.verificado ? `
        <div class="faixa faixa-sucesso" style="margin-top:16px">
          <span class="faixa-icone">${iconeUI('escudo')}</span>
          <div><strong>Perfil verificado pela equipe</strong>
          Documentos, categoria e área de atendimento foram conferidos manualmente antes deste perfil entrar no ar.</div>
        </div>` : ''}
      </section>

      <section class="secao">
        <div class="secao-titulo"><h2>Avaliações</h2></div>
        ${avaliacoes.length ? `
          <div class="resumo-notas" style="margin-bottom:18px">
            <div class="resumo-nota-grande">
              <div class="resumo-nota-numero">${p.notaMedia.toFixed(1).replace('.', ',')}</div>
              ${estrelas(p.notaMedia, 'grande')}
              <div class="resumo-nota-total">${p.totalAvaliacoes} ${p.totalAvaliacoes === 1 ? 'avaliação' : 'avaliações'}</div>
            </div>
            <div class="barras">
              ${distribuicao.map((d) => `
                <div class="barra-linha">
                  <span>${d.estrela} ${iconeUI('estrela')}</span>
                  <span class="barra-trilho"><span class="barra-preenchida" style="width:${(d.total / maiorFaixa) * 100}%"></span></span>
                  <span>${d.total}</span>
                </div>`).join('')}
            </div>
          </div>
          <div>${avaliacoes.map(blocoAvaliacao).join('')}</div>
        ` : telaVazia({
          icone: 'mensagem',
          titulo: 'Ainda sem avaliações',
          texto: 'Este profissional acabou de entrar. Você pode ser a primeira pessoa a avaliar depois do serviço.',
        })}
      </section>

      <div class="acao-fixa">
        <span class="preco">${precoCompleto(p)}</span>
        <button class="btn btn-principal" id="btnSolicitar">Solicitar orçamento</button>
      </div>
    </div>
  </article>`;

  // Setas, pontos e teclado compartilham a mesma posição da galeria.
  const galeria = document.getElementById('galeria');
  const pontos = document.getElementById('pontos');
  let observarTamanho;
  if (pontos) {
    const anterior = document.getElementById('fotoAnterior');
    const proxima = document.getElementById('fotoProxima');
    const contador = document.getElementById('fotoContador');
    let indice = 0;
    let largura = galeria.clientWidth;
    function atualizarControles() {
      pontos.querySelectorAll('.galeria-ponto').forEach((ponto, i) => {
        ponto.classList.toggle('ativo', i === indice);
        ponto.setAttribute('aria-current', String(i === indice));
      });
      anterior.disabled = indice === 0;
      proxima.disabled = indice === p.fotos.length - 1;
      contador.textContent = `${indice + 1} / ${p.fotos.length}`;
    }
    function mostrarFoto(destino) {
      indice = Math.max(0, Math.min(p.fotos.length - 1, destino));
      galeria.scrollTo({
        left: indice * galeria.clientWidth,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
      atualizarControles();
    }
    galeria.addEventListener('scroll', () => {
      if (!galeria.clientWidth || galeria.clientWidth !== largura) return;
      indice = Math.max(0, Math.min(p.fotos.length - 1, Math.round(galeria.scrollLeft / largura)));
      atualizarControles();
    }, { passive: true });
    anterior.addEventListener('click', () => mostrarFoto(indice - 1));
    proxima.addEventListener('click', () => mostrarFoto(indice + 1));
    pontos.addEventListener('click', (evento) => {
      const ponto = evento.target.closest('.galeria-ponto');
      if (ponto) mostrarFoto(Number(ponto.dataset.i));
    });
    galeria.addEventListener('keydown', (evento) => {
      const destinos = { ArrowLeft: indice - 1, ArrowRight: indice + 1, Home: 0, End: p.fotos.length - 1 };
      if (!(evento.key in destinos)) return;
      evento.preventDefault();
      mostrarFoto(destinos[evento.key]);
    });
    observarTamanho = new ResizeObserver(() => {
      if (!galeria.clientWidth || galeria.clientWidth === largura) return;
      largura = galeria.clientWidth;
      galeria.scrollTo({ left: indice * largura, behavior: 'instant' });
    });
    observarTamanho.observe(galeria);
  }

  document.getElementById('btnSolicitar').addEventListener('click', () => abrirSolicitacao(p));
  return () => observarTamanho?.disconnect();
};

function blocoAvaliacao(a) {
  return `<div class="avaliacao">
    <div class="avaliacao-topo">
      <div class="avatar">${esc(iniciais(a.clienteNome))}</div>
      <div style="flex:1">
        <div class="avaliacao-autor">${esc(a.clienteNome)}</div>
        <div class="avaliacao-data">${dataCurta(a.criadoEm)}</div>
      </div>
      ${estrelas(a.nota)}
    </div>
    ${a.comentario ? `<p class="avaliacao-texto">${esc(a.comentario)}</p>` : ''}
    ${a.respostaPrestador ? `
      <div class="avaliacao-resposta">
        <strong>Resposta do profissional</strong>
        ${esc(a.respostaPrestador.texto)}
      </div>` : ''}
  </div>`;
}

// Modal de solicitação — exige estar logado como cliente.
function abrirSolicitacao(p) {
  if (!Sessao.logado) {
    avisar('Entre na sua conta para solicitar um orçamento.');
    return irPara('entrar', { voltarPara: `prestador/${p.id}` });
  }
  if (Sessao.papel !== 'cliente') {
    return avisarErro('Só contas de cliente podem solicitar serviços.');
  }

  abrirModal({
    titulo: `Solicitar a ${p.nome}`,
    descricao: 'Descreva o que você precisa. O profissional responde pelo chat interno.',
    corpo: `
      <form id="formSolicitar">
        <div class="campo">
          <label class="campo-rotulo" for="descPedido">O que você precisa?</label>
          <textarea class="area-texto" id="descPedido" required minlength="10"
            placeholder="Ex: pintar sala e dois quartos, cerca de 80 m². Paredes com algumas rachaduras."></textarea>
          <div class="campo-dica">Quanto mais detalhe, mais preciso o orçamento.</div>
        </div>
        <button class="btn btn-principal btn-cheio" type="submit">Enviar solicitação</button>
      </form>`,
    aoMontar: (modal, fechar) => {
      modal.querySelector('#formSolicitar').addEventListener('submit', async (evento) => {
        evento.preventDefault();
        const botao = evento.target.querySelector('button');
        botao.disabled = true;
        botao.textContent = 'Enviando...';
        try {
          const resposta = await API.solicitar(p.id, modal.querySelector('#descPedido').value);
          fechar();
          avisarOk('Solicitação enviada!');
          irPara(`chat/${resposta.solicitacao.id}`);
        } catch (erro) {
          if (erro.status === 409 && erro.dados?.solicitacaoId) {
            fechar();
            avisar('Você já tem uma conversa aberta com este profissional.');
            return irPara(`chat/${erro.dados.solicitacaoId}`);
          }
          avisarErro(erro.message);
          botao.disabled = false;
          botao.textContent = 'Enviar solicitação';
        }
      });
    },
  });
}

/* ════════════════════════════════════════════════════════════
   SOLICITAÇÕES — histórico do cliente / fila do prestador
════════════════════════════════════════════════════════════ */

Telas.solicitacoes = async function solicitacoes() {
  const versao = versaoTela;
  if (!Sessao.logado) return telaPrecisaEntrar('solicitacoes');

  const souPrestador = Sessao.papel === 'prestador';

  alvo().innerHTML = `
    <div class="envolve">
      <div style="padding:20px 0 4px">
        <h1>${souPrestador ? 'Pedidos recebidos' : 'Minhas solicitações'}</h1>
        <p style="color:var(--tinta-suave);font-size:.9rem">
          ${souPrestador
            ? 'Responda rápido: clientes tendem a fechar com quem retorna primeiro.'
            : 'Acompanhe seus pedidos, converse pelo chat e avalie depois do serviço.'}
        </p>
      </div>
      <div class="lista" id="lista">${esqueletos(3)}</div>
    </div>`;

  try {
    const dados = await API.solicitacoes();
    if (versao !== versaoTela) return;
    const lista = document.getElementById('lista');

    if (!dados.total) {
      lista.innerHTML = telaVazia({
        icone: souPrestador ? 'inbox' : 'trabalho',
        titulo: souPrestador ? 'Nenhum pedido ainda' : 'Você ainda não pediu nenhum serviço',
        texto: souPrestador
          ? 'Assim que um cliente solicitar seu serviço, o pedido aparece aqui com o chat aberto.'
          : 'Busque um profissional na sua região e envie a primeira solicitação.',
        acao: souPrestador ? '' : '<button class="btn btn-principal" data-ir="busca">Buscar profissionais</button>',
      });
      return;
    }

    lista.innerHTML = dados.solicitacoes.map((s) => itemSolicitacao(s, souPrestador)).join('');
  } catch (erro) {
    if (versao !== versaoTela) return;
    document.getElementById('lista').innerHTML = telaVazia({
      icone: 'alerta', titulo: 'Não conseguimos carregar', texto: erro.message,
    });
  }
};

function itemSolicitacao(s, souPrestador) {
  const outro = souPrestador ? s.cliente : s.prestador;
  const previa = s.chat.ultimaMensagem
    ? `${s.chat.ultimaMensagem.souEuAutor ? 'Você: ' : ''}${s.chat.ultimaMensagem.texto}`
    : s.descricao;

  return `<button class="item" data-chat="${s.id}">
    ${souPrestador
      ? `<div class="avatar" style="width:54px;height:54px;font-size:1rem">${esc(iniciais(outro?.nome))}</div>`
      : outro?.foto
        ? `<img class="item-foto" src="${esc(outro.foto)}" alt="" />`
        : `<div class="avatar" style="width:54px;height:54px;font-size:1rem">${esc(iniciais(outro?.nome))}</div>`}
    <div class="item-corpo">
      <div class="item-topo">
        <span class="item-nome">${esc(outro?.nome || '—')}</span>
        ${!souPrestador && outro?.verificado ? seloVerificado() : ''}
      </div>
      <div class="item-previa">${esc(previa)}</div>
      <div style="margin-top:7px;display:flex;gap:7px;align-items:center;flex-wrap:wrap">
        ${etiquetaStatus(s.status)}
        ${s.podeAvaliar ? '<span class="etiqueta" style="background:var(--alerta-leve);color:var(--alerta)">Avaliar</span>' : ''}
      </div>
    </div>
    <div class="item-fim">
      <span class="item-hora">${tempoRelativo(s.chat.ultimaMensagem?.criadoEm || s.criadoEm)}</span>
      ${s.chat.naoLidas ? `<span class="selo-contagem" style="position:static">${s.chat.naoLidas}</span>` : ''}
    </div>
  </button>`;
}

/* ════════════════════════════════════════════════════════════
   CHAT INTERNO
════════════════════════════════════════════════════════════ */

Telas.chat = async function chat(id) {
  if (!Sessao.logado) return telaPrecisaEntrar(`chat/${id}`);

  const versao = versaoTela;
  let s;
  try {
    s = await API.solicitacao(id);
    if (versao !== versaoTela) return;
  } catch (erro) {
    if (versao !== versaoTela) return;
    alvo().innerHTML = `<div class="envolve" style="padding-top:24px">${telaVazia({
      icone: 'proibido', titulo: 'Conversa indisponível', texto: erro.message,
      acao: '<button class="btn btn-contorno" data-ir="solicitacoes">Voltar</button>',
    })}</div>`;
    return;
  }

  const souPrestador = Sessao.papel === 'prestador';
  const outro = souPrestador ? s.cliente : s.prestador;
  const encerrada = ['cancelada', 'recusada'].includes(s.status);

  alvo().innerHTML = `
    <div class="chat">
      <header class="chat-cabecalho">
        <button class="chat-voltar" data-ir="solicitacoes" aria-label="Voltar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div class="chat-titulo">
          <div class="chat-nome">
            ${esc(outro?.nome || '—')}
            ${!souPrestador && outro?.verificado ? seloVerificado() : ''}
          </div>
          <div class="chat-sub">${esc(souPrestador ? (outro?.localizacao || 'Cliente') : (outro?.categoriaNome || ''))}</div>
        </div>
        ${!souPrestador && s.prestador
          ? `<button class="btn btn-contorno btn-pequeno" data-perfil="${s.prestador.id}">Perfil</button>`
          : ''}
      </header>

      <div id="acoesChat"></div>

      <div class="chat-mensagens" id="mensagens" role="log" aria-label="Mensagens"></div>
      <div id="conexaoChat" role="status"></div>

      <form class="chat-escrita" id="formMensagem" ${encerrada ? 'style="display:none"' : ''}>
        <div class="chat-foto-previa" hidden aria-live="polite"></div>
        <div class="chat-foto-ferramentas">
          <button class="chat-anexar" id="abrirGaleria" type="button" aria-label="Escolher foto da galeria"><span aria-hidden="true">${iconeUI('imagem')}</span> Galeria</button>
          <button class="chat-anexar" id="abrirCamera" type="button" aria-label="Tirar foto com a câmera"><span aria-hidden="true">${iconeUI('camera')}</span> Câmera</button>
          <span>Uma foto de até 4 MB</span>
        </div>
        <input type="file" id="fotoGaleria" accept="image/jpeg,image/png,image/webp" hidden />
        <input type="file" id="fotoCamera" accept="image/jpeg,image/png,image/webp" capture="environment" hidden />
        <textarea id="campoMensagem" rows="1" placeholder="Escreva uma mensagem..." maxlength="2000"></textarea>
        <button class="chat-enviar" type="submit" aria-label="Enviar" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </form>
<div id="chatEncerrado" class="faixa" hidden>Esta conversa foi encerrada.</div>
    </div>`;

  const caixaMensagens = document.getElementById('mensagens');
  const campo = document.getElementById('campoMensagem');
  const botaoEnviar = document.querySelector('.chat-enviar');

  let cursor = null;
  let enviando = false;
  const formulario = document.getElementById('formMensagem');
  const avisoEncerrado = document.getElementById('chatEncerrado');
  const conexao = document.getElementById('conexaoChat');
  const acoes = document.getElementById('acoesChat');
  let ativo = true;
  let controle = null;
  let ultimaData = null;
  // Ids já desenhados. A mensagem que eu envio é pintada na hora
  // (resposta do POST) e chega de novo pelo polling — sem este
  // controle ela apareceria duplicada.
  const jaDesenhadas = new Map();
  const fotos = criarFotosChat(formulario, atualizarEnvio);
  function atualizarEnvio() {
    botaoEnviar.disabled = enviando || (!campo.value.trim() && !fotos.arquivo);
  }

  desenharAcoes();

  function desenharAcoes() {
    if (!ativo || versao !== versaoTela) return;
    const fechada = ['cancelada', 'recusada'].includes(s.status);
    formulario.style.display = fechada ? 'none' : '';
    fotos.bloquear(fechada || enviando);
    avisoEncerrado.hidden = !fechada;
    const caixa = acoes;
    const botoes = [];

    if (souPrestador && s.status === 'aberta') {
      botoes.push('<button class="btn btn-principal btn-pequeno" data-status="aceita">Aceitar pedido</button>');
      botoes.push('<button class="btn btn-contorno btn-pequeno" data-status="recusada">Recusar</button>');
    }
    if (s.status === 'aceita') {
      botoes.push('<button class="btn btn-principal btn-pequeno" data-status="concluida">Marcar como concluído</button>');
    }
    if (!souPrestador && ['aberta', 'aceita'].includes(s.status)) {
      botoes.push('<button class="btn btn-fantasma btn-pequeno" data-status="cancelada">Cancelar</button>');
    }
    if (s.podeAvaliar) {
      botoes.push('<button class="btn btn-principal btn-pequeno" id="btnAvaliar">Avaliar profissional</button>');
    }

    if (!botoes.length) {
      caixa.innerHTML = '';
      return;
    }

    const textos = {
      aberta: souPrestador ? 'Novo pedido aguardando sua resposta.' : 'Aguardando o profissional aceitar.',
      aceita: 'Serviço em andamento. Marque como concluído quando terminar.',
      concluida: 'Serviço concluído.',
    };

    caixa.innerHTML = `<div class="chat-acoes">
      <p>${esc(textos[s.status] || '')}</p>
      ${botoes.join('')}
    </div>`;

    caixa.querySelectorAll('[data-status]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        botao.disabled = true;
        try {
          const resposta = await API.mudarStatus(s.id, botao.dataset.status);
          s = resposta.solicitacao;
          avisarOk(resposta.mensagem);
          desenharAcoes();
        } catch (erro) {
          avisarErro(erro.message);
          botao.disabled = false;
        }
      });
    });

    caixa.querySelector('#btnAvaliar')?.addEventListener('click', () => abrirAvaliacao(s, () => {
      API.solicitacao(s.id).then((nova) => { s = nova; desenharAcoes(); }).catch(() => {});
    }));
  }

  function acrescentar(mensagens) {
    const novas = mensagens.filter((m) => !jaDesenhadas.has(m.id));
    if (!novas.length) return;
    const perto = caixaMensagens.scrollHeight - caixaMensagens.scrollTop - caixaMensagens.clientHeight < 140;

    const scrollAnterior = caixaMensagens.scrollTop;
    for (const m of novas) jaDesenhadas.set(m.id, m);
    caixaMensagens.replaceChildren();
    ultimaData = null;
    for (const m of [...jaDesenhadas.values()].sort((a, b) => a.ordem - b.ordem)) {

      const dia = new Date(m.criadoEm).toDateString();
      if (dia !== ultimaData) {
        ultimaData = dia;
        const divisor = document.createElement('div');
        divisor.className = 'chat-divisor';
        divisor.textContent = new Date(m.criadoEm).toLocaleDateString('pt-BR', {
          day: '2-digit', month: 'long',
        });
        caixaMensagens.appendChild(divisor);
      }

      const balao = document.createElement('div');
      balao.className = `balao ${m.souEuAutor ? 'balao-eu' : 'balao-outro'}`;
      balao.innerHTML = `${esc(m.texto)}<span class="balao-hora">${hora(m.criadoEm)}</span>`;
      caixaMensagens.appendChild(balao);
      if (m.imagem) fotos.desenharImagem({ ...m, solicitacaoId: id }, balao, () => {
        if (perto && ativo) caixaMensagens.scrollTop = caixaMensagens.scrollHeight;
      });
    }

    caixaMensagens.scrollTop = perto ? caixaMensagens.scrollHeight : scrollAnterior;
  }

  // Long polling: o GET fica aberto até 25s esperando novidade.
  async function escutar() {
    while (ativo && versao === versaoTela) {
      controle = new AbortController();
      try {
        const dados = await API.mensagens(id, cursor, Boolean(cursor), controle.signal, s.status);
        if (!ativo || versao !== versaoTela) return;
        conexao.textContent = '';
        cursor = dados.cursor;
        acrescentar(dados.mensagens);
        s = dados.solicitacao;
        desenharAcoes();
        atualizarBadge();
      } catch (erro) {
        if (!ativo || erro.name === 'AbortError') return;
        if ([401, 403, 404].includes(erro.status)) { conexao.textContent = erro.message; return; }
        conexao.textContent = 'Reconectando ao chat…';
        // Rede caiu: espera um pouco antes de tentar de novo.
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  campo.addEventListener('input', () => {
    atualizarEnvio();
    campo.style.height = 'auto';
    campo.style.height = `${Math.min(campo.scrollHeight, 120)}px`;
  });

  campo.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter' && !evento.isComposing && !evento.shiftKey && window.matchMedia('(min-width: 860px)').matches) {
      evento.preventDefault();
      document.getElementById('formMensagem').requestSubmit();
    }
  });

  document.getElementById('formMensagem')?.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const texto = campo.value.trim();
    const imagem = fotos.arquivo;
    if ((!texto && !imagem) || enviando || ['cancelada', 'recusada'].includes(s.status)) return;
    enviando = true;
    fotos.bloquear(true);
    campo.disabled = true;

    campo.value = '';
    campo.style.height = 'auto';
    botaoEnviar.disabled = true;

    try {
      const resposta = await API.enviarMensagem(id, texto, imagem);
      // Pinta na hora, sem esperar o polling: numa conexão ruim o
      // usuário digitaria e ficaria olhando para o nada. O polling
      // devolve a mesma mensagem depois e o dedupe por id descarta.
      if (!ativo || versao !== versaoTela) return;
      fotos.limpar();
      acrescentar([resposta.mensagem]);
      caixaMensagens.scrollTop = caixaMensagens.scrollHeight;
    } catch (erro) {
      if (!ativo || versao !== versaoTela) return;
      avisarErro(erro.message);
      campo.value = texto;
    } finally {
      enviando = false;
      campo.disabled = false;
      fotos.bloquear(['cancelada', 'recusada'].includes(s.status));
      atualizarEnvio();
      if (ativo && versao === versaoTela) campo.focus();
    }
  });

  escutar();

  return () => {
    ativo = false;
    controle?.abort();
    fotos.destruir();
  };
};

// Modal de avaliação — nota obrigatória, comentário opcional.
function abrirAvaliacao(s, aoConcluir) {
  let nota = 0;

  abrirModal({
    titulo: 'Como foi o serviço?',
    descricao: `Sua avaliação aparece no perfil de ${s.prestador?.nome || 'do profissional'} e ajuda outros clientes.`,
    corpo: `
      <form id="formAvaliar">
        <div class="seletor-estrelas" id="seletor">
          ${[1, 2, 3, 4, 5].map((i) => `
            <button type="button" data-nota="${i}" aria-label="${i} ${i === 1 ? 'estrela' : 'estrelas'}">
              <svg viewBox="0 0 24 24" class="estrela-vazia">${ICONE_ESTRELA}</svg>
            </button>`).join('')}
        </div>
        <div class="campo">
          <label class="campo-rotulo" for="comentario">Comentário (opcional)</label>
          <textarea class="area-texto" id="comentario" maxlength="1000"
            placeholder="Conte como foi: pontualidade, capricho, se cumpriu o combinado..."></textarea>
        </div>
        <button class="btn btn-principal btn-cheio" type="submit" disabled>Publicar avaliação</button>
      </form>`,
    aoMontar: (modal, fechar) => {
      const seletor = modal.querySelector('#seletor');
      const enviar = modal.querySelector('button[type="submit"]');

      seletor.addEventListener('click', (evento) => {
        const botao = evento.target.closest('[data-nota]');
        if (!botao) return;
        nota = Number(botao.dataset.nota);
        seletor.querySelectorAll('svg').forEach((svg, i) => {
          svg.className.baseVal = i < nota ? 'estrela-cheia' : 'estrela-vazia';
        });
        enviar.disabled = false;
      });

      modal.querySelector('#formAvaliar').addEventListener('submit', async (evento) => {
        evento.preventDefault();
        enviar.disabled = true;
        enviar.textContent = 'Publicando...';
        try {
          await API.avaliar(s.id, nota, modal.querySelector('#comentario').value);
          fechar();
          avisarOk('Avaliação publicada. Obrigado!');
          aoConcluir?.();
        } catch (erro) {
          avisarErro(erro.message);
          enviar.disabled = false;
          enviar.textContent = 'Publicar avaliação';
        }
      });
    },
  });
}

/* ── Tela de "precisa entrar" ──────────────────────────────── */

function telaPrecisaEntrar(voltarPara) {
  alvo().innerHTML = `<div class="envolve" style="padding-top:32px">${telaVazia({
    icone: 'cadeado',
    titulo: 'Entre para continuar',
    texto: 'Você precisa estar logado para ver suas solicitações e conversar com profissionais.',
    acao: `<button class="btn btn-principal" data-ir="entrar" data-voltar="${esc(voltarPara)}">Entrar ou criar conta</button>`,
  })}</div>`;
}
