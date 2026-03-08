'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LandingPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 6) {
      setError('Game code must be exactly 6 characters');
      return;
    }
    router.push(`/game/${trimmed}`);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <h1 className="text-5xl font-extrabold text-indigo-700 mb-2">T581 Trivia</h1>
          <p className="text-gray-500 text-lg">Live classroom quiz game</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8">
          <h2 className="text-xl font-bold mb-6 text-center">Join a Game</h2>
          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
                Game Code
              </label>
              <input
                id="code"
                type="text"
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
                placeholder="e.g. AB3X7K"
                maxLength={6}
                className="w-full px-4 py-3 text-2xl font-mono text-center tracking-widest border-2 border-gray-300 rounded-xl focus:border-indigo-500 focus:outline-none uppercase"
                autoFocus
              />
            </div>
            {error && <p className="text-red-600 text-sm text-center">{error}</p>}
            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-xl text-lg transition-colors"
            >
              Join Game
            </button>
          </form>
        </div>

        <div className="text-center mt-8">
          <Link
            href="/teacher/login"
            className="text-sm text-gray-500 hover:text-indigo-600 transition-colors"
          >
            Teacher Login
          </Link>
        </div>
      </div>
    </div>
  );
}
