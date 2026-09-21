const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { config } = require('./config');

const tipos = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 1, fieldSize: 10000 },
  fileFilter: (_req, arquivo, cb) => cb(tipos[arquivo.mimetype] ? null : new Error('Envie uma foto JPG, PNG ou WebP.'), Boolean(tipos[arquivo.mimetype])),
}).single('imagem');

function receberImagem(req, res, next) {
  upload(req, res, erro => {
    if (erro) return res.status(erro.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ erro: erro.code === 'LIMIT_FILE_SIZE' ? 'A foto pode ter no máximo 4 MB.' : 'Envie uma única foto JPG, PNG ou WebP, de até 4 MB.' });
    if (req.file) {
      const b = req.file.buffer;
      const valido = req.file.mimetype === 'image/jpeg' ? b.length > 3 && b[0] === 255 && b[1] === 216 && b[2] === 255
        : req.file.mimetype === 'image/png' ? b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
      if (!valido) return res.status(400).json({ erro: 'O arquivo não é uma imagem JPG, PNG ou WebP válida.' });
    }
    next();
  });
}

function pasta() { return path.join(config.caminhos.dados, 'chat-anexos'); }
async function salvarImagem(arquivo) {
  if (!arquivo) return null;
  await fs.mkdir(pasta(), { recursive: true });
  const nome = crypto.randomUUID() + tipos[arquivo.mimetype];
  await fs.writeFile(path.join(pasta(), nome), arquivo.buffer, { flag: 'wx' });
  return { arquivo: nome, tipo: arquivo.mimetype, tamanho: arquivo.size };
}
module.exports = { receberImagem, salvarImagem, pasta };
