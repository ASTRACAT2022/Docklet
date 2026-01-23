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
        try {
            await fetch(`/api/nodes/${nodeId}/containers/${containerId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
            })
            fetchContainers(nodeId)
        } catch (e) { console.error('remove error', e) }
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
        <div className="min-h-screen bg-gray-100 p-8">
            <div className="max-w-6xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-800">Docklet Control Center</h1>
                    <button onClick={handleLogout} className="text-sm text-red-600 hover:text-red-800 font-semibold">
                        Logout
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Nodes List */}
                    <div className="col-span-1 bg-white rounded-lg shadow p-6">
                        <h2 className="text-xl font-semibold mb-4">Nodes</h2>
                        <div className="space-y-3">
                            {nodes.map(node => (
                                <div
                                    key={node.node_id}
                                    onClick={() => setSelectedNode(node)}
                                    className={`p-4 rounded border cursor-pointer transition ${selectedNode?.node_id === node.node_id
                                        ? 'border-blue-500 bg-blue-50'
                                        : 'border-gray-200 hover:bg-gray-50'
                                        }`}
                                >
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="font-mono text-sm font-bold">{node.node_id.substring(0, 8)}...</span>
                                        <span className={`px-2 py-1 text-xs rounded-full ${node.status === 'connected' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                            }`}>
                                            {node.status}
                                        </span>
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        <p>IP: {node.remote_addr}</p>
                                        <p>Ver: {node.version}</p>
                                    </div>
                                </div>
                            ))}
                            {nodes.length === 0 && <p className="text-gray-500 text-center">No nodes found</p>}
                        </div>
                    </div>

                    {/* Containers List */}
                    <div className="col-span-2 bg-white rounded-lg shadow p-6">
                        <h2 className="text-xl font-semibold mb-2">
                            {selectedNode ? `Containers on ${selectedNode.node_id.substring(0, 8)}...` : 'Select a node'}
                        </h2>
                        {selectedNode && (
                            <div className="flex items-center gap-2 mb-4">
                                <input
                                    type="text"
                                    className="flex-1 p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                    placeholder="New node name"
                                    value={renameName}
                                    onChange={(e) => setRenameName(e.target.value)}
                                />
                                <button
                                    onClick={renameNode}
                                    disabled={!renameName.trim()}
                                    className="px-3 py-2 text-sm bg-blue-600 text-white rounded disabled:opacity-50"
                                >
                                    Rename
                                </button>
                            </div>
                        )}

                        {!selectedNode && (
                            <div className="flex items-center justify-center h-40 text-gray-400">
                                Select a node to view containers
                            </div>
                        )}

                        {selectedNode && loading && (
                            <div className="flex items-center justify-center h-40">
                                Loading...
                            </div>
                        )}

                        {selectedNode && !loading && (
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Image</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Names</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {containers.map((c) => (
                                            <tr key={c.Id}>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono">{c.Id.substring(0, 12)}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{c.Image}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{c.Status}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{c.Names.join(", ")}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                    <button onClick={() => startContainer(selectedNode.node_id, c.Id)} className="mr-2 text-green-600 hover:underline">Start</button>
                                                    <button onClick={() => stopContainer(selectedNode.node_id, c.Id)} className="mr-2 text-yellow-600 hover:underline">Stop</button>
                                                    <button onClick={() => removeContainer(selectedNode.node_id, c.Id)} className="text-red-600 hover:underline">Delete</button>
                                                    <button onClick={() => fetchLogs(selectedNode.node_id, c)} className="ml-2 text-blue-600 hover:underline">Logs</button>
                                                    <button onClick={() => openDetails(selectedNode.node_id, c)} className="ml-2 text-gray-700 hover:underline">Details</button>
                                                </td>
                                            </tr>
                                        ))}
                                        {containers.length === 0 && (
                                            <tr>
                                                <td colSpan="5" className="px-6 py-4 text-center text-gray-500">No containers running</td>
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
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-lg w-full max-w-3xl">
                        <div className="flex items-center justify-between border-b px-4 py-3">
                            <div className="text-sm font-semibold text-gray-700">
                                Logs {logsContainer ? logsContainer.Id.substring(0, 12) : ''}
                            </div>
                            <button onClick={() => setLogsOpen(false)} className="text-gray-500 hover:text-gray-700 text-sm">
                                Close
                            </button>
                        </div>
                        <div className="p-4">
                            {logsLoading && <div className="text-gray-500">Loading...</div>}
                            {!logsLoading && logsError && (
                                <div className="text-red-600 text-sm">{logsError}</div>
                            )}
                            {!logsLoading && !logsError && (
                                <pre className="text-xs bg-gray-900 text-gray-100 p-4 rounded overflow-auto max-h-96 whitespace-pre-wrap">
                                    {logsText || 'No logs'}
                                </pre>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {detailsOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-lg w-full max-w-5xl">
                        <div className="flex items-center justify-between border-b px-4 py-3">
                            <div className="text-sm font-semibold text-gray-700">
                                Container {detailsContainer ? detailsContainer.Id.substring(0, 12) : ''}
                            </div>
                            <button onClick={() => setDetailsOpen(false)} className="text-gray-500 hover:text-gray-700 text-sm">
                                Close
                            </button>
                        </div>
                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <div className="text-xs font-semibold text-gray-600 mb-2">Inspect</div>
                                {inspectLoading && <div className="text-gray-500 text-sm">Loading...</div>}
                                {!inspectLoading && inspectError && <div className="text-red-600 text-sm">{inspectError}</div>}
                                {!inspectLoading && !inspectError && (
                                    <pre className="text-[11px] bg-gray-900 text-gray-100 p-3 rounded overflow-auto max-h-80 whitespace-pre-wrap">
                                        {inspectText || 'No data'}
                                    </pre>
                                )}
                            </div>
                            <div>
                                <div className="text-xs font-semibold text-gray-600 mb-2">Stats</div>
                                {statsLoading && <div className="text-gray-500 text-sm">Loading...</div>}
                                {!statsLoading && statsError && <div className="text-red-600 text-sm">{statsError}</div>}
                                {!statsLoading && !statsError && (
                                    <pre className="text-[11px] bg-gray-900 text-gray-100 p-3 rounded overflow-auto max-h-80 whitespace-pre-wrap">
                                        {statsText || 'No data'}
                                    </pre>
                                )}
                            </div>
                            <div className="md:col-span-2">
                                <div className="text-xs font-semibold text-gray-600 mb-2">Exec (one-shot)</div>
                                <div className="flex gap-2 mb-2">
                                    <input
                                        type="text"
                                        className="flex-1 p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
                                        value={execCmd}
                                        onChange={(e) => setExecCmd(e.target.value)}
                                        placeholder='sh -lc "ls -la"'
                                    />
                                    <button
                                        onClick={runExec}
                                        disabled={execLoading || !execCmd.trim()}
                                        className="px-3 py-2 text-sm bg-blue-600 text-white rounded disabled:opacity-50"
                                    >
                                        Run
                                    </button>
                                </div>
                                {execLoading && <div className="text-gray-500 text-sm">Running...</div>}
                                {!execLoading && execError && <div className="text-red-600 text-sm">{execError}</div>}
                                {!execLoading && !execError && execOut && (
                                    <pre className="text-[11px] bg-gray-900 text-gray-100 p-3 rounded overflow-auto max-h-52 whitespace-pre-wrap">
                                        {execOut}
                                    </pre>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default App
