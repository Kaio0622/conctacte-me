// ============================================================
//  Área do prestador — editar o próprio perfil, gerenciar
//  fotos e acompanhar o status da verificação.
// ============================================================

const fs = require('fs/promises');
const path = require('path');
const db = require('../db');
const auth = require('../auth');
const geo = require('../geo');
const { config } = require('../config');
const { MAPA_CATEGORIAS, projetarPrestador } = require('../dominio');
const { receberFotos, urlPublicaDaFoto } = require('../upload');

const rotas = require('../router')();

// Carrega o prestador vinculado à sessão.
function meuPrestador(req, res, proximo) {
  const prestador = db.buscar('prestadores', (p) => p.usuarioId === req.usuario.id);
  if (!prestador) {
    return res.status(404).json({ erro: 'Você ainda não tem um perfil de prestador.' });
  }
  req.prestador = prestador;
  proximo();
}

// GET /api/prestadores/eu/perfil
rotas.get('/eu/perfil', auth.exigirSessao('prestador'), meuPrestador, (req, res) => {
  res.json({
    ...projetarPrestador(req.prestador, { incluirContato: true, incluirAvaliacoes: true }),
    motivoRejeicao: req.prestador.motivoRejeicao,
    aprovadoEm: req.prestador.aprovadoEm,
  });
});

// PUT /api/prestadores/eu/perfil — editar dados do perfil
rotas.put('/eu/perfil', auth.exigirSessao('prestador'), meuPrestador, async (req, res) => {
  const { categoria, descricao, precoMedio, unidadePreco, cidade, lat, lng, raioKm } = req.body || {};
  const mudancas = {};

  if (categoria !== undefined) {
    if (!MAPA_CATEGORIAS.has(categoria)) {
      return res.status(400).json({ erro: 'Categoria inválida.' });
    }
    mudancas.categoria = categoria;
  }

  if (descricao !== undefined) {
    if (typeof descricao !== 'string' || descricao.trim().length < 30) {
      return res.status(400).json({ erro: 'A descrição precisa ter pelo menos 30 caracteres.' });
    }
    mudancas.descricao = descricao.trim();
  }

  if (precoMedio !== undefined) {
    const preco = Number(String(precoMedio).replace(',', '.'));
    if (!Number.isFinite(preco) || preco <= 0) {
      return res.status(400).json({ erro: 'Informe um preço médio válido.' });
    }
    mudancas.precoMedio = Number(preco.toFixed(2));
  }

  if (unidadePreco !== undefined) {
    if (!['hora', 'diaria', 'servico', 'm2'].includes(unidadePreco)) {
      return res.status(400).json({ erro: 'Unidade de preço inválida.' });
    }
    mudancas.unidadePreco = unidadePreco;
  }

  if (cidade !== undefined || lat !== undefined || raioKm !== undefined) {
    const ponto = geo.resolverPonto({ cidade, lat, lng }) || {
      lat: req.prestador.areaAtendimento.lat,
      lng: req.prestador.areaAtendimento.lng,
      rotulo: req.prestador.areaAtendimento.rotulo,
    };
    mudancas.areaAtendimento = {
      rotulo: ponto.rotulo,
      lat: ponto.lat,
      lng: ponto.lng,
      raioKm: Math.min(200, Math.max(1, Number(raioKm) || req.prestador.areaAtendimento.raioKm)),
    };
  }

  const atualizado = await db.atualizar('prestadores', req.prestador.id, mudancas);
  res.json({
    mensagem: 'Perfil atualizado.',
    prestador: projetarPrestador(atualizado, { incluirContato: true }),
  });
});

// POST /api/prestadores/eu/fotos — adicionar fotos ao portfólio
rotas.post(
  '/eu/fotos',
  auth.exigirSessao('prestador'),
  meuPrestador,
  receberFotos('fotos'),
  async (req, res) => {
    const novas = (req.files || []).map(urlPublicaDaFoto);
    if (!novas.length) {
      return res.status(400).json({ erro: 'Nenhuma foto foi enviada.' });
    }

    const total = req.prestador.fotos.length + novas.length;
    if (total > config.upload.maxArquivos) {
      // Limpa o que acabou de subir para não deixar lixo no disco.
      await Promise.allSettled(
        (req.files || []).map((f) => fs.unlink(path.join(config.caminhos.uploads, f.filename)))
      );
      return res.status(400).json({
        erro: `Seu portfólio pode ter no máximo ${config.upload.maxArquivos} fotos. Remova alguma antes de enviar novas.`,
      });
    }

    const atualizado = await db.atualizar('prestadores', req.prestador.id, {
      fotos: [...req.prestador.fotos, ...novas],
    });
    res.status(201).json({ mensagem: 'Fotos adicionadas.', fotos: atualizado.fotos });
  }
);

// DELETE /api/prestadores/eu/fotos — remover uma foto do portfólio
rotas.delete('/eu/fotos', auth.exigirSessao('prestador'), meuPrestador, async (req, res) => {
  const { url } = req.body || {};
  if (!req.prestador.fotos.includes(url)) {
    return res.status(404).json({ erro: 'Foto não encontrada no seu portfólio.' });
  }

  const restantes = req.prestador.fotos.filter((f) => f !== url);
  await db.atualizar('prestadores', req.prestador.id, { fotos: restantes });

  // Só apaga do disco se nenhum outro perfil usa o mesmo arquivo.
  const emUso = db.buscar('prestadores', (p) => p.fotos?.includes(url));
  if (!emUso) {
    const nomeArquivo = path.basename(url);
    await fs.unlink(path.join(config.caminhos.uploads, nomeArquivo)).catch(() => {});
  }

  res.json({ mensagem: 'Foto removida.', fotos: restantes });
});

module.exports = rotas;
