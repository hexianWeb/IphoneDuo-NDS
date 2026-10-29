import LoadingScreen from './js/Core/LoadingScreen.js'
import Experience from './js/Experience.js'
import './style.css'

const canvas = document.querySelector('.webgl')
const debugPanel = document.querySelector('.debug-panel')
const statusPanel = document.querySelector('.status-panel')
const loading = new LoadingScreen(statusPanel)
const removeLoadingListeners = []

let experience = null

async function start() {
  if (!navigator.gpu) {
    canvas.hidden = true
    debugPanel.hidden = true
    loading.fail('当前浏览器不支持 WebGPU', '请使用最新版 Chrome、Edge 或其他支持 WebGPU 的浏览器。')
    return
  }

  experience = new Experience({ canvas, debugPanel })
  removeLoadingListeners.push(
    experience.events.on('resources:progress', info => loading.setResources(info)),
    experience.events.on('experience:phase', ({ phase }) => loading.setPhase(phase)),
    experience.events.on('experience:scene-progress', ({ progress }) => loading.setProgress(94 + progress * 5)),
  )

  try {
    await experience.init()
    if (!experience.destroyed)
      loading.complete()
  }
  catch (error) {
    if (experience.destroyed)
      return
    console.error(error)
    experience.destroy()
    canvas.hidden = true
    debugPanel.hidden = true
    loading.fail('场景初始化失败', error instanceof Error ? error.message : '发生未知错误。')
  }
}

start()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    removeLoadingListeners.forEach(remove => remove())
    loading.destroy()
    experience?.destroy()
  })
}
