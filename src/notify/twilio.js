// ============================================================
//  Adaptador Twilio — WhatsApp via API REST
// ------------------------------------------------------------
//  Usa fetch nativo (Node 18+), sem o SDK oficial: é só um POST
//  form-urlencoded com autenticação Basic.
//  Docs: https://www.twilio.com/docs/whatsapp/api
// ============================================================

const { config } = require('../config');

const TIMEOUT_MS = 15000;

async function enviar(destino, texto) {
  const { sid, token, from } = config.whatsapp.twilio;

  if (!sid || !token) {
    throw new Error(
      'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN não preenchidos no .env. ' +
        'Pegue as chaves em console.twilio.com ou troque WHATSAPP_PROVIDER para "link".'
    );
  }
  if (!from) {
    throw new Error('TWILIO_WHATSAPP_FROM não preenchido no .env.');
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
  const corpo = new URLSearchParams({
    From: `whatsapp:+${from}`,
    To: `whatsapp:+${destino}`,
    Body: texto,
  });

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS);

  try {
    const resposta = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: corpo,
      signal: controle.signal,
    });

    const dados = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      const motivo = dados.message || `HTTP ${resposta.status}`;
      // Erro clássico do sandbox: o número destino não deu "join" ainda.
      const dica =
        dados.code === 63007 || dados.code === 21606
          ? ' (o número remetente não está habilitado para WhatsApp — confira o sandbox do Twilio)'
          : dados.code === 63016
            ? ' (fora da janela de 24h: no sandbox o destino precisa mandar "join <palavra>" antes)'
            : '';
      throw new Error(`Twilio recusou o envio: ${motivo}${dica}`);
    }

    return {
      idExterno: dados.sid || null,
      detalhe: `Enviado pelo Twilio (status: ${dados.status || 'queued'}).`,
    };
  } catch (erro) {
    if (erro.name === 'AbortError') {
      throw new Error('Twilio não respondeu em 15s — verifique a conexão.');
    }
    throw erro;
  } finally {
    clearTimeout(relogio);
  }
}

module.exports = { enviar };
