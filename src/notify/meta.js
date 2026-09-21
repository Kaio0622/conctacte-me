// ============================================================
//  Adaptador Meta — WhatsApp Cloud API oficial
// ------------------------------------------------------------
//  Alternativa ao Twilio. Docs:
//  https://developers.facebook.com/docs/whatsapp/cloud-api
//
//  Atenção: fora da janela de 24h o Cloud API só aceita
//  mensagens de template aprovado. Para o fluxo de aprovação
//  isso costuma bastar porque o admin responde no mesmo dia,
//  mas em produção vale cadastrar um template.
// ============================================================

const { config } = require('../config');

const TIMEOUT_MS = 15000;
const VERSAO_API = 'v21.0';

async function enviar(destino, texto) {
  const { token, phoneNumberId } = config.whatsapp.meta;

  if (!token || !phoneNumberId) {
    throw new Error(
      'META_WHATSAPP_TOKEN / META_PHONE_NUMBER_ID não preenchidos no .env. ' +
        'Troque WHATSAPP_PROVIDER para "link" se quiser rodar sem credenciais.'
    );
  }

  const url = `https://graph.facebook.com/${VERSAO_API}/${phoneNumberId}/messages`;
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS);

  try {
    const resposta = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: destino,
        type: 'text',
        text: { preview_url: false, body: texto },
      }),
      signal: controle.signal,
    });

    const dados = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      const motivo = dados?.error?.message || `HTTP ${resposta.status}`;
      throw new Error(`Meta recusou o envio: ${motivo}`);
    }

    return {
      idExterno: dados?.messages?.[0]?.id || null,
      detalhe: 'Enviado pela WhatsApp Cloud API (Meta).',
    };
  } catch (erro) {
    if (erro.name === 'AbortError') {
      throw new Error('A Meta não respondeu em 15s — verifique a conexão.');
    }
    throw erro;
  } finally {
    clearTimeout(relogio);
  }
}

module.exports = { enviar };
