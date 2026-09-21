// ============================================================
//  Contact Me — Marketplace de Serviços Locais
//  Bootstrap do servidor.
// ============================================================

const { config } = require('./src/config');
const db = require('./src/db');
const { criarApp } = require('./src/app');

async function iniciar() {
await db.inicializar();

const app = criarApp();

const servidor = app.listen(config.porta, () => {
  const linha = (texto) => console.log(`  ${texto}`);

  console.log('');
  linha('╔════════════════════════════════════════════════════╗');
  linha('║  Contact Me — Marketplace de Serviços Locais       ║');
  linha('╚════════════════════════════════════════════════════╝');
  linha('');
  linha(`App .............. http://localhost:${config.porta}`);
  linha(`Painel admin ..... http://localhost:${config.porta}/admin.html`);
  linha(`Login do admin ... ${config.admin.email}`);
  linha('Banco ............ ' + config.banco);
  linha('');

  const w = config.whatsapp;
  if (!w.destino) {
    linha('WhatsApp ......... ADMIN_WHATSAPP vazio no .env — nada será enviado.');
  } else if (w.provider === 'link') {
    linha(`WhatsApp ......... modo "link" → +${w.destino} (sem envio automático)`);
  } else if (w.configurado) {
    linha(`WhatsApp ......... ${w.provider} → +${w.destino}`);
  } else {
    linha(`WhatsApp ......... ${w.provider} SEM credenciais — o envio vai falhar.`);
    linha('                   Preencha o .env ou use WHATSAPP_PROVIDER=link.');
  }
  console.log('');
});

// Encerramento limpo: espera as gravações pendentes antes de sair,
// senão um Ctrl+C no meio de um POST pode perder o último registro.
async function encerrar(sinal) {
  console.log(`\n${sinal} recebido — encerrando...`);
  servidor.close();
  await db.drenar();
  process.exit(0);
}

process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));

}
iniciar().catch(erro => { console.error('Falha ao iniciar:', erro.message); process.exitCode = 1; });
