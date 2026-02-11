import { useState } from 'react'

function Login({ onLogin }) {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            })

            if (!res.ok) {
                throw new Error('Invalid credentials')
            }

            const data = await res.json()
            onLogin(data.token)
        } catch (err) {
            setError('Invalid username or password')
        }
    }

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
            <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl backdrop-blur">
                <h2 className="mb-1 text-center text-2xl font-bold text-white">Docklet Login</h2>
                <p className="mb-6 text-center text-xs text-slate-500">Control panel access</p>

                {error && (
                    <div className="mb-4 rounded-lg border border-rose-800/60 bg-rose-500/10 p-3 text-sm text-rose-300">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="mb-2 block text-sm font-semibold text-slate-300">Username</label>
                        <input
                            type="text"
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-slate-200 focus:border-orange-500 focus:outline-none"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                    </div>

                    <div className="mb-6">
                        <label className="mb-2 block text-sm font-semibold text-slate-300">Password</label>
                        <input
                            type="password"
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-slate-200 focus:border-orange-500 focus:outline-none"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>

                    <button
                        type="submit"
                        className="w-full rounded-lg bg-orange-600 px-4 py-2.5 font-bold text-white transition-colors hover:bg-orange-500"
                    >
                        Sign In
                    </button>
                </form>

                <p className="mt-4 text-center text-xs text-slate-500">
                    Default: astracat / astracat
                </p>
            </div>
        </div>
    )
}

export default Login
