// Смоук-тест прототипа: фейковый микрофон Chromium = interview_ru.wav,
// проверяем полный круг страница -> WS -> stt_server(--fake) -> транскрипт.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--use-file-for-fake-audio-capture=/home/claude/spike-kit/interview_48k.wav',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('404')) errors.push('console: ' + m.text());
  });

  await page.goto('http://localhost:8080/capture_prototype.html');
  await page.click('#btnMic');
  await page.waitForFunction(() => document.getElementById('micState').textContent.includes('✅'));

  // headless не умеет захват вкладки — подменяем канал кандидата тем же микрофоном
  await page.evaluate(async () => {
    tabStream = micStream;
    document.getElementById('tabState').textContent = '✅ (stub)';
    checkReady();
  });
  await page.click('#btnStart');
  await page.waitForFunction(() => document.getElementById('wsState').textContent.includes('✅'), { timeout: 5000 });

  // ждём появления финальных сегментов (первая фраза ~7с + латентность)
  await page.waitForFunction(
    () => document.querySelectorAll('#log .seg:not(.partial)').length >= 2,
    { timeout: 40000 },
  );
  const segs = await page.$$eval('#log .seg:not(.partial)', els => els.map(e => e.textContent.trim()));
  const sent = await page.$eval('#sent', e => e.textContent);

  await page.click('#btnStop');
  await page.waitForFunction(() => document.getElementById('stats').textContent.length > 10, { timeout: 8000 });
  const stats = await page.$eval('#stats', e => e.textContent);

  console.log('SENT FRAMES:', sent);
  console.log('SEGMENTS:', JSON.stringify(segs.slice(0, 3), null, 1));
  console.log(stats);
  console.log('JS ERRORS:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
