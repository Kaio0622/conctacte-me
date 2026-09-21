// ============================================================
//  Upload das fotos de trabalho (portfólio do prestador)
// ============================================================

const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const { config } = require('./config');

const EXTENSOES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const armazenamento = multer.diskStorage({
  destination: (_req, _arquivo, cb) => cb(null, config.caminhos.uploads),
  filename: (_req, arquivo, cb) => {
    const extensao = EXTENSOES[arquivo.mimetype] || path.extname(arquivo.originalname) || '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extensao}`);
  },
});

const fotos = multer({
  storage: armazenamento,
  limits: {
    fileSize: config.upload.maxBytes,
    files: config.upload.maxArquivos,
  },
  fileFilter: (_req, arquivo, cb) => {
    if (config.upload.tiposAceitos.includes(arquivo.mimetype)) return cb(null, true);
    cb(new Error('Formato de imagem não aceito. Envie JPG, PNG ou WebP.'));
  },
});

// Wrapper que transforma erro do multer em resposta JSON amigável
// em vez de derrubar a request com um 500 sem explicação.
function receberFotos(campo = 'fotos') {
  const middleware = fotos.array(campo, config.upload.maxArquivos);
  return (req, res, proximo) => {
    middleware(req, res, (erro) => {
      if (!erro) return proximo();
      if (erro.code === 'LIMIT_FILE_SIZE') {
        const mb = (config.upload.maxBytes / 1024 / 1024).toFixed(0);
        return res.status(413).json({ erro: `Cada foto pode ter no máximo ${mb} MB.` });
      }
      if (erro.code === 'LIMIT_FILE_COUNT') {
        return res.status(413).json({ erro: `Envie no máximo ${config.upload.maxArquivos} fotos.` });
      }
      return res.status(400).json({ erro: erro.message });
    });
  };
}

// Caminho público servido por express.static('/uploads')
function urlPublicaDaFoto(arquivo) {
  return `/uploads/${arquivo.filename}`;
}

module.exports = { receberFotos, urlPublicaDaFoto };
