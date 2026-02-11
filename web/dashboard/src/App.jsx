import { useState, useEffect } from 'react'
import Login from './Login'
import OrchestratorPanel from './components/OrchestratorPanel'

function App() {
    const [nodes, setNodes] = useState([])
    const [selectedNode, setSelectedNode] = useState(null)
    const [containers, setContainers] = useState([])
    const [loading, setLoading] = useState(false)
    const [token, setToken] = useState(localStorage.getItem('docklet_token'))
    const [renameName, setRenameName] = useState('')
    const [logsOpen, setLogsOpen] = useState(false)
    const [logsText, setLogsText] = useState('')
    const [logsLoading, setLogsLoading] = useState(false)
    const [logsError, setLogsError] = useState('')
    const [logsContainer, setLogsContainer] = useState(null)
    const [detailsOpen, setDetailsOpen] = useState(false)
    const [detailsContainer, setDetailsContainer] = useState(null)
    const [inspectLoading, setInspectLoading] = useState(false)
    const [inspectText, setInspectText] = useState('')
    const [inspectError, setInspectError] = useState('')
    const [statsLoading, setStatsLoading] = useState(false)
    const [statsText, setStatsText] = useState('')
    const [statsError, setStatsError] = useState('')
    const detailsLoading = inspectLoading || statsLoading
    const [execCmd, setExecCmd] = useState('sh -lc "echo hello"')
    const [execLoading, setExecLoading] = useState(false)
    const [execOut, setExecOut] = useState('')
    const [execError, setExecError] = useState('')
    const [nodeSearch, setNodeSearch] = useState('')
    const [containerSearch, setContainerSearch] = useState('')

    // Create Container State
    const [createOpen, setCreateOpen] = useState(false)
    const [createImage, setCreateImage] = useState('')
    const [createName, setCreateName] = useState('')
    const [createPorts, setCreatePorts] = useState([{ host: '', container: '' }])
    const [createEnv, setCreateEnv] = useState('')
    const [createAutoRestart, setCreateAutoRestart] = useState(true)
    const [createLoading, setCreateLoading] = useState(false)
    const [createError, setCreateError] = useState('')

    // Stack State
    const [stacksOpen, setStacksOpen] = useState(false)
    const [stacks, setStacks] = useState([]) // For listing stacks if we implement listing
    const [stackName, setStackName] = useState('')
    const [stackContent, setStackContent] = useState('')
    const [stackLoading, setStackLoading] = useState(false)
    const [stackError, setStackError] = useState('')

    // Cluster State
    const [clusterOpen, setClusterOpen] = useState(false)
    const [clusterNodeIds, setClusterNodeIds] = useState([])
    const [clusterName, setClusterName] = useState('')
    const [clusterContent, setClusterContent] = useState('')
    const [clusterLoading, setClusterLoading] = useState(false)
    const [clusterError, setClusterError] = useState('')
    const [clusterResults, setClusterResults] = useState([])
    const [clustersList, setClustersList] = useState([])
    const [clustersLoading, setClustersLoading] = useState(false)
    const [clustersError, setClustersError] = useState('')
    const [clusterRenameId, setClusterRenameId] = useState(null)
    const [clusterRenameValue, setClusterRenameValue] = useState('')
    const [orchestratorOpen, setOrchestratorOpen] = useState(false)

    const handleLogin = (newToken) => {
        localStorage.setItem('docklet_token', newToken)
        setToken(newToken)
    }

    const handleLogout = () => {
        localStorage.removeItem('docklet_token')
        setToken(null)
        setNodes([])
        setContainers([])
        setSelectedNode(null)
    }

    const fetchNodes = async () => {
        if (!token) return
        try {
            const res = await fetch('/api/nodes', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.status === 401) {
                handleLogout()
                return
            }
            const data = await res.json()
            setNodes(data.nodes || [])
        } catch (err) {
            console.error("Failed to fetch nodes", err)
        }
    }

    const fetchClusters = async () => {
        if (!token) return
        setClustersLoading(true)
        setClustersError('')
        try {
            const res = await fetch('/api/clusters', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.status === 401) {
                handleLogout()
                return
            }
            if (!res.ok) {
                const text = await res.text()
                throw new Error(text || 'Failed to load clusters')
            }
            const data = await res.json()
            setClustersList(data.clusters || [])
        } catch (e) {
            console.error('clusters error', e)
            setClustersError(e.message)
            setClustersList([])
        } finally {
            setClustersLoading(false)
        }
    }

    const fetchContainers = async (nodeId) => {
        setLoading(true)
        try {
            const res = await fetch(`/api/nodes/${nodeId}/containers`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (!res.ok) throw new Error("Failed")
            const data = await res.json()
            setContainers(data)
        } catch (err) {
            console.error("Failed to fetch containers", err)
            setContainers([])
        } finally {
            setLoading(false)
        }
    }

    const startContainer = async (nodeId, containerId) => {
        try {
            await fetch(`/api/nodes/${nodeId}/containers/${containerId}/start`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
            })
            fetchContainers(nodeId)
        } catch (e) { console.error('start error', e) }
    }

    const stopContainer = async (nodeId, containerId) => {
        try {
            await fetch(`/api/nodes/${nodeId}/containers/${containerId}/stop`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
            })
            fetchContainers(nodeId)
        } catch (e) { console.error('stop error', e) }
    }

    const removeContainer = async (nodeId, containerId) => {
        if (!window.confirm('Are you sure you want to remove this container?')) {
            return
        }
        try {
            await fetch(`/api/nodes/${nodeId}/containers/${containerId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
            })
            fetchContainers(nodeId)
        } catch (e) { console.error('remove error', e) }
    }

    const enableAutoRestart = async (nodeId, containerId) => {
        try {
            const res = await fetch(`/api/nodes/${nodeId}/containers/${containerId}/restart-policy`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ policy: 'unless-stopped' }),
            })
            if (!res.ok) {
                const text = await res.text()
                throw new Error(text || 'Failed')
            }
            fetchContainers(nodeId)
        } catch (e) {
            console.error('restart policy error', e)
            alert('Failed to enable auto-restart: ' + (e.message || 'unknown error'))
        }
    }

    const disableAutoRestart = async (nodeId, containerId) => {
        try {
            const res = await fetch(`/api/nodes/${nodeId}/containers/${containerId}/restart-policy`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ policy: 'no' }),
            })
            if (!res.ok) {
                const text = await res.text()
                throw new Error(text || 'Failed')
            }
            fetchContainers(nodeId)
        } catch (e) {
            console.error('restart policy error', e)
            alert('Failed to disable auto-restart: ' + (e.message || 'unknown error'))
        }
    }

    const deployStack = async () => {
        if (!selectedNode) return
        if (!stackName.trim() || !stackContent.trim()) {
            setStackError('Name and Content required')
            return
        }
        setStackLoading(true)
        setStackError('')
        try {
            const res = await fetch(`/api/nodes/${selectedNode.node_id}/stacks`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: stackName.trim(), content: stackContent }),
            })
            if (!res.ok) {
                const text = await res.text()
                throw new Error(text || 'Failed to deploy stack')
            }
            setStacksOpen(false)
            setStackName('')
            setStackContent('')
            fetchContainers(selectedNode.node_id) // Refresh containers
        } catch (e) {
            console.error('stack error', e)
            setStackError(e.message)
        } finally {
            setStackLoading(false)
        }
    }

    const toggleClusterNode = (nodeId) => {
        setClusterNodeIds((prev) => {
            if (prev.includes(nodeId)) {
                return prev.filter((x) => x !== nodeId)
            }
            return [...prev, nodeId]
        })
    }

    const deployCluster = async () => {
        if (!clusterName.trim() || !clusterContent.trim()) {
            setClusterError('Name and Content required')
            return
        }
        if (clusterNodeIds.length === 0) {
            setClusterError('Select at least one node')
            return
        }

        setClusterLoading(true)
        setClusterError('')
        setClusterResults([])
        try {
            const res = await fetch('/api/clusters/deploy', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: clusterName.trim(),
                    content: clusterContent,
                    nodes: clusterNodeIds,
                }),
            })
            if (!res.ok) {
                const text = await res.text()
                throw new Error(text || 'Failed to deploy cluster')
            }
            const data = await res.json()
            setClusterResults(data.results || [])
            fetchNodes()
            if (selectedNode) fetchContainers(selectedNode.node_id)
            fetchClusters()
        } catch (e) {
            console.error('cluster error', e)
            setClusterError(e.message)
        } finally {
            setClusterLoading(false)
        }
    }

    const startRenameCluster = (cluster) => {
        setClusterRenameId(cluster.id)
        setClusterRenameValue(cluster.name || '')
    }

    const saveRenameCluster = async () => {
        if (!clusterRenameId) return
        const newName = clusterRenameValue.trim()
        if (!newName) return
        try {
            const res = await fetch(`/api/clusters/${clusterRenameId}/rename`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: newName }),
            })
            if (!res.ok) {
                const text = await res.text()
                throw new Error(text || 'Failed to rename cluster')
            }
            setClusterRenameId(null)
            setClusterRenameValue('')
            fetchClusters()
        } catch (e) {
            console.error('rename cluster error', e)
            setClusterError(e.message)
        }
    }

    const deleteCluster = async (cluster) => {
        if (!window.confirm(`Delete cluster "${cluster.name || cluster.stack_name}"? This will run stack_down on selected nodes.`)) {
            return
        }
        setClusterError('')
        try {
            const res = await fetch(`/api/clusters/${cluster.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
            })
            if (!res.ok) {
                const text = await res.text()
                throw new Error(text || 'Failed to delete cluster')
            }
            const data = await res.json()
            if (!data.deleted) {
                setClusterError('Cluster delete was partial. Retry after fixing failing nodes.')
            }
            fetchClusters()
        } catch (e) {
            console.error('delete cluster error', e)
            setClusterError(e.message)
        }
    }

    const fetchLogs = async (nodeId, container) => {
        setLogsOpen(true)
        setLogsLoading(true)
        setLogsError('')
        setLogsText('')
        setLogsContainer(container)
        try {
            const res = await fetch(`/api/nodes/${nodeId}/containers/${container.Id}/logs`, {
                headers: { 'Authorization': `Bearer ${token}` },
            })
            if (!res.ok) throw new Error('Failed')
            const text = await res.text()
            setLogsText(text)
        } catch (e) {
            console.error('logs error', e)
            setLogsError('Failed to load logs')
        } finally {
            setLogsLoading(false)
        }
    }

    const renameNode = async () => {
        if (!selectedNode) return
        const trimmed = renameName.trim()
        if (!trimmed) return
        try {
            const res = await fetch(`/api/nodes/${selectedNode.node_id}/rename`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: trimmed }),
            })
            if (!res.ok) throw new Error('Failed')
            setRenameName('')
            fetchNodes()
        } catch (e) {
            console.error('rename error', e)
        }
    }

    const openDetails = async (nodeId, container) => {
        setDetailsOpen(true)
        setDetailsContainer(container)
        setInspectText('')
        setInspectError('')
        setStatsText('')
        setStatsError('')
        setExecOut('')
        setExecError('')

        setInspectLoading(true)
        setStatsLoading(true)
        try {
            const res = await fetch(`/api/nodes/${nodeId}/containers/${container.Id}/inspect`, {
                headers: { 'Authorization': `Bearer ${token}` },
            })
            if (!res.ok) throw new Error('Failed')
            const data = await res.json()
            setInspectText(JSON.stringify(data, null, 2))
        } catch (e) {
            console.error('inspect error', e)
            setInspectError('Failed to load inspect')
        } finally {
            setInspectLoading(false)
        }

        try {
            const res = await fetch(`/api/nodes/${nodeId}/containers/${container.Id}/stats`, {
                headers: { 'Authorization': `Bearer ${token}` },
            })
            if (!res.ok) throw new Error('Failed')
            const data = await res.json()
            setStatsText(JSON.stringify(data, null, 2))
        } catch (e) {
            console.error('stats error', e)
            setStatsError('Failed to load stats')
        } finally {
            setStatsLoading(false)
        }
    }

    const runExec = async () => {
        if (!selectedNode || !detailsContainer) return
        const trimmed = execCmd.trim()
        if (!trimmed) return
        setExecLoading(true)
        setExecOut('')
        setExecError('')
        try {
            const res = await fetch(`/api/nodes/${selectedNode.node_id}/containers/${detailsContainer.Id}/exec`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ cmd: ['sh', '-lc', trimmed] }),
            })
            if (!res.ok) throw new Error('Failed')
            const text = await res.text()
            setExecOut(text)
        } catch (e) {
            console.error('exec error', e)
            setExecError('Failed to exec')
        } finally {
            setExecLoading(false)
        }
    }

    const handleCreateContainer = async () => {
        if (!selectedNode) return
        if (!createImage.trim()) {
            setCreateError('Image is required')
            return
        }

        setCreateLoading(true)
        setCreateError('')

        // Parse Ports
        const ports = createPorts
            .filter(p => p.host && p.container)
            .map(p => ({ host: p.host, container: p.container }))

        // Parse Env
        const env = createEnv.split('\n').map(l => l.trim()).filter(l => l)

        const payload = {
            image: createImage.trim(),
            name: createName.trim(),
            ports: ports,
            env: env,
            auto_restart: createAutoRestart,
        }

        try {
            const res = await fetch(`/api/nodes/${selectedNode.node_id}/containers`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            })

            if (!res.ok) {
                const text = await res.text()
                throw new Error(text || 'Failed to create container')
            }

            setCreateOpen(false)
            setCreateImage('')
            setCreateName('')
            setCreatePorts([{ host: '', container: '' }])
            setCreateEnv('')
            setCreateAutoRestart(true)
            fetchContainers(selectedNode.node_id)
        } catch (e) {
            console.error('create error', e)
            setCreateError(e.message)
        } finally {
            setCreateLoading(false)
        }
    }

    const addPortRow = () => {
        setCreatePorts([...createPorts, { host: '', container: '' }])
    }

    const updatePortRow = (index, field, value) => {
        const newPorts = [...createPorts]
        newPorts[index][field] = value
        setCreatePorts(newPorts)
    }

    const removePortRow = (index) => {
        const newPorts = [...createPorts]
        newPorts.splice(index, 1)
        setCreatePorts(newPorts)
    }

    const getNodeDisplayName = (node) => {
        if (!node) return 'Unknown node'
        const alias = (node.name || '').trim()
        if (alias) return alias
        if (node.node_id) return `${node.node_id.substring(0, 8)}...`
        return 'Unknown node'
    }

    const nodeQuery = nodeSearch.trim().toLowerCase()
    const filteredNodes = nodes.filter((node) => {
        if (!nodeQuery) return true
        return [
            node.name,
            node.node_id,
            node.remote_addr,
            node.version,
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(nodeQuery)
    })

    const containerQuery = containerSearch.trim().toLowerCase()
    const filteredContainers = containers.filter((container) => {
        if (!containerQuery) return true
        const containerNames = Array.isArray(container.Names) ? container.Names.join(' ') : ''
        return [
            container.Id,
            container.Image,
            container.Status,
            container.State,
            containerNames,
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(containerQuery)
    })

    useEffect(() => {
        if (token) {
            fetchNodes()
            const interval = setInterval(fetchNodes, 5000)
            return () => clearInterval(interval)
        }
    }, [token])

    useEffect(() => {
        if (selectedNode) {
            fetchContainers(selectedNode.node_id)
        }
    }, [selectedNode])

    useEffect(() => {
        if (!selectedNode) return
        const updatedNode = nodes.find((node) => node.node_id === selectedNode.node_id)
        if (!updatedNode) {
            setSelectedNode(null)
            setContainers([])
            return
        }
        if (updatedNode !== selectedNode) {
            setSelectedNode(updatedNode)
        }
    }, [nodes, selectedNode])

    useEffect(() => {
        setRenameName(selectedNode?.name || '')
        setContainerSearch('')
    }, [selectedNode?.node_id, selectedNode?.name])

    if (!token) {
        return <Login onLogin={handleLogin} />
    }

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
                <div className="mb-6 rounded-2xl border border-slate-700/60 bg-gradient-to-r from-slate-900 via-slate-900 to-orange-950/40 p-5 shadow-xl">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-white">Docklet Control Panel</h1>
                            <p className="mt-1 text-sm text-slate-400">Управление нодами и контейнерами в одном окне</p>
                        </div>
                        <button
                            onClick={handleLogout}
                            className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-300 transition-colors hover:bg-rose-500/20"
                        >
                            Logout
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
                    <div className="lg:col-span-1 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur">
                        <div className="mb-4 flex items-center justify-between">
                            <div>
                                <h2 className="text-lg font-semibold text-slate-200">Nodes</h2>
                                <p className="text-xs text-slate-500">{filteredNodes.length} из {nodes.length}</p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setOrchestratorOpen(true)}
                                    disabled={nodes.length === 0}
                                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Orchestrator
                                </button>
                                <button
                                    onClick={() => {
                                        setClusterOpen(true)
                                        setClusterError('')
                                        setClusterResults([])
                                        setClusterNodeIds([])
                                        setClustersError('')
                                        fetchClusters()
                                    }}
                                    disabled={nodes.length === 0}
                                    className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Cluster
                                </button>
                            </div>
                        </div>

                        <div className="mb-4">
                            <input
                                type="text"
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-orange-500 focus:outline-none"
                                placeholder="Поиск: имя, ID, IP"
                                value={nodeSearch}
                                onChange={(e) => setNodeSearch(e.target.value)}
                            />
                        </div>

                        <div className="max-h-[64vh] space-y-3 overflow-auto pr-1">
                            {filteredNodes.map((node) => (
                                <button
                                    key={node.node_id}
                                    onClick={() => setSelectedNode(node)}
                                    className={`w-full rounded-xl border p-3 text-left transition-all ${
                                        selectedNode?.node_id === node.node_id
                                            ? 'border-orange-500 bg-orange-500/10 shadow-lg shadow-orange-900/30'
                                            : 'border-slate-700 bg-slate-800/70 hover:border-slate-500 hover:bg-slate-800'
                                    }`}
                                >
                                    <div className="mb-1 flex items-center justify-between gap-2">
                                        <span className="truncate text-sm font-semibold text-slate-200">{getNodeDisplayName(node)}</span>
                                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                                            node.status === 'connected'
                                                ? 'border border-emerald-700 bg-emerald-500/15 text-emerald-300'
                                                : 'border border-rose-700 bg-rose-500/15 text-rose-300'
                                        }`}>
                                            {node.status}
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-500">
                                        <p className="truncate">ID: {node.node_id}</p>
                                        <p className="truncate">IP: {node.remote_addr}</p>
                                    </div>
                                </button>
                            ))}

                            {filteredNodes.length === 0 && (
                                <p className="py-6 text-center text-sm text-slate-500">
                                    {nodeSearch.trim() ? 'Поиск не дал результатов' : 'Нет подключённых нод'}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="lg:col-span-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur">
                        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 className="text-xl font-semibold text-slate-100">
                                    {selectedNode ? `Containers on ${getNodeDisplayName(selectedNode)}` : 'Select a node'}
                                </h2>
                                {selectedNode && (
                                    <p className="text-xs text-slate-500">{selectedNode.remote_addr}</p>
                                )}
                            </div>
                            {selectedNode && (
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => setStacksOpen(true)}
                                        className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-500"
                                    >
                                        Stacks (Compose)
                                    </button>
                                    <button
                                        onClick={() => setCreateOpen(true)}
                                        className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-500"
                                    >
                                        Launch
                                    </button>
                                </div>
                            )}
                        </div>

                        {selectedNode && (
                            <div className="mb-5 grid gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3 md:grid-cols-5">
                                <div className="md:col-span-3">
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Node Alias</label>
                                    <input
                                        type="text"
                                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-orange-500 focus:outline-none"
                                        placeholder="Введите понятное имя ноды"
                                        value={renameName}
                                        onChange={(e) => setRenameName(e.target.value)}
                                    />
                                </div>
                                <div className="md:col-span-1 md:self-end">
                                    <button
                                        onClick={renameNode}
                                        disabled={!renameName.trim()}
                                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-50"
                                    >
                                        Save Alias
                                    </button>
                                </div>
                                <div className="md:col-span-1">
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Search Containers</label>
                                    <input
                                        type="text"
                                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-orange-500 focus:outline-none"
                                        placeholder="ID, image, name"
                                        value={containerSearch}
                                        onChange={(e) => setContainerSearch(e.target.value)}
                                    />
                                </div>
                            </div>
                        )}

                        {!selectedNode && (
                            <div className="flex h-64 flex-col items-center justify-center text-slate-500">
                                <p>Выберите ноду слева, чтобы управлять контейнерами</p>
                            </div>
                        )}

                        {selectedNode && loading && (
                            <div className="flex h-64 items-center justify-center">
                                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-orange-500"></div>
                            </div>
                        )}

                        {selectedNode && !loading && (
                            <div className="overflow-x-auto rounded-xl border border-slate-800">
                                <table className="min-w-full divide-y divide-slate-800">
                                    <thead className="bg-slate-950">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">ID</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Image</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Names</th>
                                            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800 bg-slate-900">
                                        {filteredContainers.map((c) => (
                                            <tr key={c.Id} className="transition-colors hover:bg-slate-800/60">
                                                <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-slate-400">{c.Id.substring(0, 12)}</td>
                                                <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-200">{c.Image}</td>
                                                <td className="whitespace-nowrap px-4 py-3 text-sm">
                                                    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                                                        c.State === 'running'
                                                            ? 'border-emerald-700 bg-emerald-500/15 text-emerald-300'
                                                            : 'border-slate-700 bg-slate-800 text-slate-400'
                                                    }`}>
                                                        {c.Status}
                                                    </span>
                                                </td>
                                                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-400">{Array.isArray(c.Names) ? c.Names.join(', ') : ''}</td>
                                                <td className="whitespace-nowrap px-4 py-3 text-sm font-medium">
                                                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                                                        <button onClick={() => startContainer(selectedNode.node_id, c.Id)} className="text-emerald-400 transition-colors hover:text-emerald-300">Start</button>
                                                        <button onClick={() => stopContainer(selectedNode.node_id, c.Id)} className="text-amber-400 transition-colors hover:text-amber-300">Stop</button>
                                                        <button onClick={() => removeContainer(selectedNode.node_id, c.Id)} className="text-rose-400 transition-colors hover:text-rose-300">Delete</button>
                                                        <button onClick={() => enableAutoRestart(selectedNode.node_id, c.Id)} className="text-orange-300 transition-colors hover:text-orange-200">AutoRestart On</button>
                                                        <button onClick={() => disableAutoRestart(selectedNode.node_id, c.Id)} className="text-slate-300 transition-colors hover:text-white">Off</button>
                                                        <button onClick={() => fetchLogs(selectedNode.node_id, c)} className="text-orange-400 transition-colors hover:text-orange-300">Logs</button>
                                                        <button onClick={() => openDetails(selectedNode.node_id, c)} className="text-slate-300 transition-colors hover:text-white">Details</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        {filteredContainers.length === 0 && (
                                            <tr>
                                                <td colSpan="5" className="px-6 py-12 text-center text-slate-500">
                                                    {containerSearch.trim() ? 'Контейнеры по запросу не найдены' : 'No containers running'}
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <OrchestratorPanel
                open={orchestratorOpen}
                onClose={() => setOrchestratorOpen(false)}
                token={token}
                nodes={nodes}
                onRefresh={() => {
                    fetchNodes()
                    if (selectedNode) {
                        fetchContainers(selectedNode.node_id)
                    }
                }}
            />
            {logsOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-zinc-900 rounded-lg shadow-2xl border border-zinc-800 w-full max-w-4xl max-h-[80vh] flex flex-col">
                        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
                            <div className="text-base font-semibold text-zinc-200">
                                Logs: <span className="font-mono text-orange-400">{logsContainer ? logsContainer.Id.substring(0, 12) : ''}</span>
                            </div>
                            <button onClick={() => setLogsOpen(false)} className="text-zinc-500 hover:text-zinc-300">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="p-0 flex-1 overflow-hidden bg-black rounded-b-lg">
                            {logsLoading && <div className="p-6 text-zinc-500">Loading...</div>}
                            {!logsLoading && logsError && (
                                <div className="p-6 text-red-500">{logsError}</div>
                            )}
                            {!logsLoading && !logsError && (
                                <pre className="text-xs font-mono text-zinc-300 p-6 overflow-auto h-full whitespace-pre-wrap">
                                    {logsText || 'No logs available'}
                                </pre>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {stacksOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-zinc-900 rounded-lg shadow-2xl border border-zinc-800 w-full max-w-4xl max-h-[90vh] flex flex-col">
                        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
                            <div className="text-base font-semibold text-zinc-200">Deploy Stack</div>
                            <button onClick={() => setStacksOpen(false)} className="text-zinc-500 hover:text-zinc-300">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="p-6 flex-1 overflow-auto space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">Stack Name</label>
                                <input
                                    type="text"
                                    className="w-full p-2.5 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-orange-500 transition-colors"
                                    placeholder="my-stack"
                                    value={stackName}
                                    onChange={(e) => setStackName(e.target.value)}
                                />
                            </div>
                            <div className="flex-1 flex flex-col h-full min-h-[300px]">
                                <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">Docker Compose (YAML)</label>
                                <textarea
                                    className="flex-1 w-full p-4 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-300 focus:outline-none focus:border-orange-500 transition-colors resize-none leading-relaxed"
                                    placeholder={`version: '3'\nservices:\n  web:\n    image: nginx`}
                                    value={stackContent}
                                    onChange={(e) => setStackContent(e.target.value)}
                                    spellCheck={false}
                                />
                            </div>
                            {stackError && <div className="text-red-400 text-sm bg-red-900/20 p-3 rounded border border-red-900/50">{stackError}</div>}
                        </div>
                        <div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-800 bg-zinc-900/50">
                            <button
                                onClick={() => setStacksOpen(false)}
                                className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 text-sm transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={deployStack}
                                disabled={stackLoading || !stackName.trim() || !stackContent.trim()}
                                className="px-6 py-2 bg-orange-600 text-white rounded text-sm hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-orange-900/20 transition-all font-medium flex items-center"
                            >
                                {stackLoading ? (
                                    <>
                                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                        Deploying...
                                    </>
                                ) : 'Deploy Stack'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {clusterOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-zinc-900 rounded-lg shadow-2xl border border-zinc-800 w-full max-w-6xl max-h-[90vh] flex flex-col">
                        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
                            <div className="text-base font-semibold text-zinc-200">Deploy Cluster (Multi-Node Compose)</div>
                            <button onClick={() => setClusterOpen(false)} className="text-zinc-500 hover:text-zinc-300">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="p-6 flex-1 overflow-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="bg-zinc-950/30 border border-zinc-800 rounded-lg p-4">
                                <div className="mb-4">
                                    <div className="text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wider">Existing Clusters</div>
                                    {clustersLoading && <div className="text-zinc-500 text-sm">Loading...</div>}
                                    {!clustersLoading && clustersError && <div className="text-red-400 text-sm">{clustersError}</div>}
                                    {!clustersLoading && !clustersError && clustersList.length === 0 && (
                                        <div className="text-zinc-500 text-sm">No clusters yet</div>
                                    )}
                                    {!clustersLoading && !clustersError && clustersList.length > 0 && (
                                        <div className="space-y-2 max-h-40 overflow-auto pr-1">
                                            {clustersList.map((c) => (
                                                <div key={c.id} className="p-3 rounded border border-zinc-800 bg-zinc-900/40">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="min-w-0">
                                                            <div className="text-sm font-semibold text-zinc-200 truncate">
                                                                {c.name || c.stack_name}
                                                            </div>
                                                            <div className="text-[11px] text-zinc-500 truncate">
                                                                Stack: {c.stack_name}
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => {
                                                                    setClusterNodeIds(c.nodes || [])
                                                                    setClusterName(c.stack_name || '')
                                                                    setClusterContent(c.content || '')
                                                                    setClusterResults([])
                                                                    setClusterError('')
                                                                }}
                                                                className="px-2 py-1 bg-zinc-800 text-zinc-300 rounded text-xs hover:bg-zinc-700 transition-colors"
                                                            >
                                                                Use
                                                            </button>
                                                            <button
                                                                onClick={() => startRenameCluster(c)}
                                                                className="px-2 py-1 bg-zinc-800 text-zinc-300 rounded text-xs hover:bg-zinc-700 transition-colors"
                                                            >
                                                                Rename
                                                            </button>
                                                            <button
                                                                onClick={() => deleteCluster(c)}
                                                                className="px-2 py-1 bg-red-900/40 text-red-300 rounded text-xs hover:bg-red-900/60 transition-colors border border-red-900/50"
                                                            >
                                                                Delete
                                                            </button>
                                                        </div>
                                                    </div>
                                                    {clusterRenameId === c.id && (
                                                        <div className="mt-3 flex gap-2">
                                                            <input
                                                                type="text"
                                                                className="flex-1 p-2 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-orange-500 transition-colors"
                                                                value={clusterRenameValue}
                                                                onChange={(e) => setClusterRenameValue(e.target.value)}
                                                            />
                                                            <button
                                                                onClick={saveRenameCluster}
                                                                className="px-3 py-2 bg-orange-600 text-white rounded text-sm hover:bg-orange-700"
                                                            >
                                                                Save
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    setClusterRenameId(null)
                                                                    setClusterRenameValue('')
                                                                }}
                                                                className="px-3 py-2 bg-zinc-800 text-zinc-300 rounded text-sm hover:bg-zinc-700"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center justify-between mb-3">
                                    <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Select Nodes</div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setClusterNodeIds(nodes.map((n) => n.node_id))}
                                            className="px-2 py-1 bg-zinc-800 text-zinc-300 rounded text-xs hover:bg-zinc-700 transition-colors"
                                        >
                                            All
                                        </button>
                                        <button
                                            onClick={() => setClusterNodeIds([])}
                                            className="px-2 py-1 bg-zinc-800 text-zinc-300 rounded text-xs hover:bg-zinc-700 transition-colors"
                                        >
                                            Clear
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
                                    {nodes.map((n) => (
                                        <label
                                            key={n.node_id}
                                            className="flex items-center gap-3 p-3 rounded border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900 cursor-pointer"
                                        >
                                            <input
                                                type="checkbox"
                                                className="accent-orange-500"
                                                checked={clusterNodeIds.includes(n.node_id)}
                                                onChange={() => toggleClusterNode(n.node_id)}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between">
                                                    <div className="text-xs text-orange-300 truncate">{getNodeDisplayName(n)}</div>
                                                    <span className={`px-2 py-0.5 text-[10px] uppercase font-bold rounded-full ${
                                                        n.status === 'connected'
                                                            ? 'bg-green-900/30 text-green-400 border border-green-900'
                                                            : 'bg-red-900/30 text-red-400 border border-red-900'
                                                    }`}>
                                                        {n.status}
                                                    </span>
                                                </div>
                                                <div className="font-mono text-[11px] text-zinc-600 truncate">{n.node_id}</div>
                                                <div className="text-[11px] text-zinc-500 truncate">{n.remote_addr}</div>
                                            </div>
                                        </label>
                                    ))}
                                    {nodes.length === 0 && <div className="text-zinc-500 text-sm">No nodes connected</div>}
                                </div>
                            </div>

                            <div className="lg:col-span-2 space-y-4 flex flex-col">
                                <div>
                                    <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">Stack Name</label>
                                    <input
                                        type="text"
                                        className="w-full p-2.5 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-orange-500 transition-colors"
                                        placeholder="my-cluster-stack"
                                        value={clusterName}
                                        onChange={(e) => setClusterName(e.target.value)}
                                    />
                                </div>
                                <div className="flex-1 flex flex-col min-h-[280px]">
                                    <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">Docker Compose (YAML)</label>
                                    <textarea
                                        className="flex-1 w-full p-4 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-300 focus:outline-none focus:border-orange-500 transition-colors resize-none leading-relaxed"
                                        placeholder={`version: '3'\nservices:\n  web:\n    image: nginx`}
                                        value={clusterContent}
                                        onChange={(e) => setClusterContent(e.target.value)}
                                        spellCheck={false}
                                    />
                                </div>

                                {clusterError && (
                                    <div className="text-red-400 text-sm bg-red-900/20 p-3 rounded border border-red-900/50">
                                        {clusterError}
                                    </div>
                                )}

                                {clusterResults.length > 0 && (
                                    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
                                        <div className="text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wider">Results</div>
                                        <div className="space-y-2 max-h-48 overflow-auto pr-1">
                                            {clusterResults.map((r) => (
                                                <div key={r.node_id} className="flex items-start justify-between gap-3 p-3 rounded border border-zinc-800 bg-zinc-900/40">
                                                    <div className="min-w-0">
                                                        <div className="font-mono text-xs text-orange-400 truncate">{r.node_id}</div>
                                                        {r.error && <div className="text-xs text-red-400 mt-1 whitespace-pre-wrap break-words">{r.error}</div>}
                                                    </div>
                                                    <div className={`text-xs font-bold px-2 py-1 rounded ${
                                                        r.ok ? 'bg-green-900/30 text-green-400 border border-green-900' : 'bg-red-900/30 text-red-400 border border-red-900'
                                                    }`}>
                                                        {r.ok ? 'OK' : 'FAIL'}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-800 bg-zinc-900/50">
                            <button
                                onClick={() => setClusterOpen(false)}
                                className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 text-sm transition-colors"
                            >
                                Close
                            </button>
                            <button
                                onClick={deployCluster}
                                disabled={clusterLoading || !clusterName.trim() || !clusterContent.trim() || clusterNodeIds.length === 0}
                                className="px-6 py-2 bg-orange-600 text-white rounded text-sm hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-orange-900/20 transition-all font-medium flex items-center"
                            >
                                {clusterLoading ? (
                                    <>
                                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                        Deploying...
                                    </>
                                ) : 'Deploy Cluster'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {detailsOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-zinc-900 rounded-lg shadow-2xl border border-zinc-800 w-full max-w-6xl max-h-[90vh] flex flex-col">
                        <div className="flex items-center justify-between border-b px-4 py-3">
                            <div className="text-base font-semibold text-zinc-200">
                                Container: <span className="font-mono text-orange-400">{detailsContainer.Id.substring(0, 12)}</span>
                            </div>
                            <button onClick={() => setDetailsOpen(false)} className="text-zinc-500 hover:text-zinc-300">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="p-6 flex-1 overflow-auto bg-zinc-950/30">
                            {detailsLoading && <div className="text-zinc-500">Loading details...</div>}
                            
                            {!detailsLoading && (
                                <div className="grid grid-cols-2 gap-6">
                                    {/* Stats */}
                                    <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg shadow-sm">
                                        <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-green-500">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                                            </svg>
                                            Live Stats
                                        </h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="bg-zinc-950 p-3 rounded border border-zinc-800">
                                                <div className="text-xs text-zinc-500 uppercase">CPU Usage</div>
                                                <div className="text-xl font-mono text-zinc-200">{statsText ? JSON.parse(statsText).cpu : '0%'}</div>
                                            </div>
                                            <div className="bg-zinc-950 p-3 rounded border border-zinc-800">
                                                <div className="text-xs text-zinc-500 uppercase">Memory Usage</div>
                                                <div className="text-xl font-mono text-zinc-200">{statsText ? JSON.parse(statsText).mem : '0 MB'}</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Exec */}
                                    <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg shadow-sm">
                                        <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-orange-500">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3" />
                                            </svg>
                                            Execute Command
                                        </h3>
                                        <div className="flex gap-2 mb-2">
                                            <input
                                                type="text"
                                                className="flex-1 p-2 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-300 focus:outline-none focus:border-orange-500"
                                                placeholder="ls -la /app"
                                                value={execCmd}
                                                onChange={(e) => setExecCmd(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && runExec()}
                                            />
                                            <button
                                                onClick={runExec}
                                                disabled={execLoading || !execCmd.trim()}
                                                className="px-3 py-2 bg-orange-600 text-white rounded text-sm hover:bg-orange-700 disabled:opacity-50"
                                            >
                                                Run
                                            </button>
                                        </div>
                                        <div className="bg-black rounded border border-zinc-800 h-32 overflow-auto p-2">
                                            <pre className="text-xs font-mono text-green-400 whitespace-pre-wrap">{execOut}</pre>
                                            {execError && <div className="text-xs text-red-500 mt-1">{execError}</div>}
                                        </div>
                                    </div>

                                    {/* Inspect JSON */}
                                    <div className="col-span-2 bg-zinc-900 border border-zinc-800 p-4 rounded-lg shadow-sm">
                                        <h3 className="text-sm font-semibold text-zinc-300 mb-3">Inspect Details</h3>
                                        <div className="bg-zinc-950 p-4 rounded border border-zinc-800 h-64 overflow-auto">
                                            <pre className="text-xs font-mono text-zinc-400 whitespace-pre-wrap">
                                                {inspectText}
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {createOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-zinc-900 rounded-lg shadow-2xl border border-zinc-800 w-full max-w-lg">
                        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
                            <div className="text-base font-semibold text-zinc-200">Launch Container</div>
                            <button onClick={() => setCreateOpen(false)} className="text-zinc-500 hover:text-zinc-300">Close</button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">Image (required)</label>
                                <input
                                    type="text"
                                    className="w-full p-2.5 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-orange-500 transition-colors"
                                    placeholder="e.g. nginx:latest"
                                    value={createImage}
                                    onChange={(e) => setCreateImage(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">Name (optional)</label>
                                <input
                                    type="text"
                                    className="w-full p-2.5 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-orange-500 transition-colors"
                                    placeholder="e.g. my-nginx"
                                    value={createName}
                                    onChange={(e) => setCreateName(e.target.value)}
                                />
                            </div>
                            <div className="flex items-center gap-3 bg-zinc-950/40 border border-zinc-800 rounded p-3">
                                <input
                                    type="checkbox"
                                    className="accent-orange-500"
                                    checked={createAutoRestart}
                                    onChange={(e) => setCreateAutoRestart(e.target.checked)}
                                />
                                <div className="text-sm text-zinc-300">Auto-restart if container exits</div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">Ports (Host : Container)</label>
                                {createPorts.map((p, i) => (
                                    <div key={i} className="flex gap-2 mb-2">
                                        <input
                                            type="text"
                                            className="w-1/2 p-2.5 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-orange-500 transition-colors"
                                            placeholder="8080"
                                            value={p.host}
                                            onChange={(e) => updatePortRow(i, 'host', e.target.value)}
                                        />
                                        <span className="self-center text-zinc-500">:</span>
                                        <input
                                            type="text"
                                            className="w-1/2 p-2.5 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-orange-500 transition-colors"
                                            placeholder="80"
                                            value={p.container}
                                            onChange={(e) => updatePortRow(i, 'container', e.target.value)}
                                        />
                                        <button onClick={() => removePortRow(i)} className="text-red-500 hover:text-red-400 px-2 transition-colors">×</button>
                                    </div>
                                ))}
                                <button onClick={addPortRow} className="text-xs text-orange-500 hover:text-orange-400 font-medium">+ Add Port</button>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">Environment Variables (KEY=VALUE per line)</label>
                                <textarea
                                    className="w-full p-2.5 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono h-24 text-zinc-300 focus:outline-none focus:border-orange-500 transition-colors"
                                    placeholder="FOO=bar"
                                    value={createEnv}
                                    onChange={(e) => setCreateEnv(e.target.value)}
                                />
                            </div>

                            {createError && <div className="text-red-400 text-sm bg-red-900/20 p-3 rounded border border-red-900/50">{createError}</div>}

                            <div className="flex justify-end gap-3 pt-2 border-t border-zinc-800 mt-4">
                                <button
                                    onClick={() => setCreateOpen(false)}
                                    className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 text-sm transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleCreateContainer}
                                    disabled={createLoading || !createImage.trim()}
                                    className="px-4 py-2 bg-orange-600 text-white rounded text-sm hover:bg-orange-700 disabled:opacity-50 shadow-lg shadow-orange-900/20 transition-all font-medium flex items-center"
                                >
                                    {createLoading && <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                                    {createLoading ? 'Deploying...' : 'Deploy'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default App
