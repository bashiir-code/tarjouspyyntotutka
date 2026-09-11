// Records a real session against the running app (http://localhost:5173) and logs event timestamps,
// so the Remotion composition can cut and speed up the parts where the agent is working.
// Usage: NODE_PATH=<dir with playwright> node video/record.cjs
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const PUBLIC = path.join(__dirname, 'public')
const W = 1440
const H = 900
const QUESTIONS = [
  'Onko viimeisen puolen vuoden aikana tullut Azure-osaamiseen liittyviä kilpailutuksia, joiden arvo on alle 500 000 €?',
  'Arvioi, sopiiko ensimmäinen niistä meidän kyvykkyysprofiiliimme.',
]

// Headless recordings have no cursor; draw one so viewers can follow clicks.
const CURSOR = `
  window.addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div')
    c.style.cssText = 'position:fixed;z-index:99999;width:22px;height:22px;margin:-4px 0 0 -4px;pointer-events:none;left:-50px;top:-50px;transition:transform .12s'
    c.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 3l7 17 2.5-7L21 10z" fill="#16161a" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    document.body.appendChild(c)
    addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
    addEventListener('mousedown', () => c.style.transform = 'scale(.8)', true)
    addEventListener('mouseup', () => c.style.transform = 'scale(1)', true)
  })`

async function moveTo(page, locator) {
  const b = await locator.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 })
}

// Smoothly scroll the chat pane from the start of the latest answer to the bottom.
async function readAnswer(page) {
  const pane = page.locator('main > div.overflow-y-auto')
  await page.waitForTimeout(1200) // let the app's own auto-scroll settle
  const target = await page.evaluate(() => {
    const pane = document.querySelector('main > div.overflow-y-auto')
    const turns = document.querySelectorAll('[id^="turn-"]')
    const last = turns[turns.length - 1]
    return last.offsetTop - 16
  })
  await pane.evaluate((el, top) => el.scrollTo({ top, behavior: 'smooth' }), target)
  await page.waitForTimeout(1500)
  await moveTo(page, pane)
  for (let i = 0; i < 400; i++) {
    const atBottom = await pane.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2)
    if (atBottom) break
    await page.mouse.wheel(0, 14)
    await page.waitForTimeout(16)
  }
}

;(async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: PUBLIC, size: { width: W, height: H } },
  })
  await context.addInitScript(CURSOR)
  const page = await context.newPage()
  const t0 = Date.now()
  const events = []
  const mark = (name) => {
    events.push({ name, ms: Date.now() - t0 })
    console.log(name, Date.now() - t0)
  }

  await page.goto('http://localhost:5173')
  await page.waitForSelector('input')
  mark('loaded')
  await page.waitForTimeout(1500)

  for (const [i, q] of QUESTIONS.entries()) {
    const input = page.locator('input')
    await moveTo(page, input)
    await input.click()
    mark(`type${i + 1}`)
    await input.pressSequentially(q, { delay: 38 })
    await page.waitForTimeout(400)
    await moveTo(page, page.locator('button[aria-label="Lähetä"]'))
    await page.locator('button[aria-label="Lähetä"]').click()
    mark(`sent${i + 1}`)
    await page.locator('text=työvaihetta').nth(i).waitFor({ timeout: 300000 })
    mark(`answer${i + 1}`)
    await readAnswer(page)
    mark(`read${i + 1}`)
    const card = page.locator('main a.group').last()
    if (await card.count()) {
      await moveTo(page, card)
      await page.waitForTimeout(1200)
    }
    mark(`done${i + 1}`)
  }

  await page.waitForTimeout(800)
  mark('end')
  const video = page.video()
  await context.close()
  await browser.close()
  fs.renameSync(await video.path(), path.join(PUBLIC, 'session.webm'))
  fs.writeFileSync(path.join(__dirname, 'src', 'events.json'), JSON.stringify(events, null, 2))
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
