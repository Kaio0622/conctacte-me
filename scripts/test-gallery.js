// Requer Playwright e Chrome. Usa dados locais apenas para leitura.
process.env.DB_DRIVER = 'json';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { criarApp } = require('../src/app');
const db = require('../src/db');

async function main() {
  const perfil = db.buscar('prestadores', p => p.status === 'aprovado' && p.fotos?.length > 1);
  assert.ok(perfil, 'É necessário um perfil local aprovado com várias fotos.');
  const server = criarApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const erros = [];
    const context = await browser.newContext({ viewport: { width: 1584, height: 900 } });
    await context.route('https://fonts.googleapis.com/**', route => route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => erros.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}/#/prestador/${perfil.id}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('#fotoProxima').waitFor();
    async function conferirFoto(indice) {
      await page.waitForFunction(i => {
        const trilha = document.getElementById('galeria');
        const img = trilha?.querySelectorAll('img')[i];
        return img?.complete && img.naturalWidth > 0 && Math.abs(trilha.scrollLeft - i * trilha.clientWidth) < 2;
      }, indice);
      assert.equal(await page.locator('#fotoContador').textContent(), `${indice + 1} / ${perfil.fotos.length}`);
      assert.equal(await page.locator('.galeria-ponto[aria-current="true"]').getAttribute('data-i'), String(indice));
      const medidas = await page.locator('#galeria').evaluate(e => ({ trilha: e.clientWidth, pai: e.parentElement.clientWidth, foto: e.querySelector('img').getBoundingClientRect().width }));
      assert.ok(Math.abs(medidas.trilha - medidas.pai) < 2 && Math.abs(medidas.foto - medidas.trilha) < 2);
    }
    await conferirFoto(0);
    assert.equal(await page.locator('#fotoAnterior').isDisabled(), true);
    for (let i = 1; i < perfil.fotos.length; i++) {
      await page.locator('#fotoProxima').click();
      await conferirFoto(i);
    }
    assert.equal(await page.locator('#fotoProxima').isDisabled(), true);
    await page.locator('#fotoAnterior').click();
    await conferirFoto(perfil.fotos.length - 2);
    await page.locator('.galeria-ponto[data-i="0"]').click();
    await conferirFoto(0);
    await page.locator('#galeria').focus();
    await page.keyboard.press('End');
    await conferirFoto(perfil.fotos.length - 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await conferirFoto(perfil.fotos.length - 1);
    await page.keyboard.press('Home');
    await conferirFoto(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('ArrowRight');
    await conferirFoto(1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.route('https://fonts.googleapis.com/**', route => route.abort());
    const touch = await mobile.newPage();
    await touch.goto(url, { waitUntil: 'domcontentloaded' });
    await touch.locator('#fotoProxima').waitFor();
    const cdp = await mobile.newCDPSession(touch);
    const box = await touch.locator('#galeria').boundingBox();
    const y = box.y + box.height / 2 + 55;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 330, y }] });
    for (const x of [280, 220, 160, 100, 50]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      await touch.waitForTimeout(35);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.waitForFunction(() => document.getElementById('galeria').scrollLeft > 100);

    const resposta = await fetch(`http://127.0.0.1:${server.address().port}/api/prestadores/${perfil.id}`).then(r => r.json());
    for (const quantidade of [1, 0]) {
      await page.route('**/api/prestadores/*', route => route.fulfill({ json: { ...resposta, fotos: resposta.fotos.slice(0, quantidade) } }));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('#galeria').waitFor();
      assert.equal(await page.locator('.galeria-seta').count(), 0);
      assert.equal(await page.locator('#galeria img').count(), quantidade);
      await page.unroute('**/api/prestadores/*');
    }
    assert.deepEqual(erros, []);
    console.log('Galeria: todas as fotos, setas, pontos, teclado, redimensionamento, gesto mobile e perfis com uma/nenhuma foto: OK');
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
