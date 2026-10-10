import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from '@vue/compiler-sfc'
import { parse as parseTemplate, NodeTypes, type TemplateChildNode } from '@vue/compiler-dom'
import ts from 'typescript'
import { catalogs, zhCN } from '../src/shared/i18n'
import { BLEND_MODES } from '../src/shared/contracts'
import { FILTER_NAMES } from '../src/shared/image-filters'

const issues: { file: string; text: string; kind: string }[] = []
const keys = new Set<string>(), files = (await readdir('src/renderer')).filter(name => name.endsWith('.vue'))
const technicalText = new Set(['English', 'px', 'RGB', 'RGBA', 'HSV', 'HSL', 'Hex', 'sRGB', 'DPI', 'MCP', 'API', 'Aa', 'CMYK', 'ONNX', 'U²-NetP', 'PNG', 'JPEG', 'PDF', 'ZH', 'EN'])
// These are glyph specimens, not interface messages. Keep Latin and Chinese glyphs in both locales.
const glyphSamples = new Set(['Aa Bb · 文字预览 0123', 'Aa Bb · 文字 0123'])
function visible(text: string) { return /[a-zA-Z]{2}/.test(text) && !technicalText.has(text) && !glyphSamples.has(text) }
function expression(source: string, file: string) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ['t', 'tm'].includes(node.expression.getText(ast))) {
      const first = node.arguments[0]
      if (first && ts.isStringLiteralLike(first)) keys.add(first.text)
    }
    ts.forEachChild(node, visit)
  }; visit(ast)
}
for (const name of files) {
  const file = join('src/renderer', name), { descriptor } = parse(await readFile(file, 'utf8'), { filename: file })
  if (descriptor.scriptSetup) expression(descriptor.scriptSetup.content, file)
  if (!descriptor.template) continue
  const ast = parseTemplate(descriptor.template.content)
  function visit(node: TemplateChildNode): void {
    if (node.type === NodeTypes.TEXT) {
      const text = node.content.replace(/\s+/g, ' ').trim()
      if (visible(text)) issues.push({ file, text, kind: 'untranslated-template-text' })
    } else if (node.type === NodeTypes.INTERPOLATION) expression(node.content.loc.source, file)
    else if (node.type === NodeTypes.ELEMENT) {
      for (const prop of node.props) {
        if (prop.type === NodeTypes.ATTRIBUTE && ['title', 'aria-label', 'placeholder', 'alt'].includes(prop.name) && prop.value && visible(prop.value.content)) issues.push({ file, text: prop.value.content, kind: 'untranslated-visible-attribute' })
        else if (prop.type === NodeTypes.DIRECTIVE && prop.exp) expression(prop.exp.loc.source, file)
      }
      for (const child of node.children) visit(child)
    }
  }
  for (const child of ast.children) visit(child)
}
expression(await readFile('src/main/index.ts', 'utf8'), 'src/main/index.ts')
// Built-in history labels are stored in canonical English; localize only their display.
// This deliberately excludes caller-supplied task labels and document/layer names.
for (const file of ['src/core/editor.ts', 'src/core/pixel-actions.ts', 'src/core/mask-operations.ts', 'src/core/selection-transform.ts']) {
  const ast = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true)
  function collect(node: ts.Node): void {
    if (ts.isStringLiteral(node) && /^[A-Z][A-Za-z -]+$/.test(node.text)) keys.add(node.text)
    ts.forEachChild(node, collect)
  }
  function visit(node: ts.Node): void {
    if (ts.isReturnStatement(node) && node.expression) collect(node.expression)
    if (ts.isBinaryExpression(node) && node.left.getText(ast) === 'label') collect(node.right)
    ts.forEachChild(node, visit)
  }
  visit(ast)
}
for (const key of [...keys, ...BLEND_MODES, ...Object.values(FILTER_NAMES)]) if (!Object.hasOwn(zhCN, key) && !technicalText.has(key)) issues.push({ file: 'catalogs', text: key, kind: 'missing-chinese-message' })
const seen = new Map<string, string>()
for (const catalog of catalogs) for (const [source, translated] of Object.entries(catalog)) {
  if (seen.has(source) && seen.get(source) !== translated) issues.push({ file: 'catalogs', text: source, kind: 'conflicting-translation' })
  seen.set(source, translated)
  const params = (text: string) => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort()
  if (JSON.stringify(params(source)) !== JSON.stringify(params(translated))) issues.push({ file: 'catalogs', text: source, kind: 'placeholder-mismatch' })
}
const report = { status: issues.length ? 'FAIL' : 'PASS', vueComponents: files.length, uniqueMessages: Object.keys(zhCN).length, literalMessageKeys: keys.size, issues }
await mkdir('artifacts/i18n', { recursive: true }); await writeFile('artifacts/i18n/source-audit.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (issues.length) process.exitCode = 1
