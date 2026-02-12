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

function normalizeRestartPolicy(value) {
  const policy = String(value || '').trim().toLowerCase()
  if (!policy || policy === 'none') {
    return 'no'
  }
  return policy
}

function isNameConflictError(err) {
  const message = String(err?.message || '').toLowerCase()
  return message.includes('already in use') || message.includes('conflict')
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
  const [migrationFromNodeId, setMigrationFromNodeId] = useState('')
  const [migrationToNodeId, setMigrationToNodeId] = useState('')
  const [migrationKeepSource, setMigrationKeepSource] = useState(false)
  const [migrationCount, setMigrationCount] = useState(0)
  const [migrationCountLoading, setMigrationCountLoading] = useState(false)
  const [migrationLoading, setMigrationLoading] = useState(false)
  const [migrationError, setMigrationError] = useState('')
  const [migrationResults, setMigrationResults] = useState([])
  const nodesList = Array.isArray(nodes) ? nodes : []

  const connectedNodes = useMemo(
    () => nodesList.filter((node) => node.status === 'connected'),
    [nodesList],
  )
  const connectedNodeIds = useMemo(
    () => connectedNodes.map((node) => node.node_id),
    [connectedNodes],
  )

  const selectedNodes = useMemo(() => {
    const selected = new Set(selectedNodeIds)
    return nodesList.filter((node) => selected.has(node.node_id))
  }, [nodesList, selectedNodeIds])

  useEffect(() => {
    if (!open) {
      return
    }
    setRunResults([])
    setRunError('')
    setScanError('')
    setMatches([])
    setMigrationError('')
    setMigrationResults([])
    setMigrationCount(0)
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

  useEffect(() => {
    if (!open) {
      return
    }
    if (connectedNodes.length === 0) {
      setMigrationFromNodeId('')
      return
    }
    setMigrationFromNodeId((prev) => {
      if (connectedNodes.some((node) => node.node_id === prev)) {
        return prev
      }
      return connectedNodes[0].node_id
    })
  }, [open, connectedNodes])

  useEffect(() => {
    if (!open) {
      return
    }
    const candidates = connectedNodes.filter((node) => node.node_id !== migrationFromNodeId)
    if (candidates.length === 0) {
      setMigrationToNodeId('')
      return
    }
    setMigrationToNodeId((prev) => {
      if (candidates.some((node) => node.node_id === prev)) {
        return prev
      }
      return candidates[0].node_id
    })
  }, [open, connectedNodes, migrationFromNodeId])

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

  const refreshMigrationCount = async () => {
    if (!migrationFromNodeId) {
      setMigrationCount(0)
      return
    }
    setMigrationCountLoading(true)
    try {
      const res = await apiFetch(`/api/nodes/${migrationFromNodeId}/containers`)
      const data = await res.json()
      const list = Array.isArray(data) ? data : []
      setMigrationCount(list.length)
    } catch (_err) {
      setMigrationCount(0)
    } finally {
      setMigrationCountLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !migrationFromNodeId) {
      return
    }
    refreshMigrationCount()
  }, [open, migrationFromNodeId])

  const buildMigrationPayload = (container, inspect) => {
    const image = String(inspect?.Config?.Image || container?.Image || '').trim()
    const originalName = String(inspect?.Name || '').replace(/^\//, '') || containerPrimaryName(container)
    const restartPolicy = normalizeRestartPolicy(inspect?.HostConfig?.RestartPolicy?.Name)
    const payload = {
      image,
      name: originalName,
      env: Array.isArray(inspect?.Config?.Env) ? inspect.Config.Env : [],
      ports: portsFromInspect(inspect),
      auto_restart: restartPolicy !== 'no',
    }
    if (restartPolicy !== 'no') {
      payload.restart_policy = restartPolicy
    }
    return payload
  }

  const createContainerOnTarget = async (nodeId, payload, fallbackSuffix) => {
    const create = async (nextPayload) => {
      await apiFetch(`/api/nodes/${nodeId}/containers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextPayload),
      })
      return nextPayload.name
    }

    try {
      return await create(payload)
    } catch (err) {
      if (!payload.name || !isNameConflictError(err)) {
        throw err
      }
      const renamedPayload = {
        ...payload,
        name: `${payload.name}-migrated-${fallbackSuffix}`,
      }
      return create(renamedPayload)
    }
  }

  const runNodeMigration = async () => {
    if (!migrationFromNodeId || !migrationToNodeId) {
      setMigrationError('Выберите source и target ноды')
      return
    }
    if (migrationFromNodeId === migrationToNodeId) {
      setMigrationError('Source и target должны быть разными нодами')
      return
    }

    const sourceNode = nodesList.find((node) => node.node_id === migrationFromNodeId)
    const targetNode = nodesList.find((node) => node.node_id === migrationToNodeId)
    const sourceName = safeNodeName(sourceNode)
    const targetName = safeNodeName(targetNode)
    const modeLabel = migrationKeepSource ? 'copy' : 'move'
    if (!window.confirm(`Run ${modeLabel} of all containers from "${sourceName}" to "${targetName}"?`)) {
      return
    }

    setMigrationLoading(true)
    setMigrationError('')
    setMigrationResults([])
    try {
      const sourceRes = await apiFetch(`/api/nodes/${migrationFromNodeId}/containers`)
      const sourceData = await sourceRes.json()
      const sourceContainers = Array.isArray(sourceData) ? sourceData : []
      setMigrationCount(sourceContainers.length)
      if (sourceContainers.length === 0) {
        setMigrationError('На source-ноде нет контейнеров для миграции')
        return
      }

      const results = []
      for (let i = 0; i < sourceContainers.length; i += 1) {
        const container = sourceContainers[i]
        const containerID = String(container?.Id || '')
        const shortID = containerID.slice(0, 12)
        const containerName = containerPrimaryName(container) || shortID
        try {
          const inspectRes = await apiFetch(`/api/nodes/${migrationFromNodeId}/containers/${containerID}/inspect`)
          const inspect = await inspectRes.json()
          const payload = buildMigrationPayload(container, inspect)
          if (!payload.image) {
            throw new Error('image not found in inspect')
          }
          const finalName = await createContainerOnTarget(migrationToNodeId, payload, `${i + 1}`)

          if (!migrationKeepSource) {
            await apiFetch(`/api/nodes/${migrationFromNodeId}/containers/${containerID}`, { method: 'DELETE' })
          }

          const baseMessage = `created on ${targetName}${finalName ? ` as ${finalName}` : ''}`
          results.push({
            key: `${migrationFromNodeId}:${containerID}`,
            ok: true,
            nodeName: sourceName,
            containerId: shortID,
            containerName,
            message: migrationKeepSource ? `${baseMessage}; source kept` : `${baseMessage}; removed from source`,
          })
        } catch (err) {
          results.push({
            key: `${migrationFromNodeId}:${containerID}`,
            ok: false,
            nodeName: sourceName,
            containerId: shortID,
            containerName,
            message: err.message || 'migration failed',
          })
        }
      }

      setMigrationResults(results)
      const failed = results.filter((result) => !result.ok).length
      if (failed > 0) {
        setMigrationError(`Миграция завершена с ошибками: ${failed} из ${results.length}`)
      }
      if (typeof onRefresh === 'function') {
        onRefresh()
      }
      await refreshMigrationCount()
    } catch (err) {
      setMigrationError(err.message || 'Не удалось выполнить миграцию')
    } finally {
      setMigrationLoading(false)
    }
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-2 backdrop-blur-sm sm:p-4">
      <Card className="mt-2 flex h-[92vh] max-h-[92vh] w-full max-w-7xl flex-col border-zinc-700 bg-zinc-950 sm:mt-0 sm:h-[90vh] sm:max-h-[90vh]">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-zinc-100">Orchestrator Mode</CardTitle>
            <p className="mt-1 text-xs text-zinc-500">
              Массовые операции по контейнерам на выбранных серверах без изменений агента
            </p>
          </div>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </CardHeader>

        <CardContent className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto lg:grid-cols-4">
          <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-zinc-200">Target Nodes</h4>
              <Badge variant="default">{selectedNodeIds.length}/{nodesList.length}</Badge>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setSelectedNodeIds(connectedNodeIds)}>Connected</Button>
              <Button size="sm" variant="outline" onClick={() => setSelectedNodeIds(nodesList.map((n) => n.node_id))}>All</Button>
              <Button size="sm" variant="outline" onClick={() => setSelectedNodeIds([])}>Clear</Button>
            </div>
            <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
              {nodesList.map((node) => (
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
            <div className="rounded-lg border border-orange-900/40 bg-orange-500/5 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-zinc-100">Node Migration</h4>
                <Badge variant="default">{migrationCountLoading ? '...' : migrationCount} containers</Badge>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Source Node
                  </label>
                  <select
                    className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-200 focus:border-orange-500 focus:outline-none"
                    value={migrationFromNodeId}
                    onChange={(e) => setMigrationFromNodeId(e.target.value)}
                  >
                    {connectedNodes.map((node) => (
                      <option key={node.node_id} value={node.node_id}>
                        {safeNodeName(node)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Target Node
                  </label>
                  <select
                    className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-200 focus:border-orange-500 focus:outline-none"
                    value={migrationToNodeId}
                    onChange={(e) => setMigrationToNodeId(e.target.value)}
                  >
                    {connectedNodes.filter((node) => node.node_id !== migrationFromNodeId).map((node) => (
                      <option key={node.node_id} value={node.node_id}>
                        {safeNodeName(node)}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 self-end text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    className="accent-orange-500"
                    checked={migrationKeepSource}
                    onChange={(e) => setMigrationKeepSource(e.target.checked)}
                  />
                  Keep source containers (copy mode)
                </label>
                <div className="flex gap-2 self-end">
                  <Button variant="outline" onClick={refreshMigrationCount} disabled={!migrationFromNodeId || migrationCountLoading || migrationLoading}>
                    Refresh
                  </Button>
                  <Button
                    variant="danger"
                    onClick={runNodeMigration}
                    disabled={migrationLoading || connectedNodes.length < 2 || !migrationFromNodeId || !migrationToNodeId}
                  >
                    {migrationLoading ? 'Migrating...' : 'Migrate All'}
                  </Button>
                </div>
              </div>
              <p className="mt-3 text-xs text-zinc-500">
                Migration without agent changes: copies image/env/ports/restart policy and then removes source container in move mode.
              </p>
              {migrationError && <div className="mt-3 rounded-md border border-rose-800/60 bg-rose-500/10 p-2 text-sm text-rose-300">{migrationError}</div>}
              <div className="mt-3 max-h-52 space-y-2 overflow-auto pr-1">
                {migrationResults.map((result) => (
                  <div key={result.key} className="rounded-md border border-zinc-800 bg-zinc-950 p-2 text-xs">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="truncate font-semibold text-zinc-200">{result.containerName}</span>
                      <Badge variant={result.ok ? 'success' : 'danger'}>{result.ok ? 'ok' : 'fail'}</Badge>
                    </div>
                    <p className="font-mono text-zinc-500">{result.containerId}</p>
                    <p className="mt-1 break-words text-zinc-400">{result.message}</p>
                  </div>
                ))}
                {migrationResults.length === 0 && (
                  <p className="text-xs text-zinc-500">Migration results will appear here.</p>
                )}
              </div>
            </div>

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
