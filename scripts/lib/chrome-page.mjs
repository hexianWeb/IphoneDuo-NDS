import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// 离线美术生成/检查共用的独立浏览器；不连接或修改用户的 Chrome 页面。
export async function withChromePage({ chromePath, tempRoot, prefix = 'duo-labels-' }, run) {
  assert.ok(chromePath && tempRoot, '需要 Chrome 路径和已有临时目录')
  const output = await mkdtemp(join(tempRoot, prefix))
  const chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${join(output, 'profile')}`, 'about:blank'], { stdio: 'ignore', windowsHide: true })
  let launchError
  chrome.once('error', error => { launchError = error })
  let socket
  let nextId = 0
  const pending = new Map()
  const errors = []
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 60000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
    return response.result.value
  }
  try {
    let target
    for (let i = 0; i < 60; i++) {
      try {
        const port = (await readFile(join(output, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0].trim()
        target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page => page.type === 'page')
        if (target) break
      } catch {}
      if (launchError) throw launchError
      if (chrome.exitCode !== null) throw new Error(`Chrome 提前退出：${chrome.exitCode}`)
      await delay(200)
    }
    assert.ok(target, 'Chrome CDP 未启动')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    socket.addEventListener('message', ({ data }) => {
      const event = JSON.parse(data)
      if (event.id) {
        const item = pending.get(event.id)
        if (!item) return
        clearTimeout(item.timer)
        pending.delete(event.id)
        if (event.error) item.reject(new Error(JSON.stringify(event.error)))
        else item.resolve(event.result)
      } else if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails)
      else if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') errors.push(event.params.args.map(arg => arg.value || arg.description).join(' '))
    })
    await send('Runtime.enable')
    await send('Page.enable')
    return await run({ output, send, evaluate, errors })
  } finally {
    if (socket?.readyState === 1) {
      try { await send('Browser.close') } catch {}
      socket.close()
    }
    chrome.kill()
    for (const item of pending.values()) clearTimeout(item.timer)
  }
}
