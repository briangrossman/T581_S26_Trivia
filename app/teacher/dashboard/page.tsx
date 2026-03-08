'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Game } from '@/lib/types';

type GameWithCount = Game & { student_count: number };

function statusBadge(status: string, currentRound: number) {
  if (status === 'finished') {
    return <span className="px-2 py-0.5 text-xs font-semibold bg-gray-200 text-gray-700 rounded-full">Finished</span>;
  }
  if (status === 'lobby') {
    return <span className="px-2 py-0.5 text-xs font-semibold bg-yellow-100 text-yellow-800 rounded-full">Lobby</span>;
  }
  return (
    <span className="px-2 py-0.5 text-xs font-semibold bg-green-100 text-green-800 rounded-full">
      Round {currentRound}
    </span>
  );
}

export default function TeacherDashboard() {
  const router = useRouter();
  const [games, setGames] = useState<GameWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchGames = useCallback(async () => {
    try {
      const res = await fetch('/api/games');
      if (res.status === 401) {
        router.push('/teacher/login');
        return;
      }
      const data = await res.json();
      setGames(data.games ?? []);
    } catch {
      // ignore network errors on poll
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  async function createGame() {
    setCreating(true);
    try {
      const res = await fetch('/api/games', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        router.push(`/teacher/game/${data.game.id}`);
      }
    } catch {
      setCreating(false);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/teacher/login');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-indigo-700 text-white px-6 py-4 flex items-center justify-between shadow-md">
        <div>
          <h1 className="text-2xl font-bold">T581 Trivia</h1>
          <p className="text-indigo-200 text-sm">Teacher Dashboard</p>
        </div>
        <button
          onClick={logout}
          className="text-indigo-200 hover:text-white text-sm transition-colors"
        >
          Sign Out
        </button>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold">Your Games</h2>
          <button
            onClick={createGame}
            disabled={creating}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-2 px-5 rounded-xl transition-colors"
          >
            {creating ? 'Creating...' : '+ New Game'}
          </button>
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-20">Loading...</div>
        ) : games.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg mb-4">No games yet.</p>
            <button
              onClick={createGame}
              disabled={creating}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-3 px-8 rounded-xl text-lg transition-colors"
            >
              Create Your First Game
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {games.map((game) => (
              <Link
                key={game.id}
                href={`/teacher/game/${game.id}`}
                className="block bg-white rounded-xl shadow-sm border border-gray-200 hover:border-indigo-400 hover:shadow-md transition-all p-5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-2xl font-bold text-indigo-700 tracking-widest">
                      {game.join_code}
                    </span>
                    {statusBadge(game.status, game.current_round)}
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">
                      {game.student_count} student{game.student_count !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(game.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
