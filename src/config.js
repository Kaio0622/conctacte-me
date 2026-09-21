// ============================================================
//  Configuração central — lê o .env e aplica padrões seguros
// ============================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const raiz = path.join(__dirname, '..');

// Normaliza um telefone para E.164 sem "+" (só dígitos).
// Aceita "(11) 90000-0000", "+55 11 90000-0000", "5511900000000"…
function normalizarTelefone(valor) {
  if (!valor) return '';
  const digitos = String(valor).replace(/\D/g, '');
  if (!digitos) return '';
  // Se veio só com DDD + número (10 ou 11 dígitos), assume Brasil.
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos;
}

const config = {
  porta: Number(process.env.PORT) || 3000,
  segredo: process.env.APP_SECRET || 'contact-me-dev-secret',
  urlPublica: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),

  admin: {
    email: (process.env.ADMIN_EMAIL || 'admin@contactme.local').toLowerCase(),
    senha: process.env.ADMIN_SENHA || 'admin123',
  },

  whatsapp: {
    // 'twilio' | 'meta' | 'link'
    provider: (process.env.WHATSAPP_PROVIDER || 'link').toLowerCase(),
    destino: normalizarTelefone(process.env.ADMIN_WHATSAPP),
    twilio: {
      sid: process.env.TWILIO_ACCOUNT_SID || '',
      token: process.env.TWILIO_AUTH_TOKEN || '',
      from: normalizarTelefone(process.env.TWILIO_WHATSAPP_FROM),
    },
    meta: {
      token: process.env.META_WHATSAPP_TOKEN || '',
      phoneNumberId: process.env.META_PHONE_NUMBER_ID || '',
    },
  },

  banco: process.env.DB_DRIVER || 'json',
  supabase: {
    url: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    publicavel: process.env.SUPABASE_PUBLISHABLE_KEY || '',
    chave: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  caminhos: {
    raiz,
    dados: process.env.DATA_DIR || path.join(raiz, 'data'),
    uploads: process.env.UPLOADS_DIR || path.join(raiz, 'uploads'),
    publico: path.join(raiz, 'public'),
  },

  // Limites de upload de fotos do portfólio
  upload: {
    maxArquivos: 6,
    maxBytes: 4 * 1024 * 1024, // 4 MB por foto
    tiposAceitos: ['image/jpeg', 'image/png', 'image/webp'],
  },
};

// Um provedor só é considerado "pronto" se tiver todas as credenciais.
config.whatsapp.configurado = (() => {
  const w = config.whatsapp;
  if (!w.destino) return false;
  if (w.provider === 'twilio') return Boolean(w.twilio.sid && w.twilio.token && w.twilio.from);
  if (w.provider === 'meta') return Boolean(w.meta.token && w.meta.phoneNumberId);
  return true; // modo 'link' nunca precisa de credencial
})();

module.exports = { config, normalizarTelefone };
