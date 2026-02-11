import { useEffect, useMemo, useState } from 'react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'

function containerPrimaryName(container) {
  if (!container || !Array.isArray(container.Names) || container.Names.length === 0) {
    return ''
  }
  return String(container.Names[0] || '').replace(/^\//, '')
}

function parseEnvInput(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function parsePortsInput(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [host, container] = line.split(':').map((part) => (part || '').trim())
      return { host, container }
    })
    .filter((p) => p.host && p.container)
}

function portsFromInspect(inspect) {
  const bindings = inspect?.HostConfig?.PortBindings || {}
  const ports = []
  for (const [containerPort, hostBindings] of Object.entries(bindings)) {
    const normalizedContainerPort = String(containerPort).split('/')[0]
    if (!Array.isArray(hostBindings)) {
      continue
    }
    for (const hostBinding of hostBindings) {
      const hostPort = String(hostBinding?.HostPort || '').trim()
      if (!hostPort || !normalizedContainerPort) {
        continue
      }
      ports.push({ host: hostPort, container: normalizedContainerPort })
    }
  }
  return ports
}

function safeNodeName(node) {
  const alias = String(node?.name || '').trim()
  if (alias) {
    return alias
  }
  return String(node?.node_id || '').slice(0, 8) + '...'
}

function normalizeNodeToken(node) {
  const raw = String(node?.name || node?.node_id || 'node')
  return raw.replace(/[^a-zA-Z0-9_.-]/g, '-')
}

function resolveNameTemplate(template, node, container, fallback) {
  const value = String(template || '').trim()
  if (!value) {
    return fallback
  }
  return value
    .replaceAll('{node}', normalizeNodeToken(node))
    .replaceAll('{name}', containerPrimaryName(container) || fallback || 'container')
}

function OrchestratorPanel({ open, onClose, token, nodes, onRefresh }) {
  const [selectedNodeIds, setSelectedNodeIds] = useState([])
  const [scanQuery, setScanQuery] = useState('')
  const [action, setAction] = useState('delete')
  const [matches, setMatches] = useState([])
  const [scanError, setScanError] = useState('')
  const [scanLoading, setScanLoading] = useState(false)
  const [runLoading, setRunLoading] = useState(false)
  const [runResults, setRunResults] = useState([])
  const [runError, setRunError] = useState('')

  const [redeployImage, setRedeployImage] = useState('')
  const [redeployName, setRedeployName] = useState('')
  const [redeployEnv, setRedeployEnv] = useState('')
  const [redeployPorts, setRedeployPorts] = useState('')
  const [redeployAutoRestart, setRedeployAutoRestart] = useState(true)

  const connectedNodeIds = useMemo(
    () => nodes.filter((node) => node.status === 'connected').map((node) => node.node_id),
    [nodes],
  )

  const selectedNodes = useMemo(() => {
    const selected = new Set(selectedNodeIds)
    return nodes.filter((node) => selected.has(node.node_id))
  }, [nodes, selectedNodeIds])

  useEffect(() => {
    if (!open) {
      return
    }
    setRunResults([])
    setRunError('')
    setScanError('')
    setMatches([])
    setSelectedNodeIds((prev) => {
      if (prev.length > 0) {
        const filtered = prev.filter((id) => connectedNodeIds.includes(id))
        if (filtered.length > 0) {
          return filtered
        }
      }
      return connectedNodeIds
    })
  }, [open, connectedNodeIds])

  if (!open) {
    return null
  }

  const authHeaders = {
    Authorization: `Bearer ${token}`,
  }

  const apiFetch = async (path, options = {}) => {
    const res = await fetch(path, {
      ...options,
      headers: {
        ...authHeaders,
        ...(options.headers || {}),
      },
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || `Request failed: ${res.status}`)
    }
    return res
  }

  const toggleNode = (nodeId) => {
    setSelectedNodeIds((prev) => {
      if (prev.includes(nodeId)) {
        return prev.filter((id) => id !== nodeId)
      }
      return [...prev, nodeId]
    })
  }

  const scanContainers = async () => {
    if (selectedNodes.length === 0) {
      setScanError('Выберите хотя бы одну ноду')
      return
    }

    setScanLoading(true)
    setScanError('')
    setRunResults([])
    setRunError('')
    try {
      const query = scanQuery.trim().toLowerCase()
      const resultChunks = await Promise.all(
        selectedNodes.map(async (node) => {
          const res = await apiFetch(`/api/nodes/${node.node_id}/containers`)
          const containers = await res.json()
          return { node, containers: Array.isArray(containers) ? containers : [] }
        }),
      )

      const nextMatches = []
      for (const chunk of resultChunks) {
        for (const container of chunk.containers) {
          const haystack = [
            container.Id,
            container.Image,
            container.Status,
            container.State,
            Array.isArray(container.Names) ? container.Names.join(' ') : '',
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
          if (!query || haystack.includes(query)) {
            nextMatches.push({
              key: `${chunk.node.node_id}:${container.Id}`,
              nodeId: chunk.node.node_id,
              nodeName: safeNodeName(chunk.node),
              container,
            })
          }
        }
      }

      nextMatches.sort((a, b) => {
        if (a.nodeName < b.nodeName) return -1
        if (a.nodeName > b.nodeName) return 1
        return a.container.Id.localeCompare(b.container.Id)
      })
      setMatches(nextMatches)
    } catch (err) {
      setScanError(err.message || 'Не удалось получить список контейнеров')
      setMatches([])
    } finally {
      setScanLoading(false)
    }
  }

  const runSimpleAction = async (match) => {
    if (action === 'start') {
      await apiFetch(`/api/nodes/${match.nodeId}/containers/${match.container.Id}/start`, { method: 'POST' })
      return 'started'
    }
    if (action === 'stop') {
      await apiFetch(`/api/nodes/${match.nodeId}/containers/${match.container.Id}/stop`, { method: 'POST' })
      return 'stopped'
    }
    await apiFetch(`/api/nodes/${match.nodeId}/containers/${match.container.Id}`, { method: 'DELETE' })
    return 'deleted'
  }

  const runRedeploy = async (match) => {
    const inspectRes = await apiFetch(`/api/nodes/${match.nodeId}/containers/${match.container.Id}/inspect`)
    const inspect = await inspectRes.json()

    const oldName = String(inspect?.Name || '').replace(/^\//, '') || containerPrimaryName(match.container)
    const payload = {
      image: String(redeployImage || '').trim() || inspect?.Config?.Image || match.container.Image,
      name: resolveNameTemplate(redeployName, { node_id: match.nodeId, name: match.nodeName }, match.container, oldName),
      env: String(redeployEnv || '').trim() ? parseEnvInput(redeployEnv) : inspect?.Config?.Env || [],
      ports: String(redeployPorts || '').trim() ? parsePortsInput(redeployPorts) : portsFromInspect(inspect),
      auto_restart: redeployAutoRestart,
    }

    if (!payload.image) {
      throw new Error('Image is required for redeploy')
    }

    try {
      await apiFetch(`/api/nodes/${match.nodeId}/containers/${match.container.Id}/stop`, { method: 'POST' })
    } catch (_err) {
      // ignore stop failure if container is already stopped
    }

    await apiFetch(`/api/nodes/${match.nodeId}/containers/${match.container.Id}`, { method: 'DELETE' })
    await apiFetch(`/api/nodes/${match.nodeId}/containers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return payload.name ? `recreated as ${payload.name}` : 'recreated'
  }

  const runBulkAction = async () => {
    if (matches.length === 0) {
      setRunError('Сначала выполните Scan и выберите контейнеры по фильтру')
      return
    }

    setRunLoading(true)
    setRunError('')
    setRunResults([])

    const results = []
    for (const match of matches) {
      try {
        const message = action === 'redeploy' ? await runRedeploy(match) : await runSimpleAction(match)
        results.push({
          key: match.key,
          ok: true,
          nodeName: match.nodeName,
          containerId: String(match.container.Id || '').slice(0, 12),
          containerName: containerPrimaryName(match.container),
          message,
        })
      } catch (err) {
        results.push({
          key: match.key,
          ok: false,
          nodeName: match.nodeName,
          containerId: String(match.container.Id || '').slice(0, 12),
          containerName: containerPrimaryName(match.container),
          message: err.message || 'operation failed',
        })
      }
    }

    setRunResults(results)
    setRunLoading(false)
    if (typeof onRefresh === 'function') {
      onRefresh()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm sm:p-4">
      <Card className="flex max-h-[92dvh] w-full max-w-7xl flex-col border-zinc-700 bg-zinc-950 sm:max-h-[90vh]">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-zinc-100">Orchestrator Mode</CardTitle>
            <p className="mt-1 text-xs text-zinc-500">
              Массовые операции по контейнерам на выбранных серверах без изменений агента
            </p>
          </div>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </CardHeader>

        <CardContent className="grid flex-1 grid-cols-1 gap-4 overflow-auto lg:grid-cols-4">
          <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-zinc-200">Target Nodes</h4>
              <Badge variant="default">{selectedNodeIds.length}/{nodes.length}</Badge>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setSelectedNodeIds(connectedNodeIds)}>Connected</Button>
              <Button size="sm" variant="outline" onClick={() => setSelectedNodeIds(nodes.map((n) => n.node_id))}>All</Button>
              <Button size="sm" variant="outline" onClick={() => setSelectedNodeIds([])}>Clear</Button>
            </div>
            <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
              {nodes.map((node) => (
                <label key={node.node_id} className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-800 bg-zinc-900 p-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-orange-500"
                    checked={selectedNodeIds.includes(node.node_id)}
                    onChange={() => toggleNode(node.node_id)}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-zinc-200">{safeNodeName(node)}</p>
                    <p className="truncate font-mono text-[11px] text-zinc-500">{node.node_id}</p>
                    <p className="truncate text-[11px] text-zinc-500">{node.remote_addr}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 lg:col-span-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Container Filter
                </label>
                <Input
                  placeholder="e.g. nginx or ghcr.io/org/app"
                  value={scanQuery}
                  onChange={(e) => setScanQuery(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Action
                </label>
                <select
                  className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-200 focus:border-orange-500 focus:outline-none"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  <option value="delete">Delete</option>
                  <option value="stop">Stop</option>
                  <option value="start">Start</option>
                  <option value="redeploy">Redeploy (update/rename/params)</option>
                </select>
              </div>
            </div>

            {action === 'redeploy' && (
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-orange-900/50 bg-orange-500/5 p-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    New Image (optional)
                  </label>
                  <Input
                    placeholder="Leave empty to keep current image"
                    value={redeployImage}
                    onChange={(e) => setRedeployImage(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    New Name (optional)
                  </label>
                  <Input
                    placeholder="Supports {node} and {name}"
                    value={redeployName}
                    onChange={(e) => setRedeployName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Ports (host:container per line)
                  </label>
                  <textarea
                    className="h-24 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none"
                    placeholder="8080:80"
                    value={redeployPorts}
                    onChange={(e) => setRedeployPorts(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Env (KEY=VALUE per line)
                  </label>
                  <textarea
                    className="h-24 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none"
                    placeholder="APP_ENV=prod"
                    value={redeployEnv}
                    onChange={(e) => setRedeployEnv(e.target.value)}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-zinc-300 md:col-span-2">
                  <input
                    type="checkbox"
                    className="accent-orange-500"
                    checked={redeployAutoRestart}
                    onChange={(e) => setRedeployAutoRestart(e.target.checked)}
                  />
                  Auto-restart after redeploy
                </label>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={scanContainers} disabled={scanLoading || selectedNodeIds.length === 0}>
                {scanLoading ? 'Scanning...' : 'Scan Containers'}
              </Button>
              <Button variant="outline" onClick={() => { setMatches([]); setRunResults([]); setRunError('') }}>
                Clear Results
              </Button>
              <Button
                variant="danger"
                onClick={runBulkAction}
                disabled={runLoading || matches.length === 0}
              >
                {runLoading ? 'Running...' : `Run on ${matches.length} containers`}
              </Button>
            </div>

            {scanError && <div className="rounded-md border border-rose-800/60 bg-rose-500/10 p-2 text-sm text-rose-300">{scanError}</div>}
            {runError && <div className="rounded-md border border-rose-800/60 bg-rose-500/10 p-2 text-sm text-rose-300">{runError}</div>}

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-zinc-200">Matched Containers</h4>
                  <Badge>{matches.length}</Badge>
                </div>
                <div className="max-h-64 space-y-2 overflow-auto pr-1">
                  {matches.map((match) => (
                    <div key={match.key} className="rounded-md border border-zinc-800 bg-zinc-950 p-2 text-xs">
                      <p className="font-semibold text-zinc-200">{match.nodeName}</p>
                      <p className="font-mono text-zinc-500">{String(match.container.Id || '').slice(0, 12)}</p>
                      <p className="truncate text-zinc-400">{match.container.Image}</p>
                      <p className="truncate text-zinc-500">{containerPrimaryName(match.container)}</p>
                    </div>
                  ))}
                  {matches.length === 0 && (
                    <p className="text-xs text-zinc-500">No results yet. Run Scan Containers.</p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-zinc-200">Execution Results</h4>
                  <Badge>{runResults.length}</Badge>
                </div>
                <div className="max-h-64 space-y-2 overflow-auto pr-1">
                  {runResults.map((result) => (
                    <div key={result.key} className="rounded-md border border-zinc-800 bg-zinc-950 p-2 text-xs">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="truncate font-semibold text-zinc-200">{result.nodeName}</span>
                        <Badge variant={result.ok ? 'success' : 'danger'}>{result.ok ? 'ok' : 'fail'}</Badge>
                      </div>
                      <p className="font-mono text-zinc-500">{result.containerId}</p>
                      <p className="truncate text-zinc-500">{result.containerName}</p>
                      <p className="mt-1 break-words text-zinc-400">{result.message}</p>
                    </div>
                  ))}
                  {runResults.length === 0 && (
                    <p className="text-xs text-zinc-500">Bulk action results will appear here.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default OrchestratorPanel
