// ============================================================
//  Roteador + telas de conta (entrar, cadastro, minha conta)
// ============================================================

let limparTelaAtual = null;
let versaoTela = 0;
let voltarDepoisDoLogin = null;

/* ── Navegação ──────────────────────────────────────────── */

function irPara(rota, opcoes = {}) {
  if (opcoes.voltarPara) voltarDepoisDoLogin = opcoes.voltarPara;
  const destino = `#/${rota}`;
  if (location.hash === destino) desenhar();
  else location.hash = destino;
}

async function desenhar() {
  const versao = ++versaoTela;
  limparTelaAtual?.();
  limparTelaAtual = null;

  const rota = location.hash.replace(/^#\/?/, '') || 'busca';
  const [nome, parametro] = rota.split('/');

  const mapa = {
    busca: () => Telas.busca(),
    prestador: () => Telas.perfil(parametro),
    solicitacoes: () => Telas.solicitacoes(),
    chat: () => Telas.chat(parametro),
    conta: () => TelaConta(),
    entrar: () => TelaEntrar(),
    cadastro: () => TelaCadastro(),
    google: () => TelaGoogle(),
  };

  const executar = mapa[nome] || mapa.busca;

  window.scrollTo({ top: 0 });
  try {
    const limpar = await executar();
    if (versao !== versaoTela) { limpar?.(); return; }
    limparTelaAtual = limpar;
  } catch (erro) {
    if (versao !== versaoTela) return;
    console.error(erro);
    document.getElementById('tela').innerHTML =
      `<div class="envolve" style="padding-top:28px">${telaVazia({
        icone: 'alerta', titulo: 'Algo deu errado nesta tela', texto: erro.message,
        acao: '<button class="btn btn-contorno" data-ir="busca">Voltar ao início</button>',
      })}</div>`;
  }

  marcarAbaAtiva(nome);
  atualizarTopo();
}

function marcarAbaAtiva(nome) {
  const aba = { prestador: 'busca', chat: 'solicitacoes', entrar: 'conta', cadastro: 'conta', google: 'conta' }[nome] || nome;
  document.querySelectorAll('#abas button, #navTopo button').forEach((botao) => {
    if (botao.dataset.ir === aba) botao.setAttribute('aria-current', 'page');
    else botao.removeAttribute('aria-current');
  });
}

function atualizarTopo() {
  const caixa = document.getElementById('topoFim');
  if (Sessao.logado) {
    const usuario = Sessao.usuario;
    caixa.innerHTML = `
      <button class="btn btn-fantasma btn-pequeno" data-ir="conta">
        <span class="avatar" style="width:26px;height:26px;font-size:.7rem">${esc(iniciais(usuario.nome))}</span>
        <span class="so-leitor">Minha conta</span>
      </button>`;
  } else {
    caixa.innerHTML = `
      <button class="btn btn-fantasma btn-pequeno" data-ir="entrar">Entrar</button>
      <button class="btn btn-principal btn-pequeno" data-ir="cadastro">Criar conta</button>`;
  }
}

/* ── Delegação de cliques ───────────────────────────────── */

document.addEventListener('click', (evento) => {
  const irBotao = evento.target.closest('[data-ir]');
  if (irBotao) {
    evento.preventDefault();
    return irPara(irBotao.dataset.ir, { voltarPara: irBotao.dataset.voltar });
  }

  const perfilBotao = evento.target.closest('[data-perfil]');
  if (perfilBotao) {
    evento.preventDefault();
    return irPara(`prestador/${perfilBotao.dataset.perfil}`);
  }

  const chatBotao = evento.target.closest('[data-chat]');
  if (chatBotao) {
    evento.preventDefault();
    return irPara(`chat/${chatBotao.dataset.chat}`);
  }
});

window.addEventListener('hashchange', desenhar);
window.addEventListener('sessao-expirada', () => {
  avisar('Sua sessão expirou. Entre de novo.');
  atualizarTopo();
  irPara('entrar');
});

/* ════════════════════════════════════════════════════════════
   ENTRAR
════════════════════════════════════════════════════════════ */

function TelaEntrar() {
  if (Sessao.logado) return irPara('conta');

  document.getElementById('tela').innerHTML = `
    <div class="envolve" style="max-width:440px;padding-top:28px">
      <h1 style="margin-bottom:6px">Entrar</h1>
      <p style="color:var(--tinta-suave);font-size:.9rem;margin-bottom:20px">
        Acesse para acompanhar solicitações e conversar com profissionais.
      </p>

      <form class="painel" id="formEntrar">
        ${botaoGoogleHTML()}
        <div class="auth-divisor"><span>ou entre com seu e-mail</span></div>
        <div class="campo">
          <label class="campo-rotulo" for="lEmail">E-mail</label>
          <input class="entrada" type="email" id="lEmail" required autocomplete="email" />
        </div>
        <div class="campo">
          <label class="campo-rotulo" for="lSenha">Senha</label>
          <input class="entrada" type="password" id="lSenha" required autocomplete="current-password" />
        </div>
        <div id="erroEntrar"></div>
        <button class="btn btn-principal btn-cheio" type="submit">Entrar</button>
      </form>

      <p style="text-align:center;font-size:.88rem;color:var(--tinta-suave)">
        Ainda não tem conta?
        <button class="btn btn-fantasma btn-pequeno" data-ir="cadastro">Criar agora</button>
      </p>
    </div>`;

  ligarGoogle();
  document.getElementById('formEntrar').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const botao = evento.target.querySelector('button[type="submit"]');
    const erro = document.getElementById('erroEntrar');
    erro.innerHTML = '';
    botao.disabled = true;
    botao.textContent = 'Entrando...';

    try {
      const dados = await API.login(
        document.getElementById('lEmail').value,
        document.getElementById('lSenha').value
      );
      Sessao.gravar(dados.token, dados.usuario);
      atualizarTopo();
      avisarOk(`Bem-vindo de volta, ${dados.usuario.nome.split(' ')[0]}!`);

      if (dados.usuario.papel === 'admin') {
        location.href = '/admin.html';
        return;
      }
      const destino = voltarDepoisDoLogin || 'busca';
      voltarDepoisDoLogin = null;
      irPara(destino);
    } catch (falha) {
      erro.innerHTML = `<div class="faixa faixa-erro"><span class="faixa-icone">${iconeUI('alerta')}</span><div>${esc(falha.message)}</div></div>`;
      botao.disabled = false;
      botao.textContent = 'Entrar';
    }
  });
}

/* ════════════════════════════════════════════════════════════
   CADASTRO — cliente ou prestador
════════════════════════════════════════════════════════════ */

function TelaCadastro(googleCadastro = null) {
  if (Sessao.logado) return irPara('conta');

  let tipo = 'cliente';

  document.getElementById('tela').innerHTML = `
    <div class="envolve" style="max-width:560px;padding-top:26px">
      <h1 style="margin-bottom:6px">Criar conta</h1>
      <p style="color:var(--tinta-suave);font-size:.9rem">
        ${googleCadastro ? 'Conta Google confirmada! Complete seus dados para começar.' : 'Contrate serviços ou ofereça o seu trabalho para a sua região.'}
      </p>

      ${googleCadastro ? '' : botaoGoogleHTML() + '<div class="auth-divisor"><span>ou cadastre-se com e-mail</span></div>'}

      <div class="sub-abas" id="tipoConta">
        <button type="button" data-tipo="cliente" aria-pressed="true">Sou cliente</button>
        <button type="button" data-tipo="prestador" aria-pressed="false">Sou prestador</button>
      </div>

      <div id="formulario"></div>

      <p style="text-align:center;font-size:.88rem;color:var(--tinta-suave);padding-bottom:24px">
        Já tem conta?
        <button class="btn btn-fantasma btn-pequeno" data-ir="entrar">Entrar</button>
      </p>
    </div>`;

  if (!googleCadastro) ligarGoogle();
  const abas = document.getElementById('tipoConta');
  abas.addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-tipo]');
    if (!botao || botao.dataset.tipo === tipo) return;
    tipo = botao.dataset.tipo;
    abas.querySelectorAll('button').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.tipo === tipo))
    );
    desenharFormulario();
  });

  const camposComuns = `
    <div class="campo">
      <label class="campo-rotulo" for="cNome">Nome completo</label>
      <input class="entrada" id="cNome" required minlength="3" autocomplete="name" />
    </div>
    <div class="linha-campos">
      <div class="campo">
        <label class="campo-rotulo" for="cEmail">E-mail</label>
        <input class="entrada" type="email" id="cEmail" required autocomplete="email" />
      </div>
      <div class="campo">
        <label class="campo-rotulo" for="cTelefone">Telefone com DDD</label>
        <input class="entrada" type="tel" id="cTelefone" required placeholder="(11) 90000-0000" autocomplete="tel" />
      </div>
    </div>
    ${googleCadastro ? '' : `<div class="campo">
      <label class="campo-rotulo" for="cSenha">Senha</label>
      <input class="entrada" type="password" id="cSenha" required minlength="6" autocomplete="new-password" />
      <div class="campo-dica">Mínimo de 6 caracteres.</div>
    </div>`}`;

  function desenharFormulario() {
    const caixa = document.getElementById('formulario');

    caixa.innerHTML = tipo === 'cliente'
      ? `<form class="painel" id="formCadastro">
          ${camposComuns}
          <div class="campo auto-envolve">
            <label class="campo-rotulo" for="cCidade">Sua localização</label>
            <input class="entrada" id="cCidade" required placeholder="Cidade onde você mora" autocomplete="off" />
            <button type="button" class="localizar" id="btnLocal">Usar minha localização</button>
            <div class="campo-dica">Usamos para mostrar os profissionais mais próximos de você.</div>
          </div>
          <div id="erroCadastro"></div>
          <button class="btn btn-principal btn-cheio" type="submit">Criar conta de cliente</button>
        </form>`
      : `<div class="faixa faixa-atencao">
          <span class="faixa-icone">${iconeUI('escudo')}</span>
          <div><strong>Seu perfil passa por aprovação manual</strong>
          Depois de enviar, nossa equipe confere os dados. O selo de <em>perfil verificado</em> e a visibilidade nas buscas só aparecem depois da aprovação.</div>
        </div>

        <form class="painel" id="formCadastro">
          ${camposComuns}

          <div class="campo">
            <label class="campo-rotulo" for="cCategoria">Categoria do serviço</label>
            <select class="selecao" id="cCategoria" required><option value="">Selecione</option></select>
          </div>

          <div class="campo auto-envolve">
            <label class="campo-rotulo" for="cCidade">Área de atendimento</label>
            <input class="entrada" id="cCidade" required placeholder="Cidade base do atendimento" autocomplete="off" />
            <button type="button" class="localizar" id="btnLocal">Usar minha localização</button>
          </div>

          <div class="campo">
            <label class="campo-rotulo" for="cRaio">Atende até <strong id="valorRaio">20</strong> km de distância</label>
            <input type="range" id="cRaio" min="1" max="100" value="20" style="width:100%" />
          </div>

          <div class="linha-campos">
            <div class="campo">
              <label class="campo-rotulo" for="cPreco">Preço médio (R$)</label>
              <input class="entrada" type="number" id="cPreco" required min="1" step="0.01" placeholder="120" />
            </div>
            <div class="campo">
              <label class="campo-rotulo" for="cUnidade">Cobrado por</label>
              <select class="selecao" id="cUnidade">
                <option value="hora">Hora</option>
                <option value="diaria">Diária</option>
                <option value="servico" selected>Serviço</option>
                <option value="m2">Metro quadrado</option>
              </select>
            </div>
          </div>

          <div class="campo">
            <label class="campo-rotulo" for="cDescricao">Descrição do seu trabalho</label>
            <textarea class="area-texto" id="cDescricao" required minlength="30"
              placeholder="Conte sua experiência, o que você faz, o que está incluso e o que gera confiança no seu trabalho."></textarea>
            <div class="campo-dica"><span id="contadorDesc">0</span>/30 caracteres mínimos</div>
          </div>

          <div class="campo">
            <label class="campo-rotulo">Fotos do seu trabalho</label>
            <div class="solta-fotos" id="soltaFotos">
              <strong>Adicionar fotos</strong>
              Até 6 imagens, 4 MB cada. Perfis com foto recebem bem mais pedidos.
            </div>
            <input type="file" id="cFotos" accept="image/jpeg,image/png,image/webp" multiple hidden />
            <div class="grade-fotos" id="previaFotos"></div>
          </div>

          <div id="erroCadastro"></div>
          <button class="btn btn-principal btn-cheio" type="submit">Enviar para aprovação</button>
        </form>`;

    if (googleCadastro) {
      document.getElementById('cNome').value = googleCadastro.nome;
      document.getElementById('cEmail').value = googleCadastro.email;
      document.getElementById('cEmail').readOnly = true;
    }
    ligarAutocompleteCidade(document.getElementById('cCidade'));
    ligarBotaoLocalizacao();
    if (tipo === 'prestador') prepararCamposPrestador();
    ligarEnvio();
  }

  function ligarBotaoLocalizacao() {
    document.getElementById('btnLocal')?.addEventListener('click', async (evento) => {
      const botao = evento.currentTarget;
      botao.disabled = true;
      const original = botao.textContent;
      botao.textContent = 'Localizando...';
      try {
        const posicao = await pedirLocalizacao();
        const campo = document.getElementById('cCidade');
        campo.value = 'Minha localização atual';
        campo.dataset.lat = posicao.lat;
        campo.dataset.lng = posicao.lng;
        avisarOk('Localização detectada.');
      } catch (erro) {
        avisarErro(erro.message);
      } finally {
        botao.disabled = false;
        botao.textContent = original;
      }
    });
  }

  let arquivosEscolhidos = [];

  function prepararCamposPrestador() {
    API.categorias().then((categorias) => {
      document.getElementById('cCategoria').innerHTML =
        '<option value="">Selecione</option>' +
        categorias.map((c) => `<option value="${c.slug}">${esc(c.nome)}</option>`).join('');
      customizarCategorias(document.getElementById('cCategoria'), categorias.map(c => ({ ...c, label: c.nome })), 'Selecione uma categoria');
    }).catch(() => avisarErro('Não foi possível carregar as categorias.'));

    const raio = document.getElementById('cRaio');
    raio.addEventListener('input', () => {
      document.getElementById('valorRaio').textContent = raio.value;
    });

    const descricao = document.getElementById('cDescricao');
    descricao.addEventListener('input', () => {
      document.getElementById('contadorDesc').textContent = descricao.value.trim().length;
    });

    const entradaFotos = document.getElementById('cFotos');
    document.getElementById('soltaFotos').addEventListener('click', () => entradaFotos.click());

    entradaFotos.addEventListener('change', () => {
      const novos = [...entradaFotos.files];
      const grandes = novos.filter((a) => a.size > 4 * 1024 * 1024);
      if (grandes.length) {
        avisarErro(`${grandes.length} foto(s) passam de 4 MB e foram ignoradas.`);
      }
      arquivosEscolhidos = [...arquivosEscolhidos, ...novos.filter((a) => a.size <= 4 * 1024 * 1024)].slice(0, 6);
      entradaFotos.value = '';
      desenharPrevia();
    });
  }

  function desenharPrevia() {
    const caixa = document.getElementById('previaFotos');
    if (!caixa) return;
    caixa.innerHTML = arquivosEscolhidos
      .map((arquivo, i) => `
        <div class="foto-miniatura">
          <img src="${URL.createObjectURL(arquivo)}" alt="Prévia ${i + 1}" />
          <button type="button" class="foto-remover" data-i="${i}" aria-label="Remover foto">${iconeUI('fechar')}</button>
        </div>`)
      .join('');

    caixa.querySelectorAll('.foto-remover').forEach((botao) => {
      botao.addEventListener('click', () => {
        arquivosEscolhidos.splice(Number(botao.dataset.i), 1);
        desenharPrevia();
      });
    });
  }

  function ligarEnvio() {
    document.getElementById('formCadastro').addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const botao = evento.target.querySelector('button[type="submit"]');
      const erro = document.getElementById('erroCadastro');
      const rotuloOriginal = botao.textContent;
      erro.innerHTML = '';
      botao.disabled = true;
      botao.textContent = 'Enviando...';

      const cidade = document.getElementById('cCidade');
      const comuns = {
        nome: document.getElementById('cNome').value,
        email: document.getElementById('cEmail').value,
        ...(googleCadastro ? { googleCadastro: true } : { senha: document.getElementById('cSenha').value }),
        telefone: document.getElementById('cTelefone').value,
        cidade: cidade.value,
        lat: cidade.dataset.lat || '',
        lng: cidade.dataset.lng || '',
      };

      try {
        let resposta;

        if (tipo === 'cliente') {
          resposta = await API.cadastrarCliente(comuns);
        } else {
          const form = new FormData();
          Object.entries(comuns).forEach(([chave, valor]) => form.set(chave, valor));
          form.set('categoria', document.getElementById('cCategoria').value);
          form.set('raioKm', document.getElementById('cRaio').value);
          form.set('precoMedio', document.getElementById('cPreco').value);
          form.set('unidadePreco', document.getElementById('cUnidade').value);
          form.set('descricao', document.getElementById('cDescricao').value);
          arquivosEscolhidos.forEach((arquivo) => form.append('fotos', arquivo));
          resposta = await API.cadastrarPrestador(form);
        }

        Sessao.gravar(resposta.token, resposta.usuario);
        atualizarTopo();

        if (tipo === 'prestador') {
          avisarOk('Cadastro enviado para aprovação!');
          irPara('conta');
        } else {
          avisarOk(`Conta criada. Bem-vindo, ${resposta.usuario.nome.split(' ')[0]}!`);
          irPara(googleCadastro ? destinoGoogle() : 'busca');
        }
      } catch (falha) {
        erro.innerHTML = `<div class="faixa faixa-erro"><span class="faixa-icone">${iconeUI('alerta')}</span><div>${esc(falha.message)}</div></div>`;
        erro.scrollIntoView({ behavior: 'smooth', block: 'center' });
        botao.disabled = false;
        botao.textContent = rotuloOriginal;
      }
    });
  }

  desenharFormulario();
}

/* ════════════════════════════════════════════════════════════
   MINHA CONTA
════════════════════════════════════════════════════════════ */

async function TelaConta() {
  const versao = versaoTela;
  if (!Sessao.logado) return TelaEntrar();

  const tela = document.getElementById('tela');
  tela.innerHTML = `<div class="envolve" style="max-width:640px;padding-top:24px">${esqueletos(1)}</div>`;

  let eu;
  try {
    eu = await API.eu();
    if (versao !== versaoTela) return;
  } catch (erro) {
    return avisarErro(erro.message);
  }

  if (eu.papel === 'admin') { location.href = '/admin.html'; return; }

  const sair = `
    <button class="btn btn-contorno btn-cheio" id="btnSair" style="margin-top:8px">Sair da conta</button>`;

  if (eu.papel === 'prestador') {
    await painelPrestador(eu, sair);
  } else {
    await painelCliente(eu, sair);
  }

  document.getElementById('btnSair')?.addEventListener('click', () => {
    Sessao.limpar();
    atualizarTopo();
    avisar('Você saiu da conta.');
    irPara('busca');
  });
}

async function painelCliente(eu, sair) {
  const versao = versaoTela;
  let dados = null;
  try { dados = await API.meuCliente(); } catch { /* segue com o básico */ }
  if (versao !== versaoTela) return;

  document.getElementById('tela').innerHTML = `
    <div class="envolve" style="max-width:640px;padding:24px 16px 30px">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:22px">
        <div class="avatar" style="width:56px;height:56px;font-size:1.1rem">${esc(iniciais(eu.nome))}</div>
        <div>
          <h1 style="font-size:1.3rem">${esc(eu.nome)}</h1>
          <div style="color:var(--tinta-fraca);font-size:.86rem">${esc(eu.email)}</div>
        </div>
      </div>

      ${dados?.historico?.aguardandoAvaliacao ? `
        <div class="faixa faixa-atencao">
          <span class="faixa-icone">${iconeUI('estrela')}</span>
          <div><strong>${dados.historico.aguardandoAvaliacao} serviço(s) esperando sua avaliação</strong>
          Sua nota ajuda outras pessoas a escolher com segurança.</div>
        </div>` : ''}

      <div class="painel">
        <h3>Seu histórico</h3>
        <p class="painel-desc">Resumo das solicitações que você já fez.</p>
        <div class="faixa-confianca">
          <div class="confianca-item">
            <span class="confianca-valor">${dados?.historico?.total ?? 0}</span>
            <span class="confianca-rotulo">Solicitações</span>
          </div>
          <div class="confianca-item">
            <span class="confianca-valor">${dados?.historico?.concluidas ?? 0}</span>
            <span class="confianca-rotulo">Concluídas</span>
          </div>
          <div class="confianca-item">
            <span class="confianca-valor">${dados?.historico?.avaliacoesFeitas ?? 0}</span>
            <span class="confianca-rotulo">Avaliações</span>
          </div>
        </div>
        <button class="btn btn-contorno btn-cheio" data-ir="solicitacoes" style="margin-top:14px">
          Ver todas as solicitações
        </button>
      </div>

      <div class="painel">
        <h3>Sua localização</h3>
        <p class="painel-desc">Define quais profissionais aparecem primeiro na busca.</p>
        <div class="campo auto-envolve">
          <input class="entrada" id="novaCidade" value="${esc(dados?.localizacao?.rotulo || '')}" autocomplete="off" />
        </div>
        <button class="btn btn-principal btn-cheio" id="btnSalvarLocal">Salvar localização</button>
      </div>

      <div class="painel">
        <h3>Dados da conta</h3>
        <div class="dados" style="margin-top:12px">
          <div class="dado"><span class="dado-rotulo">Nome</span><span class="dado-valor">${esc(eu.nome)}</span></div>
          <div class="dado"><span class="dado-rotulo">E-mail</span><span class="dado-valor">${esc(eu.email)}</span></div>
          <div class="dado"><span class="dado-rotulo">Telefone</span><span class="dado-valor">${esc(eu.telefone || '—')}</span></div>
          <div class="dado"><span class="dado-rotulo">Membro desde</span><span class="dado-valor">${dataCurta(dados?.membroDesde)}</span></div>
        </div>
        ${sair}
      </div>
    </div>`;

  const campo = document.getElementById('novaCidade');
  ligarAutocompleteCidade(campo);

  document.getElementById('btnSalvarLocal').addEventListener('click', async (evento) => {
    const botao = evento.currentTarget;
    botao.disabled = true;
    try {
      const resposta = await API.trocarLocalizacao({
        cidade: campo.value,
        lat: campo.dataset.lat,
        lng: campo.dataset.lng,
      });
      LocalSalvo.gravar({
        rotulo: resposta.localizacao.rotulo,
        lat: resposta.localizacao.lat,
        lng: resposta.localizacao.lng,
      });
      avisarOk('Localização atualizada.');
    } catch (erro) {
      avisarErro(erro.message);
    } finally {
      botao.disabled = false;
    }
  });
}

async function painelPrestador(eu, sair) {
  const versao = versaoTela;
  let perfil = null;
  try { perfil = await API.meuPerfilPrestador(); } catch { /* pode não existir */ }
  if (versao !== versaoTela) return;

  const status = perfil?.status || eu.prestador?.status || 'pendente';

  const faixas = {
    pendente: `<div class="faixa faixa-atencao">
      <span class="faixa-icone">${iconeUI('relogio')}</span>
      <div><strong>Seu perfil está em verificação</strong>
      Enviamos seus dados para a equipe pelo WhatsApp. Enquanto a aprovação não sai, seu perfil não aparece nas buscas e o selo fica bloqueado.</div></div>`,
    aprovado: `<div class="faixa faixa-sucesso">
      <span class="faixa-icone">${iconeUI('escudo')}</span>
      <div><strong>Perfil verificado e no ar</strong>
      Você já aparece nas buscas da sua região com o selo de verificado.</div></div>`,
    rejeitado: `<div class="faixa faixa-erro">
      <span class="faixa-icone">${iconeUI('fechar')}</span>
      <div><strong>Cadastro rejeitado</strong>
      ${esc(perfil?.motivoRejeicao || 'Entre em contato com a equipe para entender o motivo.')}</div></div>`,
    suspenso: `<div class="faixa faixa-erro">
      <span class="faixa-icone">${iconeUI('pausa')}</span>
      <div><strong>Perfil suspenso</strong>
      ${esc(perfil?.motivoRejeicao || 'Seu perfil foi retirado das buscas.')}</div></div>`,
  };

  document.getElementById('tela').innerHTML = `
    <div class="envolve" style="max-width:640px;padding:24px 16px 30px">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
        <div class="avatar" style="width:56px;height:56px;font-size:1.1rem">${esc(iniciais(eu.nome))}</div>
        <div>
          <h1 style="font-size:1.3rem">${esc(eu.nome)}</h1>
          <div style="margin-top:4px">${seloStatus(status)}</div>
        </div>
      </div>

      ${faixas[status] || ''}

      <div class="painel">
        <h3>Sua reputação</h3>
        <p class="painel-desc">O que os clientes veem no topo do seu perfil.</p>
        <div class="faixa-confianca">
          <div class="confianca-item">
            <span class="confianca-valor">${perfil?.notaMedia ? perfil.notaMedia.toFixed(1).replace('.', ',') : '—'}</span>
            <span class="confianca-rotulo">Nota média</span>
          </div>
          <div class="confianca-item">
            <span class="confianca-valor">${perfil?.totalAvaliacoes ?? 0}</span>
            <span class="confianca-rotulo">Avaliações</span>
          </div>
          <div class="confianca-item">
            <span class="confianca-valor">${perfil?.fotos?.length ?? 0}/6</span>
            <span class="confianca-rotulo">Fotos</span>
          </div>
        </div>
        ${status === 'aprovado'
          ? `<button class="btn btn-contorno btn-cheio" style="margin-top:14px" data-perfil="${perfil?.id}">Ver meu perfil público</button>`
          : ''}
      </div>

      <div class="painel">
        <h3>Fotos do trabalho</h3>
        <p class="painel-desc">A primeira foto é a capa do seu cartão na busca. Capriche.</p>
        <div class="grade-fotos" id="minhasFotos">
          ${(perfil?.fotos || []).map((f) => `
            <div class="foto-miniatura">
              <img src="${esc(f)}" alt="" />
              <button class="foto-remover" data-remover="${esc(f)}" aria-label="Remover">${iconeUI('fechar')}</button>
            </div>`).join('')}
        </div>
        ${(perfil?.fotos?.length || 0) < 6 ? `
          <div class="solta-fotos" id="soltaMinhasFotos" style="margin-top:10px">
            <strong>Adicionar fotos</strong>
            Até ${6 - (perfil?.fotos?.length || 0)} imagem(ns), 4 MB cada.
          </div>
          <input type="file" id="novasFotos" accept="image/jpeg,image/png,image/webp" multiple hidden />` : ''}
      </div>

      <div class="painel">
        <h3>Dados do serviço</h3>
        <p class="painel-desc">Alterações entram no ar na hora.</p>
        <form id="formPerfil">
          <div class="campo">
            <label class="campo-rotulo" for="pDescricao">Descrição</label>
            <textarea class="area-texto" id="pDescricao" minlength="30">${esc(perfil?.descricao || '')}</textarea>
          </div>
          <div class="linha-campos">
            <div class="campo">
              <label class="campo-rotulo" for="pPreco">Preço médio (R$)</label>
              <input class="entrada" type="number" id="pPreco" min="1" step="0.01" value="${perfil?.precoMedio ?? ''}" />
            </div>
            <div class="campo">
              <label class="campo-rotulo" for="pUnidade">Cobrado por</label>
              <select class="selecao" id="pUnidade">
                ${['hora', 'diaria', 'servico', 'm2'].map((u) =>
                  `<option value="${u}" ${perfil?.unidadePreco === u ? 'selected' : ''}>${
                    { hora: 'Hora', diaria: 'Diária', servico: 'Serviço', m2: 'Metro quadrado' }[u]
                  }</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="campo">
            <label class="campo-rotulo" for="pRaio">Atende até <strong id="pValorRaio">${perfil?.areaAtendimento?.raioKm ?? 20}</strong> km</label>
            <input type="range" id="pRaio" min="1" max="100" value="${perfil?.areaAtendimento?.raioKm ?? 20}" style="width:100%" />
          </div>
          <button class="btn btn-principal btn-cheio" type="submit">Salvar alterações</button>
        </form>
      </div>

      <div class="painel">
        <h3>Dados da conta</h3>
        <div class="dados" style="margin-top:12px">
          <div class="dado"><span class="dado-rotulo">E-mail</span><span class="dado-valor">${esc(eu.email)}</span></div>
          <div class="dado"><span class="dado-rotulo">Telefone</span><span class="dado-valor">${esc(eu.telefone || '—')}</span></div>
          <div class="dado"><span class="dado-rotulo">Área</span><span class="dado-valor">${esc(perfil?.areaAtendimento?.rotulo || '—')}</span></div>
          <div class="dado"><span class="dado-rotulo">Categoria</span><span class="dado-valor">${esc(perfil?.categoriaNome || '—')}</span></div>
        </div>
        ${sair}
      </div>
    </div>`;

  const raio = document.getElementById('pRaio');
  raio?.addEventListener('input', () => {
    document.getElementById('pValorRaio').textContent = raio.value;
  });

  document.getElementById('formPerfil')?.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const botao = evento.target.querySelector('button');
    botao.disabled = true;
    botao.textContent = 'Salvando...';
    try {
      await API.editarPerfilPrestador({
        descricao: document.getElementById('pDescricao').value,
        precoMedio: document.getElementById('pPreco').value,
        unidadePreco: document.getElementById('pUnidade').value,
        raioKm: raio.value,
      });
      avisarOk('Perfil atualizado.');
    } catch (erro) {
      avisarErro(erro.message);
    } finally {
      botao.disabled = false;
      botao.textContent = 'Salvar alterações';
    }
  });

  const entrada = document.getElementById('novasFotos');
  document.getElementById('soltaMinhasFotos')?.addEventListener('click', () => entrada.click());
  entrada?.addEventListener('change', async () => {
    if (!entrada.files.length) return;
    const form = new FormData();
    [...entrada.files].forEach((arquivo) => form.append('fotos', arquivo));
    try {
      await API.enviarFotos(form);
      avisarOk('Fotos adicionadas.');
      TelaConta();
    } catch (erro) {
      avisarErro(erro.message);
    }
    entrada.value = '';
  });

  document.getElementById('minhasFotos')?.addEventListener('click', async (evento) => {
    const botao = evento.target.closest('[data-remover]');
    if (!botao) return;
    botao.disabled = true;
    try {
      await API.removerFoto(botao.dataset.remover);
      botao.closest('.foto-miniatura').remove();
      avisarOk('Foto removida.');
    } catch (erro) {
      avisarErro(erro.message);
      botao.disabled = false;
    }
  });
}

/* ════════════════════════════════════════════════════════════
   BADGE DE MENSAGENS NÃO LIDAS
════════════════════════════════════════════════════════════ */

async function atualizarBadge() {
  const selo = document.getElementById('badgeChat');
  if (!Sessao.logado) return selo.classList.add('oculto');
  try {
    const { total } = await API.naoLidas();
    selo.textContent = total > 9 ? '9+' : total;
    selo.classList.toggle('oculto', !total);
  } catch {
    selo.classList.add('oculto');
  }
}

/* ── Início ─────────────────────────────────────────────── */

atualizarTopo();
desenhar();
atualizarBadge();
setInterval(atualizarBadge, 20000);
