// Renders index.html to PNG frames: node render.js <outDir> [fps] [t1,t2,...]
const path = require('path');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
(async () => {
  const [out = 'frames', fps = '30', only] = process.argv.slice(2);
  const fs = require('fs'); fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + path.resolve(__dirname, 'index.html') + '?render' + (process.env.CAPTIONS ? '&captions' : ''), { waitUntil: 'load' });
  await p.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
  const times = only ? only.split(',').map(Number) : [...Array(30 * +fps).keys()].map(i => i / +fps);
  for (let i = 0; i < times.length; i++) {
    await p.evaluate(t => window.render(t), times[i]);
    await p.screenshot({ path: `${out}/f${String(i).padStart(4, '0')}.png` });
  }
  await b.close();
})();
