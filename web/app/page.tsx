"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Node = {
  id: string;
  hostname: string;
  status: string;
  last_seen: string;
};

type App = {
  id: string;
  status: string;
  active_revision_id: string;
  updated_at: string;
};

export default function Dashboard() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [mounted, setMounted] = useState(false);

  // Deploy State
  const [deployImage, setDeployImage] = useState("");
  const [deployReplicas, setDeployReplicas] = useState(1);
  const [autoRestart, setAutoRestart] = useState(true);
  const [isDeployOpen, setIsDeployOpen] = useState(false);

  // Update State
  const [updateImage, setUpdateImage] = useState("");
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);

  // Logs State
  const [logsContent, setLogsContent] = useState("");
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [logsAppId, setLogsAppId] = useState<string | null>(null);

  // Direct Node Deploy State (YAML)
  const [isYamlDeployOpen, setIsYamlDeployOpen] = useState(false);
  const [detailsNodeId, setDetailsNodeId] = useState<string | null>(null);
  const [yamlContent, setYamlContent] = useState<string>(`version: "3"
services:
  app:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      - MODE=production`);

  useEffect(() => {
    setMounted(true);
    const fetchData = async () => {
      try {
        const nodesRes = await fetch('/api/state/nodes');
        const appsRes = await fetch('/api/state/apps');
        if (nodesRes.ok) setNodes(await nodesRes.json());
        if (appsRes.ok) setApps(await appsRes.json());
      } catch (e) {
        console.error("Failed to fetch state", e);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, []);

  // Poll Logs 
  useEffect(() => {
    if (!isLogsOpen || !logsAppId) return;
    fetch(`/api/apps/${logsAppId}/logs/request`, { method: 'POST' });
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/apps/${logsAppId}/logs`);
        if (res.ok) {
          const data = await res.json();
          setLogsContent(data.content || "Waiting for logs...");
        }
      } catch (e) { }
    };
    const interval = setInterval(fetchLogs, 1000);
    return () => clearInterval(interval);
  }, [isLogsOpen, logsAppId]);

  const handleDeploy = async () => {
    if (!deployImage) return;
    try {
      await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: deployImage,
          replicas: deployReplicas,
          restart_policy: autoRestart ? "unless-stopped" : "no"
        }),
      });
      setDeployImage("");
      setDeployReplicas(1);
      setIsDeployOpen(false);
    } catch (e) {
      alert("Failed to deploy: " + e);
    }
  };

  const handleUpdate = async () => {
    if (!updateImage || !selectedAppId) return;
    try {
      await fetch(`/api/apps/${selectedAppId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: updateImage }),
      });
      setUpdateImage("");
      setIsUpdateOpen(false);
      setSelectedAppId(null);
    } catch (e) {
      alert("Failed to update: " + e);
    }
  };

  const handleDelete = async (appId: string) => {
    if (!confirm("Are you sure you want to stop and remove this app?")) return;
    try {
      await fetch(`/api/apps/${appId}`, { method: 'DELETE' });
    } catch (e) {
      alert("Failed to delete: " + e);
    }
  };

  const handleBackup = () => {
    window.location.href = '/api/backup';
  };

  const parseYaml = (yaml: string) => {
    // Basic heuristic parser for MVP
    const imageMatch = yaml.match(/image:\s*["']?([\w:/-]+)["']?/);
    const image = imageMatch ? imageMatch[1] : "";

    const restartMatch = yaml.match(/restart:\s*["']?([\w-]+)["']?/);
    const restartPolicy = restartMatch ? restartMatch[1] : "";

    const ports: Record<string, string> = {};
    const loadPorts = yaml.match(/ports:\s*\n(\s*-\s*"?\d+:\d+"?\n?)+/m);
    if (loadPorts) {
      const portLines = loadPorts[0].split('\n');
      portLines.forEach(line => {
        const match = line.match(/"?(\d+):(\d+)"?/);
        if (match) {
          ports[match[2] + "/tcp"] = match[1];
        }
      });
    }

    const env: string[] = [];
    const loadEnv = yaml.match(/environment:\s*\n(\s*-\s*"?[\w=]+"?\n?)+/m);
    if (loadEnv) {
      const envLines = loadEnv[0].split('\n');
      envLines.forEach(line => {
        const match = line.match(/"?([\w=]+)"?/);
        if (match && !line.includes("environment:")) {
          env.push(match[1]);
        }
      });
    }

    return { image, ports, env, restart_policy: restartPolicy };
  };

  const handleYamlDeploy = async () => {
    const config = parseYaml(yamlContent);
    if (!config.image) {
      alert("Could not parse 'image' from YAML");
      return;
    }

    try {
      // Send to Deploy API 
      await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      setIsYamlDeployOpen(false);
    } catch (e) {
      alert("Failed to deploy parsed YAML: " + e);
    }
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen font-sans relative text-foreground">
      {/* Starfield Background */}
      <div className="stars-container">
        <div className="stars-1"></div>
        <div className="stars-2"></div>
        <div className="stars-3"></div>
      </div>

      <div className="relative z-10 p-8">
        <header className="mb-8 flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-white mb-1 drop-shadow-md">Docklet</h1>
            <p className="text-gray-400 text-sm">Orchestrator Control Plane v0.3.0 (Cluster Mode)</p>
          </div>
          <div className="flex gap-4 items-center">
            <Badge variant="outline" className="px-3 py-1 border-gray-700 text-gray-400 bg-black/50 backdrop-blur-md">
              {nodes.length} Nodes Online
            </Badge>
            <Button variant="outline" onClick={handleBackup} className="border-gray-700 text-gray-300 hover:bg-gray-800 bg-black/50">
              ↓ Backup
            </Button>
            <Dialog open={isDeployOpen} onOpenChange={setIsDeployOpen}>
              <DialogTrigger asChild>
                <Button variant="default" className="bg-blue-600 hover:bg-blue-500 text-white border-0 shadow-lg shadow-blue-900/20">
                  + Deploy App
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px] bg-zinc-950 text-white border-zinc-800">
                <DialogHeader>
                  <DialogTitle>Deploy New Application</DialogTitle>
                  <DialogDescription className="text-gray-400">
                    Configure your deployment alias and replica set.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="image" className="text-right text-gray-300">
                      Image
                    </Label>
                    <Input
                      id="image"
                      value={deployImage}
                      onChange={(e) => setDeployImage(e.target.value)}
                      placeholder="nginx:latest"
                      className="col-span-3 bg-zinc-900 border-zinc-700 text-white focus:border-blue-500"
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="replicas" className="text-right text-gray-300">
                      Replicas
                    </Label>
                    <Input
                      id="replicas"
                      type="number"
                      min="1"
                      max="10"
                      value={deployReplicas}
                      onChange={(e) => setDeployReplicas(parseInt(e.target.value))}
                      className="col-span-3 bg-zinc-900 border-zinc-700 text-white focus:border-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2 pr-1">
                    <input
                      type="checkbox"
                      id="restart"
                      checked={autoRestart}
                      onChange={e => setAutoRestart(e.target.checked)}
                      className="accent-blue-600 w-4 h-4"
                    />
                    <Label htmlFor="restart" className="text-gray-300 text-xs">Auto-Restart</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" onClick={handleDeploy} className="bg-blue-600 hover:bg-blue-500 text-white">Deploy Cluster</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        <Separator className="my-6 bg-zinc-800" />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Nodes Panel */}
          <Card className="border-zinc-800 bg-black/40 backdrop-blur-md shadow-2xl">
            <CardHeader>
              <CardTitle className="text-white">Cluster Infrastructure</CardTitle>
              <CardDescription className="text-gray-400">Active worker nodes in the cluster.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="w-[150px] text-gray-500">Hostname</TableHead>
                    <TableHead className="text-gray-500">Status</TableHead>
                    <TableHead className="text-right text-gray-500">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-gray-600 h-24">No nodes registered</TableCell></TableRow>
                  ) : (
                    nodes.map(node => (
                      <TableRow key={node.id} className="border-zinc-800 hover:bg-white/5 transition-colors cursor-pointer">
                        <TableCell className="font-mono text-xs text-blue-300">{node.hostname}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={node.status === 'online' ? 'text-green-400 bg-green-900/30' : 'text-red-400 bg-red-900/30'}>
                            {node.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" className="text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-900/20"
                            onClick={() => {
                              setDetailsNodeId(node.id);
                              setIsYamlDeployOpen(true);
                            }}
                          >
                            Deploy YAML
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Apps Panel */}
          <Card className="border-zinc-800 bg-black/40 backdrop-blur-md shadow-2xl">
            <CardHeader>
              <CardTitle className="text-white">Services</CardTitle>
              <CardDescription className="text-gray-400">Deployed services and replica sets.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-gray-500">ID</TableHead>
                    <TableHead className="text-gray-500">Revision</TableHead>
                    <TableHead className="text-gray-500">Status</TableHead>
                    <TableHead className="text-right text-gray-500">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apps.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center text-gray-600 h-24">No apps deployed</TableCell></TableRow>
                  ) : (
                    apps.filter(app => app.status !== 'terminated').map(app => (
                      <TableRow key={app.id} className="border-zinc-800 hover:bg-white/5 transition-colors">
                        <TableCell className="font-mono text-xs text-purple-300">
                          {app.id.substring(0, 8)}...
                        </TableCell>
                        <TableCell className="font-mono text-xs text-gray-300">
                          {app.active_revision_id ? (
                            <span className="text-blue-400">{app.active_revision_id.substring(0, 8)}...</span>
                          ) : 'v1'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={`
                           ${app.status === 'stable' ? 'text-blue-400 bg-blue-900/30' : ''}
                           ${app.status === 'rolling_update' ? 'text-yellow-400 bg-yellow-900/30 animate-pulse' : ''}
                           ${app.status === 'deployed' ? 'text-gray-400 bg-gray-900/30' : ''}
                           ${app.status.includes('scaling') ? 'text-purple-400 bg-purple-900/30 animate-pulse' : ''}
                         `}>
                            {app.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-7 text-xs bg-zinc-800 hover:bg-zinc-700 text-gray-300 border border-zinc-700"
                            onClick={() => {
                              setLogsAppId(app.id);
                              setIsLogsOpen(true);
                            }}
                          >
                            Logs
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-7 text-xs bg-zinc-800 hover:bg-zinc-700 text-gray-300 border border-zinc-700"
                            disabled={app.status === 'rolling_update'}
                            onClick={() => {
                              setSelectedAppId(app.id);
                              setIsUpdateOpen(true);
                            }}
                          >
                            Update
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 text-xs bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-900/50"
                            onClick={() => handleDelete(app.id)}
                          >
                            Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* YAML Deploy Dialog */}
        <Dialog open={isYamlDeployOpen} onOpenChange={setIsYamlDeployOpen}>
          <DialogContent className="sm:max-w-[600px] bg-zinc-950 text-white border-zinc-800">
            <DialogHeader>
              <DialogTitle>Deploy to Node via Manifest</DialogTitle>
              <DialogDescription className="text-gray-400">
                Paste your Docker Compose YAML (simplified) below. Configs for 'image', 'ports', and 'environment' will be parsed.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <Textarea
                value={yamlContent}
                onChange={(e) => setYamlContent(e.target.value)}
                className="font-mono text-xs bg-zinc-900 border-zinc-700 min-h-[200px] text-green-400"
              />
            </div>
            <DialogFooter>
              <Button type="submit" onClick={handleYamlDeploy} className="bg-purple-600 hover:bg-purple-500 text-white">Deploy Manifest</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Update Dialog (Existing) */}
        <Dialog open={isUpdateOpen} onOpenChange={setIsUpdateOpen}>
          <DialogContent className="sm:max-w-[425px] bg-zinc-950 text-white border-zinc-800">
            <DialogHeader>
              <DialogTitle>Update Application</DialogTitle>
              <DialogDescription className="text-gray-400">
                Provide the new image tag to trigger a Canary Rollout.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="update-image" className="text-right text-gray-300">
                  New Image
                </Label>
                <Input
                  id="update-image"
                  value={updateImage}
                  onChange={(e) => setUpdateImage(e.target.value)}
                  placeholder="nginx:alpine"
                  className="col-span-3 bg-zinc-900 border-zinc-700 text-white focus:border-blue-500"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" onClick={handleUpdate} className="bg-blue-600 hover:bg-blue-500">Start Rollout</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Logs Dialog (Existing) */}
        <Dialog open={isLogsOpen} onOpenChange={setIsLogsOpen}>
          <DialogContent className="sm:max-w-[600px] h-[500px] bg-zinc-950 text-white border-zinc-800 flex flex-col">
            <DialogHeader>
              <DialogTitle>Application Logs</DialogTitle>
              <DialogDescription className="text-gray-400">
                Fetching latest logs from the active node...
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 bg-black p-4 rounded-md border border-zinc-800 overflow-auto font-mono text-xs text-green-400 whitespace-pre-wrap shadow-inner">
              {logsContent}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
