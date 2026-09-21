// ============================================================
//  Notificação de aprovação — despacha a mensagem de WhatsApp
//  quando um prestador novo se cadastra.
// ------------------------------------------------------------
//  Três provedores plugáveis (WHATSAPP_PROVIDER no .env):
//    twilio → API REST do Twilio
//    meta   → WhatsApp Cloud API oficial
//    link   → não envia; só registra e gera um link wa.me
//
//  Em TODOS os casos a notificação é gravada em
//  data/notificacoes.json, então o painel /admin sempre mostra
//  a fila de aprovação mesmo que o envio externo falhe.
// ============================================================

const crypto = require('crypto');
const { config } = require('../config');
const db = require('../db');
const auth = require('../auth');
const { nomeCategoria } = require('../dominio');

const twilio = require('./twilio');
const meta = require('./meta');

// Monta o texto que chega no WhatsApp do administrador.
function montarMensagem(prestador, usuario) {
  const linkAprovar = `${config.urlPublica}/api/admin/aprovacao-rapida?token=${auth.criarTokenAcao('aprovar', prestador.id)}`;
  const linkRejeitar = `${config.urlPublica}/api/admin/aprovacao-rapida?token=${auth.criarTokenAcao('rejeitar', prestador.id)}`;

  const linhas = [
    '*Contact Me — novo prestador aguardando aprovação*',
    '',
    `*Nome:* ${usuario.nome}`,
    // Nome legível, não o slug: quem lê no celular é uma pessoa.
    `*Categoria:* ${nomeCategoria(prestador.categoria)}`,
    `*Atendimento:* ${prestador.areaAtendimento.rotulo} (raio de ${prestador.areaAtendimento.raioKm} km)`,
    `*Preço médio:* ${formatarPreco(prestador.precoMedio)}`,
    `*Telefone:* ${usuario.telefone || 'não informado'}`,
    `*E-mail:* ${usuario.email}`,
    `*Fotos do trabalho:* ${prestador.fotos.length}`,
    '',
    '*Descrição:*',
    prestador.descricao,
    '',
    '— Aprovar:',
    linkAprovar,
    '',
    '— Rejeitar:',
    linkRejeitar,
  ];

  return { texto: linhas.join('\n'), linkAprovar, linkRejeitar };
}

function formatarPreco(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 'não informado';
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Link wa.me pré-preenchido — usado no modo "link" e como
// plano B no painel quando o envio automático falha.
function montarLinkWaMe(destino, texto) {
  if (!destino) return null;
  return `https://wa.me/${destino}?text=${encodeURIComponent(texto)}`;
}

/**
 * Dispara a notificação de novo prestador.
 * Nunca lança: uma falha de WhatsApp não pode derrubar o cadastro.
 */
async function notificarNovoPrestador(prestador, usuario) {
  const { texto, linkAprovar, linkRejeitar } = montarMensagem(prestador, usuario);
  const destino = config.whatsapp.destino;

  const notificacao = {
    id: crypto.randomUUID(),
    tipo: 'novo-prestador',
    prestadorId: prestador.id,
    prestadorNome: usuario.nome,
    destino,
    provider: config.whatsapp.provider,
    texto,
    linkAprovar,
    linkRejeitar,
    linkWaMe: montarLinkWaMe(destino, texto),
    status: 'pendente',
    detalhe: null,
    criadoEm: new Date().toISOString(),
  };

  if (!destino) {
    notificacao.status = 'nao-configurado';
    notificacao.detalhe =
      'ADMIN_WHATSAPP não está preenchido no .env — a mensagem não foi enviada. ' +
      'O prestador continua na fila de aprovação em /admin.html.';
  } else if (config.whatsapp.provider === 'link') {
    notificacao.status = 'link-gerado';
    notificacao.detalhe = 'Modo "link": abra o link wa.me no painel para enviar manualmente.';
  } else {
    try {
      const enviador = config.whatsapp.provider === 'meta' ? meta : twilio;
      const resultado = await enviador.enviar(destino, texto);
      notificacao.status = 'enviado';
      notificacao.detalhe = resultado.detalhe;
      notificacao.idExterno = resultado.idExterno || null;
    } catch (erro) {
      notificacao.status = 'falhou';
      notificacao.detalhe = erro.message;
      console.error('[whatsapp] Falha no envio:', erro.message);
    }
  }

  await db.inserir('notificacoes', notificacao);

  // Espelha no console — em dev é aqui que você lê a mensagem.
  console.log('\n───────── WhatsApp • aprovação de prestador ─────────');
  console.log(`para: ${destino || '(ADMIN_WHATSAPP não configurado)'}  ·  via: ${notificacao.provider}  ·  ${notificacao.status}`);
  if (notificacao.detalhe) console.log(notificacao.detalhe);
  console.log(texto);
  console.log('─────────────────────────────────────────────────────\n');

  return notificacao;
}

module.exports = { notificarNovoPrestador, montarLinkWaMe, montarMensagem };
