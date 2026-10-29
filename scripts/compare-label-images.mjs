import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withChromePage } from './lib/chrome-page.mjs'

// 对比独立验收目录，不修改资源或主应用。8-bit RGB/RGBA 绝对差，不将差值称为百分比。
// node scripts/compare-label-images.mjs <Chrome> <已有临时目录> <旧验收目录> <新验收目录>
const [chromePath, tempRoot, before, after] = process.argv.slice(2)
assert.ok(before && after, '需要两套截图目录')
const files = [
  ...['PartsLegend', 'ProductPlaqueLabel', 'InternalComponentsLegend', 'InternalComponentNames', 'GameLibraryLabel'].map(name => `label-${name}.png`),
  ...['classic', 'retro', 'midnight'].flatMap(theme => ['hero', 'play'].map(view => `${theme}-${view}.png`)),
]
const optionalFiles = ['classic', 'retro', 'midnight', 'custom'].map(name => `label-dock-${name}.png`)
for (const file of optionalFiles) {
  try { await readFile(join(before, file)); await readFile(join(after, file)); files.push(file) } catch {}
}
await withChromePage({ chromePath, tempRoot, prefix: 'duo-label-diff-' }, async ({ evaluate, output }) => {
  const results = []
  for (const file of files) {
    const images = await Promise.all([before, after].map(async root => 'data:image/png;base64,' + (await readFile(join(root, file))).toString('base64')))
    const diff = await evaluate(`(async () => {
      const read=async src => {
        const img=new Image(); img.src=src; await img.decode()
        const canvas=document.createElement('canvas'); canvas.width=img.width; canvas.height=img.height
        const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0)
        return {width:img.width,height:img.height,data:ctx.getImageData(0,0,img.width,img.height).data}
      }
      const [a,b]=await Promise.all(${JSON.stringify(images)}.map(read))
      if(a.width!==b.width||a.height!==b.height) throw Error('图片尺寸不同')
      let total=0,max=0,changed=0
      for(let i=0;i<a.data.length;i++) { const d=Math.abs(a.data[i]-b.data[i]); total+=d; max=Math.max(max,d); if(d)changed++ }
      return {width:a.width,height:a.height,mean:total/a.data.length,max,changedChannels:changed}
    })()`)
    results.push({ file, ...diff })
  }
  await writeFile(join(output, 'report.json'), JSON.stringify({ before, after, results }, null, 2))
  console.log(JSON.stringify({ output, results }, null, 2))
  for (const result of results.filter(result => result.file.startsWith('label-'))) assert.equal(result.mean, 0, `标签像素发生变化：${result.file}`)
  for (const result of results.filter(result => !result.file.startsWith('label-'))) assert.ok(result.mean < 0.15, `场景截图差异需排查：${result.file}`)
})
