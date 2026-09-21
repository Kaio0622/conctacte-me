// Uma foto por mensagem. URLs temporárias e câmera são liberadas ao sair da conversa.
function criarFotosChat(formulario, aoMudar) {
  let arquivo = null;
  let previaUrl = null;
  let ativo = true;
  let bloqueado = false;
  let fluxo = null;
  let dialogo = null;
  const controle = new AbortController();
  const imagens = new Map();
  const previa = formulario.querySelector('.chat-foto-previa');
  const galeria = formulario.querySelector('#fotoGaleria');
  const camera = formulario.querySelector('#fotoCamera');

  function limpar() {
    if (previaUrl) URL.revokeObjectURL(previaUrl);
    previaUrl = null;
    arquivo = null;
    previa.replaceChildren();
    previa.hidden = true;
    aoMudar();
  }
  async function selecionar(foto) {
    if (!foto || bloqueado || !ativo) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(foto.type)) return avisarErro('Escolha uma foto JPG, PNG ou WebP.');
    if (foto.size > 4 * 1024 * 1024) return avisarErro('A foto pode ter no máximo 4 MB.');
    const url = URL.createObjectURL(foto);
    const img = new Image();
    img.src = url;
    try { await img.decode(); }
    catch { URL.revokeObjectURL(url); return avisarErro('Não foi possível abrir essa imagem. Escolha outra foto.'); }
    if (!ativo || bloqueado) { URL.revokeObjectURL(url); return; }
    limpar();
    arquivo = foto;
    previaUrl = url;
    img.alt = 'Prévia da foto que será enviada';
    const legenda = document.createElement('span');
    legenda.textContent = 'Foto pronta. Adicione uma legenda se quiser.';
    const remover = document.createElement('button');
    remover.type = 'button'; remover.className = 'btn btn-fantasma btn-pequeno';
    remover.textContent = 'Remover'; remover.addEventListener('click', limpar);
    previa.append(img, legenda, remover);
    previa.hidden = false;
    aoMudar();
  }
  for (const input of [galeria, camera]) input.addEventListener('change', () => {
    selecionar(input.files[0]); input.value = '';
  });
  formulario.querySelector('#abrirGaleria').addEventListener('click', () => galeria.click());

  function fecharCamera() {
    fluxo?.getTracks().forEach(track => track.stop());
    fluxo = null;
    dialogo?.close(); dialogo?.remove(); dialogo = null;
  }
  formulario.querySelector('#abrirCamera').addEventListener('click', async () => {
    if (bloqueado) return;
    // O seletor nativo com capture abre a câmera em celulares compatíveis.
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) { camera.click(); return; }
    if (!navigator.mediaDevices?.getUserMedia) {
      avisarErro('A câmera precisa de HTTPS ou localhost. Você também pode escolher uma foto da galeria.');
      return;
    }
    fecharCamera();
    const janela = document.createElement('dialog');
    dialogo = janela;
    janela.className = 'chat-foto-dialog';
    janela.innerHTML = `<h2>Tirar uma foto</h2><p role="status">Aguardando permissão da câmera…</p><video autoplay playsinline muted></video>
      <div class="chat-foto-acoes"><button class="btn btn-contorno" type="button" data-fechar>Cancelar</button><button class="btn btn-principal" type="button" data-capturar disabled>Tirar foto</button></div>`;
    document.body.append(janela);
    janela.showModal();
    janela.addEventListener('cancel', evento => { evento.preventDefault(); fecharCamera(); });
    janela.querySelector('[data-fechar]').addEventListener('click', fecharCamera);
    const video = janela.querySelector('video');
    const capturar = janela.querySelector('[data-capturar]');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 } }, audio: false });
      if (!ativo || dialogo !== janela || bloqueado) { stream.getTracks().forEach(t => t.stop()); return; }
      fluxo = stream;
      video.srcObject = stream;
      await video.play();
      if (dialogo !== janela) return;
      janela.querySelector('p').textContent = 'Enquadre a imagem e tire a foto.';
      capturar.disabled = false;
    } catch {
      if (dialogo === janela) { fecharCamera(); avisarErro('Não foi possível acessar a câmera. Confira a permissão ou use a galeria.'); }
    }
    capturar.addEventListener('click', () => {
      if (!video.videoWidth || !video.videoHeight) return;
      capturar.disabled = true;
      const canvas = document.createElement('canvas');
      const escala = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * escala); canvas.height = Math.round(video.videoHeight * escala);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (blob && ativo && dialogo === janela) selecionar(new File([blob], 'foto-camera.jpg', { type: 'image/jpeg' }));
        if (dialogo === janela) fecharCamera();
      }, 'image/jpeg', .85);
    });
  });

  function ampliar(url) {
    fecharCamera();
    const janela = document.createElement('dialog');
    dialogo = janela;
    janela.className = 'chat-foto-dialog';
    const img = new Image(); img.src = url; img.alt = 'Foto da conversa ampliada';
    const fechar = document.createElement('button'); fechar.type = 'button'; fechar.className = 'btn btn-contorno'; fechar.textContent = 'Fechar';
    fechar.addEventListener('click', fecharCamera);
    janela.addEventListener('cancel', e => { e.preventDefault(); fecharCamera(); });
    janela.append(img, fechar); document.body.append(janela); janela.showModal();
  }
  function desenharImagem(mensagem, balao, aoCarregar) {
    const botao = document.createElement('button');
    botao.type = 'button'; botao.className = 'chat-foto-mensagem'; botao.textContent = 'Carregando foto…';
    balao.prepend(botao);
    async function carregar() {
      botao.disabled = true;
      try {
        if (!imagens.has(mensagem.id)) imagens.set(mensagem.id, (async () => {
          // Caminho montado pelo cliente: tokens nunca são enviados a URLs externas.
          const url = `/api/chat/${encodeURIComponent(mensagem.solicitacaoId)}/mensagens/${encodeURIComponent(mensagem.id)}/imagem`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${Sessao.token}` }, signal: controle.signal, cache: 'no-store' });
          if (!res.ok) throw new Error('Foto indisponível');
          const blob = await res.blob();
          if (!ativo) throw new Error('Conversa fechada');
          return URL.createObjectURL(blob);
        })());
        const url = await imagens.get(mensagem.id);
        if (!ativo || !botao.isConnected) return;
        const img = new Image(); img.alt = 'Foto enviada na conversa. Clique para ampliar.';
        img.onload = aoCarregar;
        img.src = url;
        botao.replaceChildren(img); botao.disabled = false;
        botao.onclick = () => ampliar(url);
      } catch {
        imagens.delete(mensagem.id);
        if (!ativo) return;
        botao.textContent = 'Foto indisponível. Tentar novamente'; botao.disabled = false;
        botao.onclick = carregar;
      }
    }
    carregar();
  }
  return {
    get arquivo() { return arquivo; }, limpar, desenharImagem,
    bloquear(valor) {
      bloqueado = valor;
      formulario.querySelectorAll('.chat-anexar, .chat-foto-previa button').forEach(b => { b.disabled = valor; });
      if (valor) fecharCamera();
    },
    destruir() {
      ativo = false; controle.abort(); fecharCamera(); limpar();
      for (const promessa of imagens.values()) promessa.then(url => URL.revokeObjectURL(url)).catch(() => {});
      imagens.clear();
    },
  };
}
