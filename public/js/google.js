function botaoGoogleHTML() {
  return `<div class="auth-google">
    <button class="btn-google" type="button" id="entrarGoogle" disabled aria-describedby="estadoGoogle">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.23c1.89-1.74 2.98-4.3 2.98-7.36Z"/>
        <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.23-2.51c-.89.6-2.03.97-3.39.97-2.61 0-4.83-1.76-5.62-4.13H3.04v2.59A10 10 0 0 0 12 22Z"/>
        <path fill="#FBBC05" d="M6.38 13.92a6 6 0 0 1 0-3.84V7.49H3.04a10 10 0 0 0 0 9.02l3.34-2.59Z"/>
        <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.82 1.5l2.87-2.87A9.61 9.61 0 0 0 12 2a10 10 0 0 0-8.96 5.49l3.34 2.59C7.17 7.71 9.39 5.95 12 5.95Z"/>
      </svg><span>Entrar com Google</span>
    </button>
    <p class="auth-google-estado" id="estadoGoogle" role="status">Verificando disponibilidade…</p>
  </div>`;
}

function ligarGoogle() {
  const botao = document.getElementById('entrarGoogle');
  const estado = document.getElementById('estadoGoogle');
  if (!botao) return;
  API.googleStatus().then(dados => {
    if (!botao.isConnected) return;
    botao.disabled = !dados.disponivel;
    estado.textContent = dados.disponivel ? 'Rápido, seguro e sem criar outra senha.' : 'Login com Google estará disponível em breve. Use e-mail e senha.';
  }).catch(() => {
    if (botao.isConnected) estado.textContent = 'Google indisponível no momento. Use e-mail e senha.';
  });
  botao.addEventListener('click', () => {
    try { sessionStorage.setItem('contactme.google.voltar', voltarDepoisDoLogin || 'busca'); } catch {}
    botao.disabled = true;
    estado.textContent = 'Abrindo o Google…';
    location.assign('/api/auth/google/iniciar');
  });
}

function destinoGoogle() {
  let destino;
  try {
    destino = sessionStorage.getItem('contactme.google.voltar');
    sessionStorage.removeItem('contactme.google.voltar');
  } catch {}
  voltarDepoisDoLogin = null;
  return /^(busca|conta|solicitacoes|(?:prestador|chat)\/[\w-]+)$/.test(destino || '') ? destino : 'busca';
}

function finalizarGoogle(dados) {
  Sessao.gravar(dados.token, dados.usuario);
  atualizarTopo();
  avisarOk(`Bem-vindo, ${dados.usuario.nome.split(' ')[0]}!`);
  irPara(destinoGoogle());
}

async function TelaGoogle() {
  const versao = versaoTela;
  const tela = document.getElementById('tela');
  tela.innerHTML = '<div class="envolve auth-retorno"><div class="painel"><h1>Entrando com Google</h1><p role="status">Confirmando sua conta…</p></div></div>';
  try {
    const dados = await API.googleResultado();
    if (versao !== versaoTela) return;
    if (dados.token) return finalizarGoogle(dados);
    if (dados.cadastroGoogle) return TelaCadastro(dados.cadastroGoogle);
    if (!dados.vincular) throw new Error('Não foi possível confirmar seu login. Tente novamente.');
    tela.innerHTML = `<div class="envolve auth-retorno">
      <h1>Vincular sua conta Google</h1>
      <p>Você já tem uma conta com <strong>${esc(dados.email)}</strong>. Confirme sua senha do Contact Me uma vez para manter seu perfil e suas conversas.</p>
      <form class="painel" id="formVincularGoogle">
        <div class="campo"><label class="campo-rotulo" for="senhaVincular">Senha do Contact Me</label>
          <input class="entrada" type="password" id="senhaVincular" autocomplete="current-password" required maxlength="1024" /></div>
        <div id="erroVincularGoogle" role="alert"></div>
        <button class="btn btn-principal btn-cheio" type="submit">Vincular e entrar</button>
      </form><button class="btn btn-fantasma btn-cheio" data-ir="entrar">Voltar ao login</button></div>`;
    document.getElementById('formVincularGoogle').addEventListener('submit', async evento => {
      evento.preventDefault();
      const botao = evento.target.querySelector('button');
      const erro = document.getElementById('erroVincularGoogle');
      erro.textContent = '';
      botao.disabled = true;
      try {
        const sessao = await API.googleVincular(document.getElementById('senhaVincular').value);
        if (versao === versaoTela) finalizarGoogle(sessao);
      } catch (falha) {
        if (versao !== versaoTela) return;
        erro.innerHTML = `<div class="faixa faixa-erro">${esc(falha.message)}</div>`;
        botao.disabled = false;
      }
    });
  } catch (erro) {
    if (versao !== versaoTela) return;
    tela.innerHTML = `<div class="envolve auth-retorno"><h1>Não foi possível entrar</h1>
      <div class="faixa faixa-erro" role="alert">${esc(erro.message)}</div>
      ${botaoGoogleHTML()}<button class="btn btn-fantasma btn-cheio" data-ir="entrar">Usar e-mail e senha</button></div>`;
    ligarGoogle();
  }
}
