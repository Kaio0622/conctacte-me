// ============================================================
//  Gera imagens de portfólio para a demonstração.
// ------------------------------------------------------------
//  Não são fotos reais — são composições geométricas geradas na
//  paleta de cada categoria. Servem para o layout aparecer como
//  foi projetado (foto grande em primeiro lugar) sem fingir que
//  existe um trabalho fotografado por trás. Troque por fotos de
//  verdade em produção.
//
//  Saem em PNG, escrito na unha com zlib — assim /uploads só
//  contém imagem raster, igual ao que os prestadores enviam de
//  verdade (jpg/png/webp), e o CSP estrito da pasta continua
//  valendo. SVG ali dentro seria vetor de XSS.
// ============================================================

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 800×520 é o suficiente para a foto de capa e para a galeria do
// perfil em telas retina, sem transformar a home num download de
// vários MB — este app é mobile-first.
const LARGURA = 800;
const ALTURA = 520;

/* ── Codificação PNG ──────────────────────────────────────── */

const TABELA_CRC = (() => {
  const tabela = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c;
  }
  return tabela;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = TABELA_CRC[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function bloco(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const verificacao = Buffer.alloc(4);
  verificacao.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, verificacao]);
}

// pixels: Buffer RGB (3 bytes por pixel, sem filtro por linha)
function montarPng(largura, altura, pixels) {
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(largura, 0);
  cabecalho.writeUInt32BE(altura, 4);
  cabecalho[8] = 8;  // 8 bits por canal
  cabecalho[9] = 2;  // truecolor RGB
  cabecalho[10] = 0; // deflate
  cabecalho[11] = 0; // filtro adaptativo
  cabecalho[12] = 0; // sem entrelaçamento

  // Cada scanline leva um byte de filtro na frente. Usamos o
  // filtro 2 (Up = diferença para a linha de cima): estas imagens
  // são gradientes verticais suaves, então o resíduo fica perto de
  // zero e o deflate reduz o arquivo em cerca de 10x em relação ao
  // filtro 0 (None). A primeira linha usa 0, pois não há linha
  // anterior para subtrair.
  const bytesPorLinha = largura * 3;
  const bruto = Buffer.alloc(altura * (1 + bytesPorLinha));

  for (let y = 0; y < altura; y++) {
    const destino = y * (1 + bytesPorLinha);
    const origem = y * bytesPorLinha;

    if (y === 0) {
      bruto[destino] = 0;
      pixels.copy(bruto, destino + 1, origem, origem + bytesPorLinha);
      continue;
    }

    bruto[destino] = 2;
    const acima = origem - bytesPorLinha;
    for (let i = 0; i < bytesPorLinha; i++) {
      bruto[destino + 1 + i] = (pixels[origem + i] - pixels[acima + i]) & 0xff;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', cabecalho),
    bloco('IDAT', zlib.deflateSync(bruto, { level: 9 })),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

/* ── Paletas ──────────────────────────────────────────────── */

const hex = (valor) => [
  parseInt(valor.slice(1, 3), 16),
  parseInt(valor.slice(3, 5), 16),
  parseInt(valor.slice(5, 7), 16),
];

// [tom claro, tom escuro, acento] — neutros e dessaturados de propósito
const PALETAS = {
  pintura:           ['#8fa0b5', '#3f4a5a', '#d9c7a7'],
  eletrica:          ['#9c8f6d', '#453f2e', '#e0c66a'],
  hidraulica:        ['#7ea0aa', '#2f4750', '#bcd7dc'],
  limpeza:           ['#8fa8a5', '#3a4a4a', '#e2e8e5'],
  reforma:           ['#a08b76', '#4a4038', '#d6c3ad'],
  marcenaria:        ['#a3805c', '#4b3a2a', '#dcc09a'],
  jardinagem:        ['#7d9a70', '#33452f', '#c4d4ac'],
  'ar-condicionado': ['#8098ad', '#33424f', '#cfe0ea'],
  mudancas:          ['#918d80', '#42413c', '#d3cdbb'],
  informatica:       ['#7d8698', '#333a47', '#c3cad8'],
  beleza:            ['#a3818d', '#4a3a40', '#dfc6cd'],
  aulas:             ['#868da0', '#3a3f4d', '#ccd2de'],
  fotografia:        ['#87858f', '#35343a', '#c9c7d0'],
  eventos:           ['#96789a', '#453444', '#d5c2d8'],
  pets:              ['#9c8770', '#463c33', '#d9c6b0'],
  costura:           ['#8b7f97', '#3e3745', '#cec4d6'],
};

/* ── Composições ──────────────────────────────────────────── */
//  Cada uma devolve uma lista de camadas; cada camada diz, para
//  um ponto (u, v) normalizado em 0–1, se ela cobre o ponto.

const COMPOSICOES = [
  // Faixas diagonais
  () => [
    { cor: 2, alfa: 0.16, dentro: (u, v) => v > 0.70 - u * 0.32 },
    { cor: 1, alfa: 0.24, dentro: (u, v) => v > 0.85 - u * 0.28 },
    { cor: 2, alfa: 0.13, dentro: (u, v) => (u - 0.78) ** 2 + (v - 0.26) ** 2 < 0.022 },
  ],
  // Blocos verticais
  () => [
    { cor: 2, alfa: 0.15, dentro: (u, v) => u > 0.07 && u < 0.42 && v > 0.18 && v < 0.84 },
    { cor: 1, alfa: 0.22, dentro: (u, v) => u > 0.47 && u < 0.72 && v > 0.31 && v < 0.84 },
    { cor: 2, alfa: 0.1,  dentro: (u, v) => u > 0.76 && u < 0.94 && v > 0.22 && v < 0.84 },
  ],
  // Arcos
  () => [
    { cor: 2, alfa: 0.15, dentro: (u, v) => (u - 0.5) ** 2 / 0.30 + (v - 1.28) ** 2 / 0.52 < 1 },
    { cor: 1, alfa: 0.22, dentro: (u, v) => (u - 0.5) ** 2 / 0.14 + (v - 1.16) ** 2 / 0.34 < 1 },
    { cor: 2, alfa: 0.18, dentro: (u, v) => (u - 0.5) ** 2 + (v - 0.30) ** 2 < 0.012 },
  ],
  // Grade
  () => {
    const celulas = [];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        const x0 = 0.08 + i * 0.225;
        const y0 = 0.14 + j * 0.24;
        celulas.push({ x0, x1: x0 + 0.175, y0, y1: y0 + 0.185 });
      }
    }
    return [
      { cor: 2, alfa: 0.13, dentro: (u, v) => celulas.some((c) => u > c.x0 && u < c.x1 && v > c.y0 && v < c.y1) },
      { cor: 1, alfa: 0.25, dentro: (_u, v) => v > 0.82 },
    ];
  },
];

/* ── Desenho ──────────────────────────────────────────────── */

// Ruído determinístico: mesma entrada, mesma imagem em toda execução.
function ruido(x, y, semente) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + semente * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

function desenhar(categoria, indice) {
  const [claro, escuro, acento] = (PALETAS[categoria] || ['#868d97', '#3a3f46', '#ccd1d8']).map(hex);
  const cores = [claro, escuro, acento];
  const camadas = COMPOSICOES[indice % COMPOSICOES.length]();
  const pixels = Buffer.alloc(LARGURA * ALTURA * 3);

  for (let y = 0; y < ALTURA; y++) {
    const v = y / ALTURA;
    for (let x = 0; x < LARGURA; x++) {
      const u = x / LARGURA;

      // Gradiente diagonal claro → escuro
      const t = Math.min(1, (u * 0.45 + v * 0.75));
      let r = claro[0] + (escuro[0] - claro[0]) * t;
      let g = claro[1] + (escuro[1] - claro[1]) * t;
      let b = claro[2] + (escuro[2] - claro[2]) * t;

      for (const camada of camadas) {
        if (!camada.dentro(u, v)) continue;
        const c = cores[camada.cor];
        r += (c[0] - r) * camada.alfa;
        g += (c[1] - g) * camada.alfa;
        b += (c[2] - b) * camada.alfa;
      }

      // Textura leve, para não ficar com cara de gradiente de CSS.
      // Calculada por bloco de 4×4 e não por pixel: ruído pixel a
      // pixel é incompressível e levava cada PNG a ~350 KB, o que
      // não cabe numa home mobile-first.
      const grao = (ruido(x >> 2, y >> 2, indice) - 0.5) * 7;
      const destino = (y * LARGURA + x) * 3;
      pixels[destino]     = Math.max(0, Math.min(255, r + grao));
      pixels[destino + 1] = Math.max(0, Math.min(255, g + grao));
      pixels[destino + 2] = Math.max(0, Math.min(255, b + grao));
    }
  }

  return montarPng(LARGURA, ALTURA, pixels);
}

/* ── API ──────────────────────────────────────────────────── */

/**
 * Grava `quantidade` imagens para um prestador e devolve as URLs públicas.
 */
function gerarFotos(pastaUploads, categoria, prestadorId, quantidade) {
  fs.mkdirSync(pastaUploads, { recursive: true });
  const urls = [];

  for (let i = 0; i < quantidade; i++) {
    const nome = `demo-${categoria}-${prestadorId.slice(0, 8)}-${i}.png`;
    fs.writeFileSync(path.join(pastaUploads, nome), desenhar(categoria, i));
    urls.push(`/uploads/${nome}`);
  }

  return urls;
}

// Remove só as imagens geradas por este script (prefixo "demo-"),
// preservando o que foi enviado de verdade pelos prestadores.
function limparFotosDemo(pastaUploads) {
  if (!fs.existsSync(pastaUploads)) return;
  for (const arquivo of fs.readdirSync(pastaUploads)) {
    if (arquivo.startsWith('demo-')) fs.unlinkSync(path.join(pastaUploads, arquivo));
  }
}

module.exports = { gerarFotos, limparFotosDemo };
