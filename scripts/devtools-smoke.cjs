const fs = require('node:fs')
const path = require('node:path')
const childProcess = require('node:child_process')
const automator = require('miniprogram-automator')

const projectPath = path.resolve(__dirname, '..')
const screenshotDir = path.join(projectPath, 'docs', 'screenshots')
const cliExecutable = 'C:\\Progra~2\\Tencent\\微信web开发者工具\\cli.bat'
const idePort = process.env.WECHAT_IDE_PORT || '35012'
const automatorPort = process.env.WECHAT_AUTOMATOR_PORT || '9420'
const wsEndpoint = `ws://127.0.0.1:${automatorPort}`

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function capture(miniProgram, name) {
  const target = path.join(screenshotDir, name)
  await miniProgram.screenshot({ path: target })
  return target
}

async function navigateWithTimeout(miniProgram, route, method = 'reLaunch') {
  const expectedPath = route.replace(/^\//, '').split('?')[0]
  const bootDeadline = Date.now() + 15000
  while (Date.now() < bootDeadline) {
    const bootPage = await miniProgram.currentPage()
    const bootPath = bootPage && bootPage.path || ''
    if (bootPath === expectedPath) return { completed: true, actualPath: bootPath }
    if (bootPath) break
    await wait(300)
  }
  const navigationFinished = await Promise.race([
    miniProgram[method](route).then(() => true),
    wait(12000).then(() => false),
  ])
  if (!navigationFinished) return { completed: false, actualPath: '' }
  const deadline = Date.now() + 10000
  let actualPath = ''
  while (Date.now() < deadline) {
    const page = await miniProgram.currentPage()
    actualPath = page && page.path || ''
    if (actualPath === expectedPath) return { completed: true, actualPath }
    await wait(300)
  }
  return { completed: false, actualPath }
}

async function main() {
  fs.mkdirSync(screenshotDir, { recursive: true })
  const runtimeErrors = []
  const cliCommand = `${cliExecutable} --port ${idePort} auto --project ${projectPath} --auto-port ${automatorPort} --trust-project`
  const cliProcess = childProcess.spawn(process.env.ComSpec || 'cmd.exe', [
    '/d', '/s', '/c', cliCommand,
  ], { stdio: 'ignore' })
  cliProcess.unref()
  let miniProgram = null
  let connectError = null
  for (let attempt = 0; attempt < 30 && !miniProgram; attempt += 1) {
    try {
      miniProgram = await automator.connect({ wsEndpoint })
    } catch (error) {
      connectError = error
      await wait(1000)
    }
  }
  if (!miniProgram) throw connectError || new Error('无法连接微信开发者工具自动化端口')
  const result = { screenshots: [], pages: {}, runtimeErrors }
  const requestedTarget = process.env.CAPTURE_TARGET || ''
  const afterSaleOrderNo = process.env.AFTERSALE_ORDER_NO || ''
  const targets = [
    ['home', '/pages/home/index', '00-home-real-settings.png', 6000, 'switchTab'],
    ['mall', '/pages/mall/index', '01-mall-real-backend.png', 6000, 'switchTab'],
    ['profile', '/pages/profile/index', '02-profile-real-account.png', 3500, 'switchTab'],
    ['diy', '/pages/diy/index', '03-diy-real-materials.png', 8000, 'reLaunch'],
    ['cart', '/pages/cart/index', '04-cart-real-backend.png', 6000, 'reLaunch'],
    ['orderConfirm', '/pages/cart/order-confirm/index', '05-order-confirm.png', 5000, 'reLaunch'],
    ...(afterSaleOrderNo
      ? [['afterSaleApply', `/pages/profile/after-sale-apply/index?orderNo=${encodeURIComponent(afterSaleOrderNo)}`, '06-after-sale-apply.png', 5000, 'reLaunch']]
      : []),
  ].filter(([key]) => !requestedTarget || key === requestedTarget)
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const [key, route, filename, delay, method] = targets[targetIndex]
    const session = targetIndex === 0
      ? miniProgram
      : await automator.connect({ wsEndpoint })
    session.on('exception', (error) => runtimeErrors.push(String(error && error.message || error)))
    try {
      const navigation = await navigateWithTimeout(session, route, method)
      result.pages[`${key}RouteCompleted`] = navigation.completed
      result.pages[`${key}ActualPath`] = navigation.actualPath
      if (!navigation.completed) {
        throw new Error(`${key} 页面跳转失败，预期 ${route}，实际 ${navigation.actualPath || '未知'}`)
      }
      await wait(delay)
      result.screenshots.push(await capture(session, filename))
    } finally {
      session.disconnect()
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (runtimeErrors.length > 0) process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack || error}\n`)
  process.exitCode = 1
})
