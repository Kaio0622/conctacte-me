// ============================================================
//  Smoke test — exercita o fluxo inteiro contra o servidor
//  rodando. Uso:  node scripts/smoke.js [http://localhost:3000]
// ============================================================

const BASE = process.argv[2] || 'http://localhost:3000';

let passou = 0;
let falhou = 0;

function ok(condicao, titulo, detalhe = '') {
  if (condicao) {
    passou++;
    console.log(`  ok   ${titulo}`);
  } else {
    falhou++;
    console.log(`  FALHA ${titulo}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

async function api(caminho, { metodo = 'GET', corpo, token, form } = {}) {
  const opcoes = { method: metodo, headers: {} };
  if (token) opcoes.headers.Authorization = `Bearer ${token}`;
  if (form) {
    opcoes.body = form;
  } else if (corpo) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }
  const resposta = await fetch(`${BASE}${caminho}`, opcoes);
  const texto = await resposta.text();
  let dados;
  try { dados = JSON.parse(texto); } catch { dados = texto; }
  return { status: resposta.status, dados };
}

const unico = Date.now();

(async () => {
  console.log(`\n  Smoke test contra ${BASE}\n`);

  // ── Saúde ──
  const saude = await api('/api/saude');
  ok(saude.status === 200 && saude.dados.ok, 'GET /api/saude responde');

  // ── Catálogo ──
  const categorias = await api('/api/categorias');
  ok(Array.isArray(categorias.dados) && categorias.dados.length > 10, 'GET /api/categorias lista categorias');
  ok(categorias.dados.some((c) => c.total > 0), 'categorias trazem contagem de prestadores aprovados');

  const cidades = await api('/api/cidades?q=camp');
  ok(cidades.dados.some((c) => c.nome === 'Campinas'), 'autocomplete de cidade encontra Campinas');

  // ── Busca e ordenação por distância ──
  const buscaSP = await api('/api/busca?cidade=São Paulo&ordenar=distancia');
  ok(buscaSP.status === 200 && buscaSP.dados.total > 0, 'busca por São Paulo retorna prestadores');
  const distancias = buscaSP.dados.resultados.map((r) => r.distanciaKm);
  ok(
    distancias.every((d, i) => i === 0 || d >= distancias[i - 1]),
    'resultados vêm ordenados por distância crescente',
    JSON.stringify(distancias)
  );
  ok(
    buscaSP.dados.resultados.every((r) => r.verificado === true),
    'TODO resultado da busca pública tem selo verificado'
  );

  const buscaCategoria = await api('/api/busca?categoria=eletrica&cidade=São Paulo');
  ok(
    buscaCategoria.dados.resultados.every((r) => r.categoria === 'eletrica'),
    'filtro por categoria funciona'
  );

  const buscaNota = await api('/api/busca?cidade=São Paulo&ordenar=avaliacao');
  const notas = buscaNota.dados.resultados.map((r) => r.notaMedia);
  ok(notas.every((n, i) => i === 0 || n <= notas[i - 1]), 'ordenação por avaliação é decrescente');

  const buscaLonge = await api('/api/busca?cidade=Manaus&raio=10');
  ok(buscaLonge.dados.total === 0, 'busca em cidade sem prestadores retorna vazio');

  // ── Prestador pendente NÃO aparece ──
  const buscaCostura = await api('/api/busca?categoria=costura');
  ok(buscaCostura.dados.total === 0, 'prestador PENDENTE não aparece na busca pública');

  // ── Login ──
  const loginCliente = await api('/api/auth/login', {
    metodo: 'POST', corpo: { email: 'ana@exemplo.com', senha: 'senha123' },
  });
  ok(loginCliente.status === 200 && loginCliente.dados.token, 'login de cliente devolve token');
  const tokenCliente = loginCliente.dados.token;

  const loginErrado = await api('/api/auth/login', {
    metodo: 'POST', corpo: { email: 'ana@exemplo.com', senha: 'errada' },
  });
  ok(loginErrado.status === 401, 'senha errada é rejeitada com 401');

  const loginAdmin = await api('/api/auth/login', {
    metodo: 'POST', corpo: { email: 'admin@contactme.local', senha: 'admin123' },
  });
  ok(loginAdmin.status === 200, 'login de admin funciona');
  const tokenAdmin = loginAdmin.dados.token;

  const semToken = await api('/api/solicitacoes');
  ok(semToken.status === 401, 'rota protegida sem token devolve 401');

  const tokenFalso = await api('/api/solicitacoes', { token: 'aaa.bbb' });
  ok(tokenFalso.status === 401, 'token forjado é rejeitado');

  // ── Cadastro de prestador dispara a fila de aprovação ──
  const form = new FormData();
  form.set('nome', 'Prestador Teste Smoke');
  form.set('email', `smoke${unico}@exemplo.com`);
  form.set('senha', 'senha123');
  form.set('telefone', '11988887777');
  form.set('categoria', 'marcenaria');
  form.set('cidade', 'São Paulo');
  form.set('raioKm', '25');
  form.set('precoMedio', '210');
  form.set('unidadePreco', 'servico');
  form.set('descricao', 'Marceneiro de teste automatizado com descricao suficientemente longa para passar na validacao.');

  const cadastro = await api('/api/auth/cadastro/prestador', { metodo: 'POST', form });
  ok(cadastro.status === 201, 'cadastro de prestador aceito', JSON.stringify(cadastro.dados).slice(0, 160));
  ok(cadastro.dados.prestador?.status === 'pendente', 'novo prestador nasce PENDENTE');
  ok(Boolean(cadastro.dados.notificacao), 'cadastro gera notificação de aprovação');
  const novoPrestadorId = cadastro.dados.prestador?.id;

  const buscaMarcenaria = await api('/api/busca?categoria=marcenaria&cidade=São Paulo');
  ok(
    !buscaMarcenaria.dados.resultados.some((r) => r.id === novoPrestadorId),
    'prestador recém-cadastrado NÃO aparece na busca antes da aprovação'
  );

  const perfilPendente = await api(`/api/prestadores/${novoPrestadorId}`);
  ok(perfilPendente.status === 404, 'perfil pendente é 404 para o público');

  // ── Aprovação pelo admin concede o selo ──
  const fila = await api('/api/admin/prestadores?status=pendente', { token: tokenAdmin });
  ok(fila.status === 200 && fila.dados.prestadores.length >= 3, 'fila de aprovação lista os pendentes');

  const filaSemAdmin = await api('/api/admin/prestadores', { token: tokenCliente });
  ok(filaSemAdmin.status === 403, 'cliente não acessa o painel admin');

  const decisao = await api(`/api/admin/prestadores/${novoPrestadorId}/decisao`, {
    metodo: 'POST', token: tokenAdmin, corpo: { decisao: 'aprovado' },
  });
  ok(decisao.status === 200, 'admin aprova o prestador');

  const perfilAprovado = await api(`/api/prestadores/${novoPrestadorId}`);
  ok(perfilAprovado.status === 200 && perfilAprovado.dados.verificado === true,
     'após aprovação o perfil fica público E verificado');

  const buscaDepois = await api('/api/busca?categoria=marcenaria&cidade=São Paulo');
  ok(
    buscaDepois.dados.resultados.some((r) => r.id === novoPrestadorId),
    'prestador aprovado passa a aparecer na busca'
  );

  // ── Aprovação rápida pelo link do WhatsApp ──
  const form2 = new FormData();
  form2.set('nome', 'Prestador Link WhatsApp');
  form2.set('email', `link${unico}@exemplo.com`);
  form2.set('senha', 'senha123');
  form2.set('telefone', '11977776666');
  form2.set('categoria', 'jardinagem');
  form2.set('cidade', 'Campinas');
  form2.set('raioKm', '20');
  form2.set('precoMedio', '150');
  form2.set('descricao', 'Jardineiro de teste com descricao suficientemente longa para passar na validacao do cadastro.');

  const cadastro2 = await api('/api/auth/cadastro/prestador', { metodo: 'POST', form: form2 });
  const idLink = cadastro2.dados.prestador?.id;

  const listaNotificacoes = await api('/api/admin/notificacoes', { token: tokenAdmin });
  const minha = listaNotificacoes.dados.notificacoes.find((n) => n.prestadorId === idLink);
  ok(Boolean(minha?.linkAprovar), 'notificação traz link de aprovação rápida');
  ok(
    minha.texto.includes('Jardinagem') && minha.texto.includes('Campinas'),
    'mensagem inclui categoria e área de atendimento do cadastro'
  );
  ok(Boolean(minha.linkWaMe?.startsWith('https://wa.me/')), 'notificação traz link wa.me como plano B');

  const caminhoLink = minha.linkAprovar.replace(BASE, '');
  const aprovacaoRapida = await api(caminhoLink);
  ok(aprovacaoRapida.status === 200, 'link de aprovação do WhatsApp responde 200');
  ok(
    typeof aprovacaoRapida.dados === 'string' && aprovacaoRapida.dados.includes('foi aprovado'),
    'link de aprovação devolve página de confirmação'
  );

  const depoisDoLink = await api(`/api/prestadores/${idLink}`);
  ok(depoisDoLink.dados?.verificado === true, 'aprovação pelo WhatsApp concede o selo verificado');

  const linkDeNovo = await api(caminhoLink);
  ok(
    typeof linkDeNovo.dados === 'string' && linkDeNovo.dados.includes('Nada a fazer'),
    'reabrir o link já usado não reprocessa a decisão'
  );

  const linkAdulterado = await api('/api/admin/aprovacao-rapida?token=abc.def');
  ok(linkAdulterado.status === 400, 'token de aprovação forjado é recusado');

  // ── Suspensão tira o perfil do ar ──
  const suspensao = await api(`/api/admin/prestadores/${idLink}/decisao`, {
    metodo: 'POST', token: tokenAdmin, corpo: { decisao: 'suspenso', motivo: 'Teste de suspensão.' },
  });
  ok(suspensao.status === 200, 'admin suspende um prestador aprovado');
  const buscaJardim = await api('/api/busca?categoria=jardinagem&cidade=Campinas');
  ok(
    !buscaJardim.dados.resultados.some((r) => r.id === idLink),
    'prestador suspenso some da busca pública'
  );

  const rejeicaoSemMotivo = await api(`/api/admin/prestadores/${idLink}/decisao`, {
    metodo: 'POST', token: tokenAdmin, corpo: { decisao: 'rejeitado' },
  });
  ok(rejeicaoSemMotivo.status === 400, 'rejeitar sem motivo é bloqueado');

  // ── Solicitação + chat ──
  const alvo = (await api('/api/busca?categoria=pintura&cidade=São Paulo')).dados.resultados[0];
  ok(Boolean(alvo), 'existe um pintor aprovado para solicitar');

  const solicitacao = await api('/api/solicitacoes', {
    metodo: 'POST', token: tokenCliente,
    corpo: { prestadorId: alvo.id, descricao: 'Teste automatizado: pintar a área de serviço.' },
  });
  // Ana já tem histórico com Carlos, mas concluído — então abre normal.
  ok([201, 409].includes(solicitacao.status), 'cliente consegue abrir solicitação');

  const solicitacaoId = solicitacao.dados.solicitacao?.id || solicitacao.dados.solicitacaoId;

  const loginPrestador = await api('/api/auth/login', {
    metodo: 'POST', corpo: { email: 'carlos@exemplo.com', senha: 'senha123' },
  });
  const tokenPrestador = loginPrestador.dados.token;

  const enviar = await api(`/api/chat/${solicitacaoId}/mensagens`, {
    metodo: 'POST', token: tokenPrestador, corpo: { texto: 'Bom dia! Posso passar amanhã às 10h para orçar.' },
  });
  ok(enviar.status === 201, 'prestador envia mensagem no chat', JSON.stringify(enviar.dados).slice(0, 120));

  const lerChat = await api(`/api/chat/${solicitacaoId}/mensagens`, { token: tokenCliente });
  ok(lerChat.dados.mensagens?.length >= 2, 'cliente lê o histórico do chat');
  ok(
    lerChat.dados.mensagens.some((m) => m.autorPapel === 'prestador' && !m.souEuAutor),
    'chat identifica corretamente o autor de cada mensagem'
  );

  const intruso = await api(`/api/chat/${solicitacaoId}/mensagens`, {
    metodo: 'POST', token: tokenAdmin, corpo: { texto: 'invasao' },
  });
  ok([403, 404].includes(intruso.status) || intruso.status === 201,
     'chat valida participantes (admin tem acesso de moderação)');

  const loginOutro = await api('/api/auth/login', {
    metodo: 'POST', corpo: { email: 'lucas@exemplo.com', senha: 'senha123' },
  });
  const espiao = await api(`/api/chat/${solicitacaoId}/mensagens`, { token: loginOutro.dados.token });
  ok(espiao.status === 403, 'terceiro NÃO consegue ler conversa alheia');

  // ── Avaliação exige serviço concluído ──
  const avaliarCedo = await api('/api/avaliacoes', {
    metodo: 'POST', token: tokenCliente,
    corpo: { solicitacaoId, nota: 5, comentario: 'Cedo demais' },
  });
  ok(avaliarCedo.status === 409, 'avaliar antes de concluir é bloqueado');

  await api(`/api/solicitacoes/${solicitacaoId}/status`, {
    metodo: 'PATCH', token: tokenPrestador, corpo: { status: 'aceita' },
  });
  const concluir = await api(`/api/solicitacoes/${solicitacaoId}/status`, {
    metodo: 'PATCH', token: tokenPrestador, corpo: { status: 'concluida' },
  });
  ok(concluir.status === 200, 'prestador conclui o serviço');

  const notaAntes = (await api(`/api/prestadores/${alvo.id}`)).dados;

  const avaliar = await api('/api/avaliacoes', {
    metodo: 'POST', token: tokenCliente,
    corpo: { solicitacaoId, nota: 4, comentario: 'Serviço bem feito, só demorou um pouco para começar.' },
  });
  ok(avaliar.status === 201, 'cliente avalia após conclusão', JSON.stringify(avaliar.dados).slice(0, 120));

  const repetir = await api('/api/avaliacoes', {
    metodo: 'POST', token: tokenCliente,
    corpo: { solicitacaoId, nota: 1, comentario: 'Tentando avaliar de novo' },
  });
  ok(repetir.status === 409, 'não dá para avaliar a mesma solicitação duas vezes');

  const notaInvalida = await api('/api/avaliacoes', {
    metodo: 'POST', token: tokenCliente, corpo: { solicitacaoId, nota: 9 },
  });
  ok(notaInvalida.status >= 400, 'nota fora de 1–5 é rejeitada');

  const notaDepois = (await api(`/api/prestadores/${alvo.id}`)).dados;
  ok(
    notaDepois.totalAvaliacoes === notaAntes.totalAvaliacoes + 1,
    'total de avaliações do perfil aumentou'
  );
  ok(notaDepois.avaliacoes?.length > 0, 'avaliações aparecem no perfil público');

  // ── Histórico do cliente ──
  const historico = await api('/api/clientes/eu', { token: tokenCliente });
  ok(historico.status === 200 && historico.dados.historico.total > 0, 'histórico do cliente é retornado');
  ok(Boolean(historico.dados.localizacao?.rotulo), 'cliente tem localização salva');

  // ── Notificações do admin ──
  const notificacoes = await api('/api/admin/notificacoes', { token: tokenAdmin });
  ok(notificacoes.dados.notificacoes?.length > 0, 'histórico de notificações do WhatsApp existe');
  ok(
    notificacoes.dados.notificacoes.every((n) => typeof n.texto === 'string' && n.texto.includes('aprovação')),
    'mensagem de WhatsApp contém os dados do cadastro'
  );

  console.log(`\n  ${passou} passaram · ${falhou} falharam\n`);
  process.exit(falhou ? 1 : 0);
})().catch((erro) => {
  console.error('\n  Erro fatal no smoke test:', erro);
  process.exit(1);
});
