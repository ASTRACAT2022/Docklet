import { useState, useEffect } from 'react'
import Login from './Login'

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
    const [execCmd, setExecCmd] = useState('sh -lc "echo hello"')
    const [execLoading, setExecLoading] = useState(false)
    const [execOut, setExecOut] = useState('')
    const [execError, setExecError] = useState('')

    // Create Container State
    const [createOpen, setCreateOpen] = useState(false)
    const [createImage, setCreateImage] = useState('')
    const [createName, setCreateName] = useState('')
    const [createPorts, setCreatePorts] = useState([{ host: '', container: '' }])
    const [createEnv, setCreateEnv] = useState('')
    const [createLoading, setCreateLoading] = useState(false)
    const [createError, setCreateError] = useState('')

    // Stack State
    const [stacksOpen, setStacksOpen] = useState(false)
    const [stacks, setStacks] = useState([]) // For listing stacks if we implement listing
    const [stackName, setStackName] = useState('')
    const [stackContent, setStackContent] = useState('')
    const [stackLoading, setStackLoading] = useState(false)
    const [stackError, setStackError] = useState('')

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
            env: env
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

    if (!token) {
        return <Login onLogin={handleLogin} />
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-gray-100 p-8">
            <div className="max-w-7xl mx-auto">
                <div className="flex justify-between items-center mb-8 border-b border-zinc-800 pb-4">
                    <h1 className="text-3xl font-bold text-white tracking-tight">Docklet <span className="text-blue-500">Pro</span></h1>
                    <button onClick={handleLogout} className="text-sm text-red-400 hover:text-red-300 font-semibold transition-colors">
                        Logout
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    {/* Nodes List */}
                    <div className="col-span-1 bg-zinc-900 rounded-lg shadow-xl border border-zinc-800 p-6 h-fit">
                        <h2 className="text-xl font-semibold mb-4 text-zinc-300">Nodes</h2>
                        <div className="space-y-3">
                            {nodes.map(node => (
                                <div
                                    key={node.node_id}
                                    onClick={() => setSelectedNode(node)}
                                    className={`p-4 rounded-lg border cursor-pointer transition-all ${selectedNode?.node_id === node.node_id
                                        ? 'border-blue-500 bg-blue-900/20 shadow-md'
                                        : 'border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 hover:border-zinc-600'
                                        }`}
                                >
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="font-mono text-sm font-bold text-blue-400">{node.node_id.substring(0, 8)}...</span>
                                        <span className={`px-2 py-0.5 text-[10px] uppercase font-bold rounded-full ${node.status === 'connected' ? 'bg-green-900/30 text-green-400 border border-green-900' : 'bg-red-900/30 text-red-400 border border-red-900'
                                            }`}>
                                            {node.status}
                                        </span>
                                    </div>
                                    <div className="text-xs text-zinc-500">
                                        <p>IP: {node.remote_addr}</p>
                                        <p>Ver: {node.version}</p>
                                    </div>
                                </div>
                            ))}
                            {nodes.length === 0 && <p className="text-zinc-500 text-center py-4">No nodes connected</p>}
                        </div>
                    </div>

                    {/* Containers List */}
                    <div className="col-span-3 bg-zinc-900 rounded-lg shadow-xl border border-zinc-800 p-6 min-h-[500px]">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-semibold text-zinc-300">
                                {selectedNode ? `Containers on ${selectedNode.node_id.substring(0, 8)}...` : 'Select a node'}
                            </h2>
                            {selectedNode && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setStacksOpen(true)}
                                        className="px-4 py-2 bg-purple-600 text-white rounded-md text-sm hover:bg-purple-700 shadow-lg shadow-purple-900/20 transition-all font-medium flex items-center gap-2"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                                        </svg>
                                        Stacks (Compose)
                                    </button>
                                    <button
                                        onClick={() => setCreateOpen(true)}
                                        className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 shadow-lg shadow-blue-900/20 transition-all font-medium flex items-center gap-2"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                        </svg>
                                        Launch
                                    </button>
                                </div>
                            )}
                        </div>
                        
                        {selectedNode && (
                            <div className="flex items-center gap-2 mb-6 bg-zinc-950/50 p-3 rounded-lg border border-zinc-800">
                                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Node Alias:</span>
                                <input
                                    type="text"
                                    className="flex-1 p-1.5 bg-zinc-900 border border-zinc-700 rounded text-sm text-zinc-300 focus:outline-none focus:border-blue-500 transition-colors"
                                    placeholder="Rename node..."
                                    value={renameName}
                                    onChange={(e) => setRenameName(e.target.value)}
                                />
                                <button
                                    onClick={renameNode}
                                    disabled={!renameName.trim()}
                                    className="px-3 py-1.5 text-xs bg-zinc-800 text-zinc-300 border border-zinc-700 rounded hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                                >
                                    Save
                                </button>
                            </div>
                        )}

                        {!selectedNode && (
                            <div className="flex flex-col items-center justify-center h-64 text-zinc-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-16 h-16 mb-4 opacity-50">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.25L5.25 10.5m13.5-3l2.25-2.25" />
                                </svg>
                                <p>Select a node from the left to manage containers</p>
                            </div>
                        )}

                        {selectedNode && loading && (
                            <div className="flex items-center justify-center h-64">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                            </div>
                        )}

                        {selectedNode && !loading && (
                            <div className="overflow-x-auto rounded-lg border border-zinc-800">
                                <table className="min-w-full divide-y divide-zinc-800">
                                    <thead className="bg-zinc-950">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">ID</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Image</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Names</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-zinc-900 divide-y divide-zinc-800">
                                        {containers.map((c) => (
                                            <tr key={c.Id} className="hover:bg-zinc-800/50 transition-colors">
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-zinc-400">{c.Id.substring(0, 12)}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-300 font-medium">{c.Image}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                                        c.State === 'running' ? 'bg-green-900/30 text-green-400 border border-green-900' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                                                    }`}>
                                                        {c.Status}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-400">{c.Names.join(", ")}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                                    <button onClick={() => startContainer(selectedNode.node_id, c.Id)} className="mr-3 text-green-500 hover:text-green-400 transition-colors">Start</button>
                                                    <button onClick={() => stopContainer(selectedNode.node_id, c.Id)} className="mr-3 text-yellow-500 hover:text-yellow-400 transition-colors">Stop</button>
                                                    <button onClick={() => removeContainer(selectedNode.node_id, c.Id)} className="mr-3 text-red-500 hover:text-red-400 transition-colors">Delete</button>
                                                    <button onClick={() => fetchLogs(selectedNode.node_id, c)} className="mr-3 text-blue-500 hover:text-blue-400 transition-colors">Logs</button>
                                                    <button onClick={() => openDetails(selectedNode.node_id, c)} className="text-zinc-400 hover:text-zinc-200 transition-colors">Details</button>
                                                </td>
                                            </tr>
                                        ))}
                                        {containers.length === 0 && (
                                            <tr>
                                                <td colSpan="5" className="px-6 py-12 text-center text-zinc-500">No containers running</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {logsOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-zinc-900 rounded-lg shadow-2xl border border-zinc-800 w-full max-w-4xl max-h-[80vh] flex flex-col">
                        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
                            <div className="text-base font-semibold text-zinc-200">
                                Logs: <span className="font-mono text-blue-400">{logsContainer ? logsContainer.Id.substring(0, 12) : ''}</span>
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
                                    className="w-full p-2.5 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-purple-500 transition-colors"
                                    placeholder="my-stack"
                                    value={stackName}
                                    onChange={(e) => setStackName(e.target.value)}
                                />
                            </div>
                            <div className="flex-1 flex flex-col h-full min-h-[300px]">
                                <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">Docker Compose (YAML)</label>
                                <textarea
                                    className="flex-1 w-full p-4 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-300 focus:outline-none focus:border-purple-500 transition-colors resize-none leading-relaxed"
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
                                className="px-6 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-900/20 transition-all font-medium flex items-center"
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
            {detailsOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-zinc-900 rounded-lg shadow-2xl border border-zinc-800 w-full max-w-6xl max-h-[90vh] flex flex-col">
                        <div className="flex items-center justify-between border-b px-4 py-3">
                            <div className="text-base font-semibold text-zinc-200">
                                Container: <span className="font-mono text-blue-400">{detailsContainer.Id.substring(0, 12)}</span>
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
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-blue-500">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3" />
                                            </svg>
                                            Execute Command
                                        </h3>
                                        <div className="flex gap-2 mb-2">
                                            <input
                                                type="text"
                                                className="flex-1 p-2 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-300 focus:outline-none focus:border-blue-500"
                                                placeholder="ls -la /app"
                                                value={execCmd}
                                                onChange={(e) => setExecCmd(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && runExec()}
                                            />
                                            <button
                                                onClick={runExec}
                                                disabled={execLoading || !execCmd.trim()}
                                                className="px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
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
                                    className="w-full p-2.5 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-blue-500 transition-colors"
                                    placeholder="e.g. nginx:latest"
                                    value={createImage}
                                    onChange={(e) => setCreateImage(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">Name (optional)</label>
                                <input
                                    type="text"
                                    className="w-full p-2.5 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-blue-500 transition-colors"
                                    placeholder="e.g. my-nginx"
                                    value={createName}
                                    onChange={(e) => setCreateName(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">Ports (Host : Container)</label>
                                {createPorts.map((p, i) => (
                                    <div key={i} className="flex gap-2 mb-2">
                                        <input
                                            type="text"
                                            className="w-1/2 p-2.5 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-blue-500 transition-colors"
                                            placeholder="8080"
                                            value={p.host}
                                            onChange={(e) => updatePortRow(i, 'host', e.target.value)}
                                        />
                                        <span className="self-center text-zinc-500">:</span>
                                        <input
                                            type="text"
                                            className="w-1/2 p-2.5 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-blue-500 transition-colors"
                                            placeholder="80"
                                            value={p.container}
                                            onChange={(e) => updatePortRow(i, 'container', e.target.value)}
                                        />
                                        <button onClick={() => removePortRow(i)} className="text-red-500 hover:text-red-400 px-2 transition-colors">×</button>
                                    </div>
                                ))}
                                <button onClick={addPortRow} className="text-xs text-blue-500 hover:text-blue-400 font-medium">+ Add Port</button>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase tracking-wider">Environment Variables (KEY=VALUE per line)</label>
                                <textarea
                                    className="w-full p-2.5 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono h-24 text-zinc-300 focus:outline-none focus:border-blue-500 transition-colors"
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
                                    className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50 shadow-lg shadow-blue-900/20 transition-all font-medium flex items-center"
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
