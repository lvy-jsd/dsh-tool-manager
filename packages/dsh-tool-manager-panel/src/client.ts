// dsh-tool-manager-panel — browser half.
//
// A classic script, not a module: tsc only strips the types (see
// tsconfig.client.json), with no bundler. Registers one native section in the
// Settings page sidebar ("Tool manager" / "工具管理") and renders it with React, styled
// only with the host's theme variables (--dsw-alias-*), so it follows every DSH
// theme, light and dark. All data comes from the server half's same-origin
// JSON API (/tool-manager/api) and its event stream (/tool-manager/events).
//
// Copy is registered with the host locale service in English and Chinese and
// switches with the DSH interface language. Category names are translated;
// group and tool names are identifiers and stay as they are.

// The host surface this file touches, described by use: the host's own types
// for these are merge-extensible maps that other packages augment, which a
// standalone build cannot see.
interface ModuleLoader {
  load(registration: { id: string, factory: (require: (specifier: string) => unknown) => Record<string, unknown> }): void
}
type Translate = (key: string) => string
interface PanelSlots {
  inject(name: string, fn: () => () => void): () => void
  register(spec: Record<string, unknown>, component: import('react').ComponentType<{ t?: Translate }>): () => void
}
interface PanelLocale {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): void
  bind(namespace: string): Translate
}
interface ClientContext {
  get(name: string): unknown
  effect(fn: () => void | (() => void), label?: string): void
}

;(window as unknown as { __ModuleLoader__: ModuleLoader }).__ModuleLoader__.load({
  id: '@lvy-jsd/dsh-tool-manager-panel',
  factory: (require) => {
    const React = require('react') as typeof import('react')
    type ReactNode = import('react').ReactNode
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    // JSON shapes of the server half's API (see index.ts).
    interface NodeJson {
      kind: 'root' | 'category' | 'group' | 'tool' | 'missing'
      path: string
      name?: string
      description?: string
      summary?: string
      toolCount?: number
      tokens?: number
      highRisk?: boolean
      children?: NodeJson[]
    }
    interface FoundTool {
      name: string
      short: string
      path: string
      category: string
      group: string
      summary: string
      tokens: number
      highRisk: boolean
    }
    interface SessionRow {
      id: string
      parentId: string | null
      exempt: boolean
      visible: number | null
      wireTokens: number
      loadedTools: string[]
      groups: string[]
    }
    interface ConfigJson {
      pinned?: string[]
      entryTools?: string[]
      extraPinned?: string[]
      unpinned?: string[]
      highRisk?: string[]
      settingsFile?: string
      hasSettings?: boolean
    }
    interface ExtensionsJson {
      classifiers?: { name: string, priority: number }[]
      filters?: string[]
      riskGates?: string[]
      stateProviders?: string[]
      categories?: string[]
    }
    type Load = (targets: string[]) => Promise<void>
    type Unload = (sessionId: string, targets: string[]) => Promise<void>
    type SaveSettings = (patch: { pinned?: string[], unpin?: string[], highRisk?: string[] }, label: string) => Promise<void>

    const ID = 'tool-manager'
    const NS = 'tool-manager.panel'
    const API = '/tool-manager/api'
    const EVENTS = '/tool-manager/events'

    const en: Record<string, string> = {
      nav: 'Tool manager',
      title: 'Tool manager',
      intro: 'Browse the tool directory, see what each session has loaded and what it costs, and check the configuration.',
      'tab.directory': 'Directory',
      'tab.sessions': 'Sessions',
      'tab.config': 'Configuration',
      stat: '{n} live session(s) · {tokens} in context',
      offline: 'Panel service offline',
      loading: 'Loading…',
      error: 'Panel error: {message}',
      root: 'root',
      search: 'Search all tools…',
      noMatch: 'No tools match.',
      noPath: 'No such path: {path}',
      tools: '{n} tools',
      tool: '1 tool',
      tokens: '~{n} tok',
      highRisk: 'high risk',
      load: 'Load',
      unload: 'Unload',
      select: 'Select',
      selected: 'Selected',
      selectAll: 'Select all',
      clearSelection: 'Clear',
      selectedCount: '{n} selected',
      loadSelected: 'Load selected',
      unloadSelected: 'Unload selected',
      noSession: 'No live session to load into.',
      loaded: 'Loaded {targets}. Hover for details.',
      unloaded: 'Unloaded {targets}.',
      loadFailed: 'Load failed: {message}',
      unloadFailed: 'Unload failed: {message}',
      noSessions: 'No live sessions right now. Open a conversation, then come back.',
      subagentOf: 'subagent of {id}',
      visible: '{n} visible',
      exempt: 'exempt',
      exemptHint: 'Model route listed in exemptProviders: this session is never narrowed.',
      exemptNote: 'Exempt route (exemptProviders): every tool is visible; nothing is narrowed.',
      sent: '{tokens} sent',
      groups: 'Groups',
      loadedTools: 'Tools',
      nothingLoaded: 'Nothing loaded: only the always-on tools are visible.',
      'config.title': 'Configuration',
      'config.pinned': 'Always-on tools',
      'config.pinnedValue': '{n} ({entry} entry tools)',
      'config.defaults': 'Built-in always-on',
      'config.extraPinned': 'Extra always-on',
      'config.unpinned': 'Removed from always-on',
      'config.highRisk': 'High risk',
      'config.empty': 'One tool name per line, or comma-separated',
      'config.save': 'Save',
      'config.saving': 'Saving…',
      'config.revert': 'Revert',
      'config.saved': 'Saved: {label}.',
      'config.saveFailed': 'Saving {label} failed: {message}',
      'config.storedIn': 'Stored in',
      'config.hasSettings': 'The settings file overrides the plugin config for the lists it sets.',
      'config.noSettings': 'No settings file yet; the plugin config is in effect until you save.',
      'ext.title': 'Extension points',
      'ext.classifier': 'Classifier',
      'ext.priority': 'priority {n}',
      'ext.filter': 'Visibility filter',
      'ext.riskGate': 'Risk gate',
      'ext.stateProvider': 'State provider',
      'ext.categories': 'Categories',
      none: 'none',
      'category.device': 'Devices',
      'category.code': 'Code',
      'category.media': 'Media',
      'category.maps': 'Maps',
      'category.browser': 'Browser',
      'category.memory': 'Memory',
      'category.collaboration': 'Collaboration',
      'category.automation': 'Automation',
      'category.connectors': 'Connectors',
      'category.search': 'Search',
      'category.system': 'System',
      'category.uncategorized': 'Uncategorized',
      'category.capabilities': 'Capability packs',
    }
    const zh: Record<string, string> = {
      nav: '工具管理',
      title: '工具管理',
      intro: '浏览工具目录，查看每个会话加载了哪些工具、占用多少 token，并检查配置。',
      'tab.directory': '目录',
      'tab.sessions': '会话',
      'tab.config': '配置',
      stat: '{n} 个活动会话 · 上下文中 {tokens}',
      offline: '面板服务离线',
      loading: '加载中…',
      error: '面板出错：{message}',
      root: '根目录',
      search: '搜索全部工具…',
      noMatch: '没有匹配的工具。',
      noPath: '路径不存在：{path}',
      tools: '{n} 个工具',
      tool: '1 个工具',
      tokens: '约 {n} token',
      highRisk: '高危',
      load: '加载',
      unload: '卸载',
      select: '选择',
      selected: '已选择',
      selectAll: '全选',
      clearSelection: '清除',
      selectedCount: '已选 {n} 项',
      loadSelected: '加载选中',
      unloadSelected: '卸载选中',
      noSession: '没有可加载的活动会话。',
      loaded: '已加载 {targets}。悬停查看详情。',
      unloaded: '已卸载 {targets}。',
      loadFailed: '加载失败：{message}',
      unloadFailed: '卸载失败：{message}',
      noSessions: '当前没有活动会话。先开一个对话，再回到这里。',
      subagentOf: '{id} 的子 agent',
      visible: '可见 {n} 个',
      exempt: '豁免',
      exemptHint: '该会话的模型路线在 exemptProviders 中，不做收窄。',
      exemptNote: '豁免路线（exemptProviders）：所有工具都可见，不做收窄。',
      sent: '已发送 {tokens}',
      groups: '组',
      loadedTools: '工具',
      nothingLoaded: '尚未加载任何内容：只有常驻工具可见。',
      'config.title': '配置',
      'config.pinned': '常驻工具',
      'config.pinnedValue': '{n} 个（其中入口工具 {entry} 个）',
      'config.defaults': '内置常驻',
      'config.extraPinned': '额外常驻',
      'config.unpinned': '移出常驻',
      'config.highRisk': '高危',
      'config.empty': '每行一个工具名，也可用逗号分隔',
      'config.save': '保存',
      'config.saving': '保存中…',
      'config.revert': '还原',
      'config.saved': '已保存：{label}。',
      'config.saveFailed': '保存{label}失败：{message}',
      'config.storedIn': '保存位置',
      'config.hasSettings': '配置文件会覆盖插件配置中同名列表。',
      'config.noSettings': '尚未生成配置文件；保存之前仍使用插件配置。',
      'ext.title': '扩展点',
      'ext.classifier': '分类器',
      'ext.priority': '优先级 {n}',
      'ext.filter': '可见性过滤器',
      'ext.riskGate': '高危审批',
      'ext.stateProvider': '状态保存',
      'ext.categories': '分类',
      none: '无',
      'category.device': '设备',
      'category.code': '代码',
      'category.media': '媒体',
      'category.maps': '地图',
      'category.browser': '浏览器',
      'category.memory': '记忆',
      'category.collaboration': '协作',
      'category.automation': '自动化',
      'category.connectors': '连接器',
      'category.search': '搜索',
      'category.system': '系统',
      'category.uncategorized': '未分类',
      'category.capabilities': '能力包',
      'categoryDesc.device': '手机、Android、ADB 与桌面控制',
      'categoryDesc.code': '代码托管、仓库与包管理工具',
      'categoryDesc.media': '视频、图片与音频服务',
      'categoryDesc.maps': '地图、地理编码与路线',
      'categoryDesc.browser': '无头浏览器自动化',
      'categoryDesc.memory': '长期记忆与知识库',
      'categoryDesc.collaboration': 'Bot、群聊、队友与其他会话',
      'categoryDesc.automation': '定时任务与自动运行',
      'categoryDesc.connectors': 'MCP 连接器管理',
      'categoryDesc.search': '网页与社交搜索',
      'categoryDesc.system': '主机、系统与密钥',
      'categoryDesc.uncategorized': '尚未被任何分类器归类的工具',
      'categoryDesc.capabilities': '按能力包整体加载的工具组合',
    }

    const CSS = `
.tmp-section{max-width:860px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px}
.tmp-heading{margin:0;font-size:18px;font-weight:600}
.tmp-intro,.tmp-muted{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px}
.tmp-tabs{display:flex;gap:22px;align-items:flex-end;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.tmp-tab{background:none;border:0;padding:7px 1px 9px;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);cursor:pointer;position:relative}
.tmp-tab:hover,.tmp-tab[data-active=true]{color:var(--dsw-alias-label-primary)}
.tmp-tab[data-active=true]:after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-label-primary)}
.tmp-tab:focus-visible,.tmp-btn:focus-visible,.tmp-input:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.tmp-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.tmp-grow{flex:1}
.tmp-stat{font-size:12px;color:var(--dsw-alias-label-secondary)}
.tmp-flash{font-size:12px;min-height:18px;color:var(--dsw-alias-state-business-primary)}
.tmp-list{display:flex;flex-direction:column;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);overflow:hidden}
.tmp-row{display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:13px;border-top:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.tmp-row:first-child{border-top:0}
.tmp-row[data-nav=true]{cursor:pointer}
.tmp-row[data-nav=true]:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tmp-name{font-weight:500;white-space:nowrap}
.tmp-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.tmp-chip{font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.tmp-chip[data-tone=warn]{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary));border-color:var(--dsw-alias-state-warn-primary)}
.tmp-chip[data-tone=ok]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.tmp-btn{font:inherit;font-size:12px;line-height:20px;padding:1px 10px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}
.tmp-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tmp-btn[data-ghost=true]{background:none;border-color:transparent;color:var(--dsw-alias-label-secondary);padding:1px 4px}
.tmp-input{font:inherit;font-size:12px;padding:4px 10px;min-width:220px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.tmp-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.tmp-card{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);padding:12px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:8px}
.tmp-card h3{margin:0;font-size:14px;font-weight:600}
.tmp-table{border-collapse:collapse;font-size:12.5px;width:100%}
.tmp-table th{text-align:left;font-weight:500;color:var(--dsw-alias-label-secondary);padding:4px 12px 4px 0;white-space:nowrap;vertical-align:top}
.tmp-table td{padding:4px 0;font-family:var(--dsw-font-family-mono,ui-monospace,monospace);word-break:break-word}
.tmp-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;padding:12px 0}
.tmp-field{display:flex;flex-direction:column;gap:6px;margin-top:4px}
.tmp-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.tmp-textarea{font:inherit;font-size:12px;font-family:var(--dsw-font-family-mono,ui-monospace,monospace);padding:6px 10px;resize:vertical;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.tmp-textarea::placeholder{color:var(--dsw-alias-label-tertiary)}
.tmp-textarea:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.tmp-mono{font-family:var(--dsw-font-family-mono,ui-monospace,monospace);font-size:12px;color:var(--dsw-alias-label-secondary);margin:0;word-break:break-all}
.tmp-row input[type=checkbox]{flex:none;margin:0;accent-color:var(--dsw-alias-state-business-primary)}
`
    const CSS_ID = '@lvy-jsd/dsh-tool-manager-panel/section.css'
    function ensureCss() {
      if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${CSS_ID}"]`)) return
      const tag = document.createElement('style')
      tag.dataset.plugin = '@lvy-jsd/dsh-tool-manager-panel'
      tag.dataset.pluginCss = CSS_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    async function api<R>(method: string, params?: object): Promise<R & { message?: string }> {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, params: params ?? {} }),
      })
      const body = await res.json() as R & { ok?: boolean, message?: string }
      if (!body.ok) throw new Error(body.message || `HTTP ${res.status}`)
      return body
    }

    /** `t` with {placeholders}; falls back to the key so a missing entry is visible, not blank. */
    const format = (t: Translate, key: string, vars?: Record<string, unknown>): string => {
      let text: unknown = t(key)
      if (typeof text !== 'string' || text === '') text = key
      for (const [k, v] of Object.entries(vars ?? {})) text = (text as string).split(`{${k}}`).join(String(v))
      return text as string
    }
    const tokNumber = (n: number | undefined): string => (n !== undefined && n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n ?? 0))
    // Category descriptions come from the server in English; a translation, when
    // the active dictionary has one, replaces it. English falls through as-is.
    const categoryDescription = (t: Translate, name: string | undefined, fallback: string | undefined): string | undefined => {
      const key = `categoryDesc.${name}`
      const text = t(key)
      return typeof text === 'string' && text && text !== key ? text : fallback
    }
    const categoryLabel = (t: Translate, name: string | undefined): string | undefined => {
      const key = `category.${name}`
      const text = t(key)
      return typeof text === 'string' && text && text !== key ? text : name
    }

    const Chip = ({ tone, title, children }: { tone?: string, title?: string, children?: ReactNode }) => h('span', { className: 'tmp-chip', 'data-tone': tone, title }, children)
    const Button = ({ ghost, onClick, children, title }: { ghost?: boolean, onClick?: () => void, children?: ReactNode, title?: string }) =>
      h('button', { type: 'button', className: 'tmp-btn', 'data-ghost': ghost === true, onClick, title }, children)

    function Directory({ t, path, setPath, load, unload, version }: { t: Translate, path: string, setPath: (path: string) => void, load: Load, unload: (targets: string[]) => Promise<void>, version: number }) {
      const [root, setRoot] = useState<NodeJson | null>(null)
      const [results, setResults] = useState<FoundTool[] | null>(null)
      const [query, setQuery] = useState('')
      const [error, setError] = useState<string | null>(null)
      // Targets ticked for a batch load/unload. Targets are node paths (which
      // the core resolves to a whole group) or tool names, never both for the
      // same row, so a click on any row is unambiguous.
      const [checked, setChecked] = useState<string[]>([])

      useEffect(() => {
        let live = true
        setResults(null)
        api<{ root: NodeJson }>('tree', { path })
          .then((body) => { if (live) { setRoot(body.root); setError(null) } })
          .catch((e: Error) => { if (live) setError(e.message) })
        return () => { live = false }
      }, [path, version])

      // Selection is per directory listing: navigating elsewhere would leave
      // ticks pointing at rows that are no longer on screen.
      useEffect(() => { setChecked([]) }, [path, version])

      const search = (event: import('react').KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter') return
        const q = query.trim()
        if (!q) { setResults(null); return }
        api<{ results: FoundTool[] }>('search', { query: q }).then((body) => setResults(body.results)).catch((e: Error) => setError(e.message))
      }

      const toggle = (target: string) => setChecked((all) => (all.includes(target) ? all.filter((x) => x !== target) : [...all, target]))

      const parts = path.split('/').filter(Boolean)
      const crumbs: ReactNode[] = [h(Button, { key: 'root', ghost: true, onClick: () => setPath('/') }, t('root'))]
      parts.forEach((part, i) => {
        const target = `/${parts.slice(0, i + 1).join('/')}`
        crumbs.push(h('span', { key: `s${i}`, className: 'tmp-muted' }, '/'))
        crumbs.push(h(Button, { key: target, ghost: true, onClick: () => setPath(target) }, i === 0 ? categoryLabel(t, part) : part))
      })
      const bar = h('div', { className: 'tmp-bar' }, ...crumbs, h('span', { className: 'tmp-grow' }),
        checked.length
          ? h('span', { className: 'tmp-stat' }, format(t, 'selectedCount', { n: checked.length }))
          : null,
        checked.length
          ? h(Button, { onClick: () => load(checked).then(() => setChecked([])) }, t('loadSelected'))
          : null,
        checked.length
          ? h(Button, { onClick: () => unload(checked).then(() => setChecked([])) }, t('unloadSelected'))
          : null,
        checked.length ? h(Button, { ghost: true, onClick: () => setChecked([]) }, t('clearSelection')) : null,
        h('input', {
          className: 'tmp-input', type: 'search', value: query, placeholder: t('search'),
          onChange: (e: import('react').ChangeEvent<HTMLInputElement>) => setQuery(e.target.value), onKeyDown: search,
        }))

      if (error) return h('div', null, bar, h('div', { className: 'tmp-empty' }, format(t, 'error', { message: error })))
      if (results) {
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, bar,
          results.length === 0
            ? h('div', { className: 'tmp-empty' }, t('noMatch'))
            : h('div', { className: 'tmp-list' }, results.map((tool) => h('div', { key: tool.name, className: 'tmp-row' },
              h('input', { type: 'checkbox', checked: checked.includes(tool.name), onChange: () => toggle(tool.name), 'aria-label': tool.name }),
              h('span', { className: 'tmp-name' }, tool.path || `/${tool.category}/${tool.group}/${tool.short}`),
              h(Chip, null, format(t, 'tokens', { n: tokNumber(tool.tokens) })),
              tool.highRisk ? h(Chip, { tone: 'warn' }, t('highRisk')) : null,
              h('span', { className: 'tmp-desc', title: tool.summary }, tool.summary),
              h(Button, { onClick: () => load([tool.name]) }, t('load')),
            ))))
      }
      if (!root) return h('div', null, bar, h('div', { className: 'tmp-empty' }, t('loading')))
      if (root.kind === 'missing') return h('div', null, bar, h('div', { className: 'tmp-empty' }, format(t, 'noPath', { path })))

      const rows = root.kind === 'tool' ? [root] : root.children ?? []
      const targets = rows.map((node) => (node.kind === 'tool' ? node.name! : node.path))
      const allChecked = targets.length > 0 && targets.every((x) => checked.includes(x))
      const header = rows.length > 1
        ? h('div', { className: 'tmp-bar' },
          h(Button, { ghost: true, onClick: () => setChecked(allChecked ? [] : targets) }, allChecked ? t('clearSelection') : t('selectAll')))
        : null
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, bar, header,
        h('div', { className: 'tmp-list' }, rows.map((node) => {
          const isTool = node.kind === 'tool'
          const target = isTool ? node.name! : node.path
          const label = node.kind === 'category' ? categoryLabel(t, node.name) : node.name
          const description = node.kind === 'category' ? categoryDescription(t, node.name, node.description) : node.description || node.summary
          return h('div', {
            key: node.path ?? node.name, className: 'tmp-row', 'data-nav': !isTool,
            onClick: isTool ? undefined : (e: import('react').MouseEvent) => { if ((e.target as HTMLElement).tagName !== 'BUTTON') setPath(node.path) },
          },
          h('input', { type: 'checkbox', checked: checked.includes(target), onChange: () => toggle(target), 'aria-label': target }),
          h('span', { className: 'tmp-name' }, label + (isTool ? '' : '/')),
          h(Chip, null, isTool ? t('tool') : format(t, 'tools', { n: node.toolCount ?? 0 })),
          h(Chip, null, format(t, 'tokens', { n: tokNumber(node.tokens) })),
          node.highRisk ? h(Chip, { tone: 'warn' }, t('highRisk')) : null,
          h('span', { className: 'tmp-desc', title: description }, description || ''),
          h(Button, { onClick: () => load([target]) }, t('load')),
          )
        })))
    }

    function Sessions({ t, sessions, selected, setSelected, unload }: { t: Translate, sessions: SessionRow[] | null, selected: string | null, setSelected: (id: string) => void, unload: Unload }) {
      if (!sessions) return h('div', { className: 'tmp-empty' }, t('loading'))
      if (sessions.length === 0) return h('div', { className: 'tmp-empty' }, t('noSessions'))
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, sessions.map((s) =>
        h('div', { key: s.id, className: 'tmp-card' },
          h('div', { className: 'tmp-bar' },
            h('span', { className: 'tmp-name' }, s.id.replace(/^session-/, '').slice(0, 8)),
            s.parentId ? h(Chip, null, format(t, 'subagentOf', { id: s.parentId.replace(/^session-/, '').slice(0, 8) })) : null,
            s.exempt
              ? h(Chip, { tone: 'warn', title: t('exemptHint') }, t('exempt'))
              : h(Chip, null, format(t, 'visible', { n: s.visible ?? 0 })),
            h(Chip, { tone: 'ok' }, format(t, 'sent', { tokens: format(t, 'tokens', { n: tokNumber(s.wireTokens) }) })),
            h('span', { className: 'tmp-grow' }),
            h(Button, { ghost: s.id !== selected, onClick: () => setSelected(s.id) }, s.id === selected ? t('selected') : t('select')),
          ),
          s.groups.length
            ? h('div', { className: 'tmp-bar' }, h('span', { className: 'tmp-muted' }, `${t('groups')}:`),
              ...s.groups.map((g) => h('span', { key: g, className: 'tmp-bar' }, h(Chip, null, g),
                h(Button, { ghost: true, onClick: () => unload(s.id, [`/${g}`]) }, t('unload')))))
            : null,
          s.loadedTools.length
            ? h('div', { className: 'tmp-bar' }, h('span', { className: 'tmp-muted' }, `${t('loadedTools')}:`),
              ...s.loadedTools.map((name) => h('span', { key: name, className: 'tmp-bar' }, h(Chip, null, name),
                h(Button, { ghost: true, onClick: () => unload(s.id, [name]) }, t('unload')))))
            : null,
          s.exempt
            ? h('p', { className: 'tmp-muted' }, t('exemptNote'))
            : !s.groups.length && !s.loadedTools.length ? h('p', { className: 'tmp-muted' }, t('nothingLoaded')) : null,
        )))
    }

    /**
     * Editable settings. Each list is saved on its own, because the core merges
     * a patch per key: editing one list never rewrites the others.
     */
    function Config({ t, save, external }: { t: Translate, save: SaveSettings, external: number }) {
      const [data, setData] = useState<{ config: ConfigJson, ext: ExtensionsJson } | null>(null)
      const [error, setError] = useState<string | null>(null)
      const [drafts, setDrafts] = useState<Record<string, string>>({})
      const [version, setVersion] = useState(0)
      const [busy, setBusy] = useState<string | null>(null)

      useEffect(() => {
        Promise.all([api<{ config: ConfigJson }>('config'), api<ExtensionsJson>('extensions')])
          .then(([c, e]) => {
            setData({ config: c.config, ext: e })
            setDrafts({
              pinned: (c.config.extraPinned ?? []).join('\n'),
              unpin: (c.config.unpinned ?? []).join('\n'),
              highRisk: (c.config.highRisk ?? []).join('\n'),
            })
            setError(null)
          })
          .catch((e: Error) => setError(e.message))
        // `external` bumps when another panel tab or an outside edit changed the
        // settings, so this tab reloads instead of showing stale values.
      }, [version, external])

      if (error) return h('div', { className: 'tmp-empty' }, format(t, 'error', { message: error }))
      if (!data) return h('div', { className: 'tmp-empty' }, t('loading'))
      const { config, ext } = data
      const list = (xs: string[] | undefined) => (xs && xs.length ? xs.join(', ') : t('none'))
      const row = (k: string, v: ReactNode, key?: string) => h('tr', { key: key ?? k }, h('th', null, k), h('td', null, v))

      // Names may be typed one per line or comma-separated; duplicates and
      // blanks are dropped so the saved list matches what the core expects.
      const parse = (text: string) => [...new Set(text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))]
      const editor = (key: string, label: string) => h('div', { className: 'tmp-field' },
        h('label', { className: 'tmp-label' }, label),
        h('textarea', {
          className: 'tmp-textarea', rows: 3, value: drafts[key] ?? '', spellCheck: false,
          placeholder: t('config.empty'),
          onChange: (e: import('react').ChangeEvent<HTMLTextAreaElement>) => setDrafts((d) => ({ ...d, [key]: e.target.value })),
        }),
        h('div', { className: 'tmp-bar' },
          h(Button, {
            onClick: async () => {
              setBusy(key)
              try {
                await save({ [key]: parse(drafts[key] ?? '') }, label)
                setVersion((v) => v + 1)
              } finally {
                setBusy(null)
              }
            },
          }, busy === key ? t('config.saving') : t('config.save')),
          h(Button, { ghost: true, onClick: () => setVersion((v) => v + 1) }, t('config.revert')),
        ),
      )

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'tmp-card' }, h('h3', null, t('config.title')),
          h('table', { className: 'tmp-table' }, h('tbody', null,
            row(t('config.pinned'), format(t, 'config.pinnedValue', { n: (config.pinned ?? []).length, entry: (config.entryTools ?? []).length })),
            row(t('config.defaults'), list(config.pinned)),
          )),
          editor('pinned', t('config.extraPinned')),
          editor('unpin', t('config.unpinned')),
          editor('highRisk', t('config.highRisk')),
          h('p', { className: 'tmp-muted' }, t('config.storedIn')),
          h('p', { className: 'tmp-mono' }, config.settingsFile ?? ''),
          h('p', { className: 'tmp-muted' }, config.hasSettings ? t('config.hasSettings') : t('config.noSettings'))),
        h('div', { className: 'tmp-card' }, h('h3', null, t('ext.title')),
          h('table', { className: 'tmp-table' }, h('tbody', null,
            ...(ext.classifiers ?? []).map((c) => row(t('ext.classifier'), `${c.name} · ${format(t, 'ext.priority', { n: c.priority })}`, `c:${c.name}`)),
            ...(ext.filters ?? []).map((f) => row(t('ext.filter'), String(f), `f:${f}`)),
            ...(ext.riskGates ?? []).map((g) => row(t('ext.riskGate'), String(g), `g:${g}`)),
            ...(ext.stateProviders ?? []).map((p) => row(t('ext.stateProvider'), String(p), `p:${p}`)),
            row(t('ext.categories'), (ext.categories ?? []).map((c) => categoryLabel(t, c)).join(', '), 'categories'),
          ))))
    }

    function ToolManagerSection({ t }: { t: Translate }) {
      ensureCss()
      const [tab, setTab] = useState('directory')
      const [path, setPath] = useState('/')
      const [sessions, setSessions] = useState<SessionRow[] | null>(null)
      const [selected, setSelected] = useState<string | null>(null)
      const [version, setVersion] = useState(0)
      const [settingsVersion, setSettingsVersion] = useState(0)
      const [flash, setFlash] = useState<{ message: string, detail?: string } | null>(null)
      const [offline, setOffline] = useState(false)
      const timer = useRef(0)

      // The core's load/unload text is written for the model (English); the panel
      // shows its own localized line and keeps that text as the tooltip.
      const say = useCallback((message: string, detail?: string) => {
        setFlash({ message, detail })
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setFlash(null), 6000)
      }, [])

      const refreshSessions = useCallback(() => {
        api<{ sessions: SessionRow[] }>('sessions')
          .then((body) => { setSessions(body.sessions); setOffline(false) })
          .catch(() => setOffline(true))
      }, [])

      useEffect(() => {
        refreshSessions()
        const interval = setInterval(refreshSessions, 15000)
        let events: EventSource | undefined
        try {
          events = new EventSource(EVENTS)
          events.addEventListener('state', refreshSessions)
          events.addEventListener('catalog', () => setVersion((v) => v + 1))
          events.addEventListener('config', () => setSettingsVersion((v) => v + 1))
        } catch {
          // No event stream: the interval still refreshes.
        }
        return () => { clearInterval(interval); events?.close(); clearTimeout(timer.current) }
      }, [refreshSessions])

      const target = selected ?? sessions?.[0]?.id ?? null
      const load: Load = async (targets) => {
        if (!target) return say(t('noSession'))
        try {
          const body = await api<object>('load', { sessionId: target, targets })
          say(format(t, 'loaded', { targets: targets.join(', ') }), body.message)
          refreshSessions()
        } catch (e) {
          say(format(t, 'loadFailed', { message: (e as Error).message }))
        }
      }
      const unload: Unload = async (sessionId, targets) => {
        try {
          const body = await api<object>('unload', { sessionId, targets })
          say(format(t, 'unloaded', { targets: targets.join(', ') }), body.message)
          refreshSessions()
        } catch (e) {
          say(format(t, 'unloadFailed', { message: (e as Error).message }))
        }
      }
      /** Batch unload from the Directory tab, which acts on the selected session. */
      const unloadInDirectory = async (targets: string[]) => {
        if (!target) return say(t('noSession'))
        await unload(target, targets)
      }
      const save: SaveSettings = async (patch, label) => {
        try {
          await api<object>('updateConfig', { settings: patch })
          say(format(t, 'config.saved', { label }))
        } catch (e) {
          say(format(t, 'config.saveFailed', { message: (e as Error).message }))
          throw e
        }
      }

      const totalTokens = (sessions ?? []).reduce((n, s) => n + (s.wireTokens ?? 0), 0)
      const tabs = ['directory', 'sessions', 'config']
      return h('div', { className: 'tmp-section' },
        h('h2', { className: 'tmp-heading' }, t('title')),
        h('p', { className: 'tmp-intro' }, t('intro')),
        h('div', { className: 'tmp-tabs', role: 'tablist' },
          ...tabs.map((id) => h('button', {
            key: id, type: 'button', role: 'tab', className: 'tmp-tab', 'data-active': tab === id, 'aria-selected': tab === id,
            onClick: () => setTab(id),
          }, t(`tab.${id}`))),
          h('span', { className: 'tmp-grow' }),
          h('span', { className: 'tmp-stat', style: { paddingBottom: 9 } },
            offline ? t('offline') : format(t, 'stat', { n: (sessions ?? []).length, tokens: format(t, 'tokens', { n: tokNumber(totalTokens) }) }))),
        h('div', { className: 'tmp-flash', role: 'status', title: flash?.detail }, flash?.message ?? ''),
        tab === 'directory' ? h(Directory, { t, path, setPath, load, unload: unloadInDirectory, version })
          : tab === 'sessions' ? h(Sessions, { t, sessions, selected: target, setSelected, unload })
            : h(Config, { t, save, external: settingsVersion }),
      )
    }

    const inject = ['slots', 'locale']

    function apply(ctx: ClientContext) {
      const slots = ctx.get('slots') as PanelSlots | undefined
      const locale = ctx.get('locale') as PanelLocale | undefined
      if (slots === undefined) return
      if (locale) ctx.effect(() => locale.register(NS, { en, zh }), 'tool-manager-panel: dictionaries')
      const bound: Translate = locale ? locale.bind(NS) : (key) => en[key] ?? key
      // The host passes `t` for a slot registered with `locale`; fall back to
      // our own binding so the section renders either way.
      const Section = (props: { t?: Translate }) => h(ToolManagerSection, { ...props, t: props.t ?? bound })
      ctx.effect(() => slots.inject('settings.section', () => slots.register({
        name: 'settings.section',
        id: ID,
        order: 40,
        label: () => bound('nav'),
        locale: NS,
      }, Section)), 'tool-manager-panel: settings section')
    }

    // ToolManagerSection and NS are exported so another entry point (for example
    // dsh-tool-manager-dsbot-entry) can render the same panel elsewhere.
    return { name: ID, inject, apply, ToolManagerSection, NS }
  },
})
