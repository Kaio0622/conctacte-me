const { config } = require('../src/config');

async function main() {
  const chave = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!config.supabase.url || !chave) throw new Error('Preencha a URL e a chave publicável do Supabase.');
  const res = await fetch(`${config.supabase.url}/auth/v1/settings`, {
    headers: { apikey: chave }, signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Não foi possível consultar o provedor: HTTP ${res.status}`);
  const dados = await res.json();
  console.log(JSON.stringify({ googleHabilitado: dados.external?.google === true,
    callbackGoogle: `${config.supabase.url}/auth/v1/callback`,
    retornoApp: `${config.urlPublica}/api/auth/google/callback` }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
