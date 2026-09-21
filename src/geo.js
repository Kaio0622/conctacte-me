// ============================================================
//  Geolocalização — resolve cidade → coordenada e calcula
//  distância real (Haversine), sem depender de API externa.
// ------------------------------------------------------------
//  O cliente pode informar a posição de três formas:
//   1. lat/lng do navegador (navigator.geolocation) → precisão máxima
//   2. nome da cidade → resolvido nesta tabela
//   3. nada → busca sem ordenação por distância
// ============================================================

const RAIO_TERRA_KM = 6371;

// Base local de municípios brasileiros (capitais + maiores cidades).
// [nome, UF, latitude, longitude]
const CIDADES = [
  ['São Paulo', 'SP', -23.5505, -46.6333],
  ['Rio de Janeiro', 'RJ', -22.9068, -43.1729],
  ['Brasília', 'DF', -15.7939, -47.8828],
  ['Salvador', 'BA', -12.9777, -38.5016],
  ['Fortaleza', 'CE', -3.7319, -38.5267],
  ['Belo Horizonte', 'MG', -19.9167, -43.9345],
  ['Manaus', 'AM', -3.119, -60.0217],
  ['Curitiba', 'PR', -25.4284, -49.2733],
  ['Recife', 'PE', -8.0476, -34.877],
  ['Goiânia', 'GO', -16.6869, -49.2648],
  ['Belém', 'PA', -1.4558, -48.5044],
  ['Porto Alegre', 'RS', -30.0346, -51.2177],
  ['Guarulhos', 'SP', -23.4543, -46.5337],
  ['Campinas', 'SP', -22.9099, -47.0626],
  ['São Luís', 'MA', -2.5307, -44.3068],
  ['São Gonçalo', 'RJ', -22.8268, -43.0537],
  ['Maceió', 'AL', -9.6658, -35.7353],
  ['Duque de Caxias', 'RJ', -22.7856, -43.3117],
  ['Campo Grande', 'MS', -20.4697, -54.6201],
  ['Natal', 'RN', -5.7945, -35.211],
  ['Teresina', 'PI', -5.0892, -42.8019],
  ['São Bernardo do Campo', 'SP', -23.6914, -46.5646],
  ['Nova Iguaçu', 'RJ', -22.7592, -43.451],
  ['João Pessoa', 'PB', -7.1195, -34.845],
  ['Santo André', 'SP', -23.6639, -46.5383],
  ['Osasco', 'SP', -23.5329, -46.7918],
  ['Jaboatão dos Guararapes', 'PE', -8.1128, -35.0147],
  ['São José dos Campos', 'SP', -23.1791, -45.8872],
  ['Ribeirão Preto', 'SP', -21.1775, -47.8103],
  ['Uberlândia', 'MG', -18.9186, -48.2772],
  ['Sorocaba', 'SP', -23.5015, -47.4526],
  ['Contagem', 'MG', -19.9317, -44.0536],
  ['Aracaju', 'SE', -10.9472, -37.0731],
  ['Feira de Santana', 'BA', -12.2664, -38.9663],
  ['Cuiabá', 'MT', -15.6014, -56.0979],
  ['Joinville', 'SC', -26.3044, -48.8487],
  ['Juiz de Fora', 'MG', -21.7642, -43.3503],
  ['Londrina', 'PR', -23.3045, -51.1696],
  ['Aparecida de Goiânia', 'GO', -16.8225, -49.2469],
  ['Niterói', 'RJ', -22.8832, -43.1034],
  ['Ananindeua', 'PA', -1.3656, -48.3722],
  ['Porto Velho', 'RO', -8.7612, -63.9004],
  ['Serra', 'ES', -20.1288, -40.3078],
  ['Caxias do Sul', 'RS', -29.1685, -51.1794],
  ['Campos dos Goytacazes', 'RJ', -21.7545, -41.3244],
  ['Macapá', 'AP', 0.0389, -51.0664],
  ['Florianópolis', 'SC', -27.5954, -48.548],
  ['Vila Velha', 'ES', -20.3297, -40.2925],
  ['São José do Rio Preto', 'SP', -20.8113, -49.3758],
  ['Mauá', 'SP', -23.6677, -46.4613],
  ['Santos', 'SP', -23.9608, -46.3336],
  ['Mogi das Cruzes', 'SP', -23.5228, -46.1883],
  ['Diadema', 'SP', -23.6813, -46.6205],
  ['Betim', 'MG', -19.9678, -44.1983],
  ['Campina Grande', 'PB', -7.2306, -35.8811],
  ['Jundiaí', 'SP', -23.1857, -46.8978],
  ['Olinda', 'PE', -8.0089, -34.8553],
  ['Carapicuíba', 'SP', -23.5225, -46.8358],
  ['Piracicaba', 'SP', -22.7253, -47.6492],
  ['Montes Claros', 'MG', -16.735, -43.8617],
  ['Cariacica', 'ES', -20.2632, -40.4165],
  ['Bauru', 'SP', -22.3145, -49.0605],
  ['Rio Branco', 'AC', -9.9754, -67.8249],
  ['Vitória', 'ES', -20.3155, -40.3128],
  ['Anápolis', 'GO', -16.3281, -48.9531],
  ['Caucaia', 'CE', -3.7361, -38.6531],
  ['Itaquaquecetuba', 'SP', -23.4864, -46.3486],
  ['Vitória da Conquista', 'BA', -14.8615, -40.8442],
  ['Maringá', 'PR', -23.4205, -51.9331],
  ['Caruaru', 'PE', -8.2829, -35.9761],
  ['São Vicente', 'SP', -23.9631, -46.3919],
  ['Pelotas', 'RS', -31.7654, -52.3376],
  ['Canoas', 'RS', -29.9177, -51.1836],
  ['Franca', 'SP', -20.5386, -47.4008],
  ['Blumenau', 'SC', -26.9194, -49.0661],
  ['Ponta Grossa', 'PR', -25.095, -50.1619],
  ['Petrolina', 'PE', -9.3891, -40.503],
  ['Boa Vista', 'RR', 2.8235, -60.6758],
  ['Palmas', 'TO', -10.2491, -48.3243],
  ['Uberaba', 'MG', -19.7472, -47.9381],
  ['Cascavel', 'PR', -24.9555, -53.4552],
  ['Praia Grande', 'SP', -24.0058, -46.4028],
  ['Taubaté', 'SP', -23.0264, -45.5553],
  ['Limeira', 'SP', -22.5647, -47.4017],
  ['Suzano', 'SP', -23.5423, -46.3108],
  ['Governador Valadares', 'MG', -18.8511, -41.9494],
  ['Volta Redonda', 'RJ', -22.5202, -44.0996],
  ['Santa Maria', 'RS', -29.6842, -53.8069],
  ['Petrópolis', 'RJ', -22.505, -43.1786],
  ['Barueri', 'SP', -23.5106, -46.8761],
  ['Novo Hamburgo', 'RS', -29.6783, -51.1306],
  ['Marília', 'SP', -22.2139, -49.9458],
  ['Presidente Prudente', 'SP', -22.1256, -51.3889],
  ['Foz do Iguaçu', 'PR', -25.5478, -54.5882],
  ['Itajaí', 'SC', -26.9078, -48.6619],
  ['Criciúma', 'SC', -28.6775, -49.3697],
  ['Chapecó', 'SC', -27.1004, -52.6152],
  ['Gravataí', 'RS', -29.9444, -50.9919],
  ['Viamão', 'RS', -30.0811, -51.0233],
  ['São Leopoldo', 'RS', -29.7604, -51.1472],
  ['Rio Grande', 'RS', -32.035, -52.0986],
  ['Americana', 'SP', -22.7397, -47.3314],
  ['Indaiatuba', 'SP', -23.0903, -47.2181],
  ['Araraquara', 'SP', -21.7947, -48.1758],
  ['Jacareí', 'SP', -23.3053, -45.9658],
  ['Hortolândia', 'SP', -22.8583, -47.22],
  ['Rio Claro', 'SP', -22.4111, -47.5614],
  ['Sumaré', 'SP', -22.8219, -47.2669],
  ['Cotia', 'SP', -23.6039, -46.9192],
  ['Guarujá', 'SP', -23.9931, -46.2564],
  ['Embu das Artes', 'SP', -23.6486, -46.8522],
  ['Ferraz de Vasconcelos', 'SP', -23.5411, -46.3689],
  ["Santa Bárbara d'Oeste", 'SP', -22.7539, -47.4139],
  ['São Caetano do Sul', 'SP', -23.6229, -46.5548],
  ['Taboão da Serra', 'SP', -23.6019, -46.7917],
  ['Ipatinga', 'MG', -19.4683, -42.5369],
  ['Sete Lagoas', 'MG', -19.4658, -44.2469],
  ['Divinópolis', 'MG', -20.1394, -44.8839],
  ['Poços de Caldas', 'MG', -21.7878, -46.5611],
  ['Barbacena', 'MG', -21.2258, -43.7736],
  ['Teófilo Otoni', 'MG', -17.8575, -41.5053],
  ['Imperatriz', 'MA', -5.5264, -47.4917],
  ['Marabá', 'PA', -5.3689, -49.1178],
  ['Santarém', 'PA', -2.4431, -54.7083],
  ['Parauapebas', 'PA', -6.0678, -49.9022],
  ['Juazeiro do Norte', 'CE', -7.2131, -39.3153],
  ['Sobral', 'CE', -3.6861, -40.3489],
  ['Mossoró', 'RN', -5.1875, -37.3444],
  ['Arapiraca', 'AL', -9.7519, -36.6611],
  ['Camaçari', 'BA', -12.6997, -38.3244],
  ['Ilhéus', 'BA', -14.7889, -39.0494],
  ['Itabuna', 'BA', -14.7856, -39.2803],
  ['Juazeiro', 'BA', -9.4111, -40.4986],
  ['Barreiras', 'BA', -12.1528, -44.99],
  ['Lauro de Freitas', 'BA', -12.8944, -38.3269],
  ['Dourados', 'MS', -22.2211, -54.8056],
  ['Rondonópolis', 'MT', -16.4708, -54.6356],
  ['Várzea Grande', 'MT', -15.6467, -56.1325],
  ['Sinop', 'MT', -11.8642, -55.5028],
  ['Luziânia', 'GO', -16.2525, -47.9503],
  ['Rio Verde', 'GO', -17.7975, -50.9264],
  ['Águas Lindas de Goiás', 'GO', -15.7617, -48.2825],
  ['Trindade', 'GO', -16.6494, -49.4886],
  ['Caldas Novas', 'GO', -17.7414, -48.625],
  ['Bagé', 'RS', -31.3314, -54.1069],
  ['Passo Fundo', 'RS', -28.2622, -52.4067],
  ['Erechim', 'RS', -27.6339, -52.2739],
  ['Lajeado', 'RS', -29.4669, -51.9611],
  ['Bento Gonçalves', 'RS', -29.1706, -51.5192],
  ['Balneário Camboriú', 'SC', -26.9906, -48.635],
  ['Lages', 'SC', -27.8161, -50.3264],
  ['São José', 'SC', -27.5969, -48.6394],
  ['Palhoça', 'SC', -27.6386, -48.6708],
  ['Jaraguá do Sul', 'SC', -26.4864, -49.0669],
  ['Brusque', 'SC', -27.0978, -48.9128],
  ['Tubarão', 'SC', -28.4667, -49.0069],
  ['Colombo', 'PR', -25.2919, -49.2242],
  ['São José dos Pinhais', 'PR', -25.5306, -49.2064],
  ['Guarapuava', 'PR', -25.3908, -51.4622],
  ['Paranaguá', 'PR', -25.5161, -48.5225],
  ['Apucarana', 'PR', -23.5508, -51.4611],
  ['Toledo', 'PR', -24.7139, -53.7433],
  ['Umuarama', 'PR', -23.7658, -53.3253],
  ['Araucária', 'PR', -25.5928, -49.4106],
  ['Pinhais', 'PR', -25.4444, -49.1928],
  ['Campo Largo', 'PR', -25.4589, -49.5289],
  ['Angra dos Reis', 'RJ', -23.0067, -44.3181],
  ['Cabo Frio', 'RJ', -22.8894, -42.0286],
  ['Macaé', 'RJ', -22.3708, -41.7869],
  ['Nova Friburgo', 'RJ', -22.2819, -42.5311],
  ['Teresópolis', 'RJ', -22.4128, -42.9661],
  ['Barra Mansa', 'RJ', -22.5442, -44.1711],
  ['Resende', 'RJ', -22.4686, -44.4467],
  ['Itaboraí', 'RJ', -22.7442, -42.8592],
  ['Belford Roxo', 'RJ', -22.7642, -43.3994],
  ['São João de Meriti', 'RJ', -22.8036, -43.3722],
  ['Magé', 'RJ', -22.6631, -43.0406],
  ['Queimados', 'RJ', -22.7167, -43.5553],
  ['Nilópolis', 'RJ', -22.8058, -43.4136],
  ['Mesquita', 'RJ', -22.7828, -43.4292],
  ['Linhares', 'ES', -19.3908, -40.0722],
  ['Colatina', 'ES', -19.5389, -40.6306],
  ['São Mateus', 'ES', -18.7208, -39.8586],
  ['Guarapari', 'ES', -20.6667, -40.5],
  ['Cachoeiro de Itapemirim', 'ES', -20.8489, -41.1128],
].map(([nome, uf, lat, lng]) => ({ nome, uf, lat, lng, chave: normalizar(`${nome}`) }));

// Remove acento, pontuação e caixa para casar "sao paulo" com "São Paulo".
function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tira os acentos separados pelo NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const grausParaRadianos = (g) => (g * Math.PI) / 180;

// Distância em km entre duas coordenadas (fórmula de Haversine).
function distanciaKm(a, b) {
  if (!a || !b) return null;
  if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return null;

  const dLat = grausParaRadianos(b.lat - a.lat);
  const dLng = grausParaRadianos(b.lng - a.lng);
  const lat1 = grausParaRadianos(a.lat);
  const lat2 = grausParaRadianos(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * RAIO_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Resolve texto livre ("Campinas", "campinas sp", "Campinas - SP") em coordenada.
function resolverCidade(texto) {
  const alvo = normalizar(texto);
  if (!alvo) return null;

  // A UF pode vir grudada no fim: "campinas sp"
  const partes = alvo.split(' ');
  const ultimaEhUf = partes.length > 1 && partes[partes.length - 1].length === 2;
  const ufInformada = ultimaEhUf ? partes[partes.length - 1].toUpperCase() : null;
  const semUf = ultimaEhUf ? partes.slice(0, -1).join(' ') : alvo;

  const candidatas = ufInformada
    ? CIDADES.filter((c) => c.uf === ufInformada)
    : CIDADES;

  return (
    candidatas.find((c) => c.chave === semUf) ||
    candidatas.find((c) => c.chave === alvo) ||
    candidatas.find((c) => c.chave.startsWith(semUf)) ||
    candidatas.find((c) => c.chave.includes(semUf)) ||
    null
  );
}

// Ponto de referência a partir do que o cliente mandou.
// Aceita { lat, lng } explícitos ou { cidade: 'texto' }.
function resolverPonto({ lat, lng, cidade } = {}) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if ([lat, lng].every(v => v !== null && v !== undefined && String(v).trim() !== '') &&
      Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
      Number.isFinite(longitude) && Math.abs(longitude) <= 180) {
    return { lat: latitude, lng: longitude, rotulo: cidade || 'Sua localização', origem: 'gps' };
  }
  const municipio = resolverCidade(cidade);
  if (municipio) {
    return {
      lat: municipio.lat,
      lng: municipio.lng,
      rotulo: `${municipio.nome} - ${municipio.uf}`,
      origem: 'cidade',
    };
  }
  return null;
}

// Sugestões para o autocomplete do formulário.
function sugerirCidades(termo, limite = 8) {
  const alvo = normalizar(termo);
  if (!alvo) return [];
  const comeca = [];
  const contem = [];
  for (const c of CIDADES) {
    if (c.chave.startsWith(alvo)) comeca.push(c);
    else if (c.chave.includes(alvo)) contem.push(c);
    if (comeca.length >= limite) break;
  }
  return [...comeca, ...contem]
    .slice(0, limite)
    .map((c) => ({ nome: c.nome, uf: c.uf, lat: c.lat, lng: c.lng, rotulo: `${c.nome} - ${c.uf}` }));
}

module.exports = {
  CIDADES,
  normalizar,
  distanciaKm,
  resolverCidade,
  resolverPonto,
  sugerirCidades,
};
