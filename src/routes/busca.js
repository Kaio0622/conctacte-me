// ============================================================
//  Busca e match — o coração do marketplace.
//  Cliente informa categoria + localização; devolvemos os
//  prestadores APROVADOS mais próximos, ordenados por um score
//  que combina distância e avaliação.
// ============================================================

const db = require('../db');
const geo = require('../geo');
const { CATEGORIAS, projetarPrestador, distanciaAte, calcularScore } = require('../dominio');

const rotas = require('../router')();

// GET /api/categorias — lista fixa usada nos formulários e nos filtros
rotas.get('/categorias', (_req, res) => {
  const prestadores = db.filtrar('prestadores', (p) => p.status === 'aprovado');
  const contagem = new Map();
  for (const p of prestadores) {
    contagem.set(p.categoria, (contagem.get(p.categoria) || 0) + 1);
  }
  res.json(CATEGORIAS.map((c) => ({ ...c, total: contagem.get(c.slug) || 0 })));
});

// GET /api/cidades?q=camp — autocomplete de localização
rotas.get('/cidades', (req, res) => {
  res.json(geo.sugerirCidades(req.query.q, 8));
});

// ============================================================
//  GET /api/busca
//  Parâmetros:
//    categoria  slug da categoria (opcional)
//    q          texto livre (nome do prestador ou descrição)
//    cidade     texto da localização
//    lat,lng    coordenada exata (tem prioridade sobre cidade)
//    raio       distância máxima em km (padrão 50)
//    ordenar    relevancia | distancia | avaliacao | preco
//    pagina     1-based
// ============================================================
rotas.get('/busca', (req, res) => {
  const { categoria, q, cidade, lat, lng, ordenar = 'relevancia' } = req.query;
  const raioBusca = Math.min(500, Math.max(1, Number(req.query.raio) || 50));
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const porPagina = 12;

  const ponto = geo.resolverPonto({ cidade, lat, lng });
  const termo = geo.normalizar(q);

  // ── Filtro 1: só prestadores APROVADOS entram na busca. ──
  // Esta linha é o que faz a aprovação manual valer alguma coisa:
  // enquanto o status for "pendente", o perfil não existe para o público.
  let candidatos = db.filtrar('prestadores', (p) => p.status === 'aprovado');

  if (categoria) {
    candidatos = candidatos.filter((p) => p.categoria === categoria);
  }

  if (termo) {
    candidatos = candidatos.filter((p) => {
      const usuario = db.porId('usuarios', p.usuarioId);
      const alvo = geo.normalizar(
        `${usuario?.nome || ''} ${p.descricao} ${p.areaAtendimento?.rotulo || ''}`
      );
      return alvo.includes(termo);
    });
  }

  // ── Filtro 2: alcance geográfico ────────────────────────────
  // Um prestador entra no resultado se o cliente estiver dentro
  // do raio de atendimento DELE, ou dentro do raio de busca do
  // cliente — o que for mais generoso. Assim um encanador que
  // atende 40 km não some porque o cliente buscou "até 10 km".
  let resultados = candidatos.map((prestador) => {
    const distancia = distanciaAte(prestador, ponto);
    return { prestador, distancia };
  });

  if (ponto) {
    resultados = resultados.filter(({ prestador, distancia }) => {
      if (distancia == null) return false;
      const raioPrestador = prestador.areaAtendimento?.raioKm || 20;
      return distancia <= Math.max(raioBusca, raioPrestador);
    });
  }

  // ── Ordenação ───────────────────────────────────────────────
  const ordenadores = {
    distancia: (a, b) => (a.distancia ?? Infinity) - (b.distancia ?? Infinity),
    avaliacao: (a, b) =>
      (b.prestador.notaMedia || 0) - (a.prestador.notaMedia || 0) ||
      (b.prestador.totalAvaliacoes || 0) - (a.prestador.totalAvaliacoes || 0),
    preco: (a, b) => a.prestador.precoMedio - b.prestador.precoMedio,
    relevancia: (a, b) =>
      calcularScore(b.prestador, b.distancia) - calcularScore(a.prestador, a.distancia),
  };
  resultados.sort(ordenadores[ordenar] || ordenadores.relevancia);

  const total = resultados.length;
  const inicio = (pagina - 1) * porPagina;
  const pagina_ = resultados.slice(inicio, inicio + porPagina);

  res.json({
    total,
    pagina,
    porPagina,
    temMais: inicio + porPagina < total,
    referencia: ponto ? { rotulo: ponto.rotulo, origem: ponto.origem } : null,
    ordenacao: ordenadores[ordenar] ? ordenar : 'relevancia',
    // Sinaliza que a ordenação por distância foi ignorada por falta de localização.
    avisoSemLocalizacao: !ponto,
    resultados: pagina_.map(({ prestador, distancia }) =>
      projetarPrestador(prestador, { distancia })
    ),
  });
});

// ============================================================
//  GET /api/prestadores/:id — perfil público
//  Traz as avaliações; o selo "verificado" sai do status.
// ============================================================
rotas.get('/prestadores/:id', (req, res) => {
  const prestador = db.porId('prestadores', req.params.id);

  // Perfis pendentes/rejeitados só são visíveis para o próprio dono
  // (para acompanhar a moderação) e para o admin.
  if (!prestador) {
    return res.status(404).json({ erro: 'Prestador não encontrado.' });
  }

  const ehDono = req.usuario && req.usuario.id === prestador.usuarioId;
  const ehAdmin = req.usuario?.papel === 'admin';
  if (prestador.status !== 'aprovado' && !ehDono && !ehAdmin) {
    return res.status(404).json({ erro: 'Prestador não encontrado.' });
  }

  const ponto = geo.resolverPonto({
    cidade: req.query.cidade,
    lat: req.query.lat,
    lng: req.query.lng,
  });

  res.json(
    projetarPrestador(prestador, {
      distancia: distanciaAte(prestador, ponto),
      incluirAvaliacoes: true,
      // O telefone só aparece para o dono, para o admin, ou para
      // clientes que já têm conversa aberta com este prestador.
      incluirContato:
        ehDono ||
        ehAdmin ||
        Boolean(
          req.usuario &&
            db.buscar(
              'solicitacoes',
              (s) => s.prestadorId === prestador.id && s.clienteUsuarioId === req.usuario.id
            )
        ),
    })
  );
});

module.exports = rotas;
