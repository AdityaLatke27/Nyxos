// Opens the Landing and Compare pages in a headless browser and checks that the key results appear.
// Needs playwright (npm i -D playwright, then npx playwright install chromium). Starts its own dev server on port 5199.
const { spawn } = require('child_process')
const { chromium } = require('playwright')
const BASE = 'http://127.0.0.1:5199'
const fails = []
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' : ' + detail : ''}`); if (!ok) fails.push(name) }

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE); if (r.ok) return } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('dev server did not start')
}

;(async () => {
  const server = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { stdio: 'ignore' })
  let browser
  try {
    await waitServer()
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE}/app/landing?map=2d`, { waitUntil: 'load' })
    await page.waitForSelector('.ld-access', { timeout: 300000 })
    const text = await page.evaluate(() => document.body.innerText)
    check('landing: verdict headline', /Not suitable|feasible|Conditionally|cannot be assessed/i.test(text))
    check('landing: access strip', /Longest without sunlight/.test(text) && /Neither Sun nor Earth/.test(text))
    check('landing: time to next sunset/Earthset', /From landing:/.test(text))
    check('landing: power row', /Solar power and battery/.test(text))
    check('landing: link row', /Direct-to-Earth link margin/.test(text))
    check('landing: sources and limits shown', /Boulders and small craters/.test(text))

    await page.selectOption('label:has-text("Place") select', 'm-ch3')
    await page.waitForFunction(() => /Chandrayaan-3/.test(document.querySelector('h2')?.parentElement?.innerText || document.body.innerText) && /terrain model is coarse/.test(document.body.innerText), null, { timeout: 300000 })
    check('landing: other-mission site analysed with a coarse-terrain warning', true)
    await page.selectOption('label:has-text("Place") select', { index: 1 })
    await page.click('button:has-text("Guided tour")')
    check('tour: opens with live numbers', await page.evaluate(() => /Step 1 of 5/.test(document.body.innerText) && /peaks at -?\d/.test(document.body.innerText)))
    for (let k = 0; k < 4; k++) await page.click('.ld-tour-nav button:has-text("Next")')
    check('tour: last step links to Compare', await page.evaluate(() => /Step 5 of 5/.test(document.body.innerText) && !!document.querySelector('.ld-tour-link')))
    await page.keyboard.press('Escape')
    check('tour: Escape closes it', await page.evaluate(() => !document.querySelector('.ld-tour')))

    await page.goto(`${BASE}/app/compare`, { waitUntil: 'load' })
    await page.waitForFunction(() => document.querySelectorAll('.cmp-table thead th').length >= 3 && !document.querySelector('.cmp-prog'), null, { timeout: 300000 })
    const cols = await page.evaluate(() => document.querySelectorAll('.cmp-table thead th').length - 1)
    check('compare sites: at least two columns', cols >= 2, `${cols} columns`)
    check('compare sites: no combined score', !(await page.evaluate(() => /overall (score|rating)|total score|best site|#1\b|\brank(ed)? \d/i.test(document.body.innerText))))

    await page.click('.cmp-mode button:nth-child(2)')
    await page.waitForFunction(() => /\+7 d/.test(document.querySelector('.cmp-table thead')?.textContent || '') && !document.querySelector('.cmp-prog'), null, { timeout: 300000 })
    const dateCols = await page.evaluate(() => document.querySelectorAll('.cmp-table thead th').length - 1)
    check('compare dates: base plus slips', dateCols >= 4, `${dateCols} columns`)
    check('compare dates: Earth-in-view row', await page.evaluate(() => /Earth in view/.test(document.body.innerText)))

    await page.goto(`${BASE}/app/history`, { waitUntil: 'load' })
    await page.waitForSelector('.hs-timeline')
    await page.waitForSelector('.hs-dot')
    const dotsAll = await page.evaluate(() => document.querySelectorAll('.hs-dot').length)
    check('history: landing dots on the Moon map', dotsAll >= 12, `${dotsAll} dots`)
    check('history: Apollo 11 links into the Crater tab', await page.evaluate(() => [...document.querySelectorAll('a')].some((a) => /\/app\/\?site=apollo-11&view=stand/.test(a.getAttribute('href') ?? ''))))
    check('history: other missions link with a picked point', await page.evaluate(() => [...document.querySelectorAll('a')].some((a) => /\/app\/\?at=-69\.37,32\.32/.test(a.getAttribute('href') ?? ''))))
    await page.fill('.hs-slider input', '1970')
    const dots1970 = await page.evaluate(() => document.querySelectorAll('.hs-dot').length)
    check('history: slider hides later missions', dots1970 < dotsAll && dots1970 === 2, `${dots1970} dots in 1970`)
    await page.click('.hs-chip >> text=Robots')
    check('history: filter chip works', await page.evaluate(() => !/Apollo 11: first/.test(document.querySelector('.hs-timeline').innerText)))
    await page.click('.hs-opt >> nth=1')
    check('history: quiz gives feedback', await page.evaluate(() => /Yes!/.test(document.querySelector('.hs-why-a')?.innerText ?? '')))
    check('history: no NASA Eyes frame until asked', await page.evaluate(() => !document.querySelector('iframe')))
    await page.click('.hs-chip >> text=Everything')
    await page.fill('.hs-slider input', '2026')
    await page.click('.hs-dot >> nth=0')
    check('history: map dot opens the mission card', await page.evaluate(() => !!document.querySelector('.hs-item.open .hs-panel:not([hidden]) .hs-grid')))
    check('history: card shows launch date and purpose', await page.evaluate(() => /Launched/.test(document.querySelector('.hs-item.open').innerText) && /Purpose/.test(document.querySelector('.hs-item.open').innerText)))
    await page.click('.hs-item.open .hs-btn >> text=Fly there in NASA Eyes')
    check('history: NASA Eyes loads for that mission only', await page.evaluate(() => document.querySelectorAll('iframe').length === 1 && /eyes\.nasa\.gov.*time=/.test(document.querySelector('iframe').src)))
    await page.click('.hs-head >> nth=2')
    check('history: cards open and close', await page.evaluate(() => document.querySelectorAll('.hs-item.open').length === 1))
    await page.goto(`${BASE}/`, { waitUntil: 'load' })
    await page.waitForSelector('.hero-cta.ghost', { state: 'attached' })
    await page.evaluate(() => document.querySelector('.hero-cta.ghost').click())
    check('home: How it works opens a dialog with four steps', await page.evaluate(() => document.querySelectorAll('.hiw-card .hiw-steps li').length === 4))
    await page.keyboard.press('Escape')
    check('home: Escape closes the dialog', await page.evaluate(() => !document.querySelector('.hiw-card')))
    await page.goto(`${BASE}/app/history`, { waitUntil: 'load' })
    await page.waitForSelector('.hs-timeline')
    check('history: nav has History, no Data item', await page.evaluate(() => /History/.test(document.querySelector('.nav-rail').innerText) && !/Data/.test(document.querySelector('.nav-rail').innerText)))
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  } catch (e) {
    check('smoke run', false, e.message)
  } finally {
    if (browser) await browser.close()
    server.kill()
  }
  console.log(fails.length ? `\n${fails.length} check(s) failed` : '\nall checks passed')
  process.exit(fails.length ? 1 : 0)
})()
