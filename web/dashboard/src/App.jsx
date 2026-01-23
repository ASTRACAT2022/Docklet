import { useState, useEffect } from 'react'

function App() {
    const [nodes, setNodes] = useState([])
    const [selectedNode, setSelectedNode] = useState(null)
    const [containers, setContainers] = useState([])
    const [loading, setLoading] = useState(false)

    const fetchNodes = async () => {
        try {
            const res = await fetch('/api/nodes')
            const data = await res.json()
            setNodes(data.nodes || [])
        } catch (err) {
            console.error("Failed to fetch nodes", err)
        }
    }

    const fetchContainers = async (nodeId) => {
        setLoading(true)
        try {
            const res = await fetch(`/api/nodes/${nodeId}/containers`)
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

    useEffect(() => {
        fetchNodes()
        const interval = setInterval(fetchNodes, 5000)
        return () => clearInterval(interval)
    }, [])

    useEffect(() => {
        if (selectedNode) {
            fetchContainers(selectedNode.node_id)
        }
    }, [selectedNode])

    return (
        <div className="min-h-screen bg-gray-100 p-8">
            <div className="max-w-6xl mx-auto">
                <h1 className="text-3xl font-bold mb-8 text-gray-800">Docklet Control Center</h1>

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
                        <h2 className="text-xl font-semibold mb-4">
                            {selectedNode ? `Containers on ${selectedNode.node_id.substring(0, 8)}...` : 'Select a node'}
                        </h2>

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
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {containers.map((c) => (
                                            <tr key={c.Id}>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono">{c.Id.substring(0, 12)}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{c.Image}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{c.Status}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{c.Names.join(", ")}</td>
                                            </tr>
                                        ))}
                                        {containers.length === 0 && (
                                            <tr>
                                                <td colSpan="4" className="px-6 py-4 text-center text-gray-500">No containers running</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default App
