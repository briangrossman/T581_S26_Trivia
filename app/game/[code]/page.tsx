'use client';

import { useState, useEffect, useCallback } from 'react';
import type { StudentQuestion, Answer, StudentSession, GameStateResponse } from '@/lib/types';

const STORAGE_KEY = 'trivia_student_session';

type StudentState =
  | 'loading'
  | 'enter_username'
  | 'lobby'
  | 'answering'
  | 'waiting'
  | 'game_over';

const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const;
const OPTION_LABELS: Record<string, string> = { A: 'option_a', B: 'option_b', C: 'option_c', D: 'option_d' };

function getOptionText(q: StudentQuestion, key: string): string | null {
  const field = OPTION_LABELS[key] as keyof StudentQuestion;
  const val = q[field];
  return typeof val === 'string' ? val : null;
}

export default function StudentGamePage({ params }: { params: { code: string } }) {
  const { code } = params;
  const upperCode = code.toUpperCase();

  const [studentState, setStudentState] = useState<StudentState>('loading');
  const [session, setSession] = useState<StudentSession | null>(null);
  const [gameState, setGameState] = useState<GameStateResponse | null>(null);
  const [username, setUsername] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joining, setJoining] = useState(false);
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState<Record<number, boolean>>({});
  const [textAnswers, setTextAnswers] = useState<Record<number, string>>({});

  // Load session from localStorage on mount
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const saved: StudentSession = JSON.parse(raw);
        if (saved.gameCode === upperCode) {
          setSession(saved);
          return;
        }
      } catch {
        // ignore
      }
    }
    setStudentState('enter_username');
  }, [upperCode]);

  const pollGameState = useCallback(async (currentSession: StudentSession | null) => {
    if (!currentSession) return;
    try {
      const res = await fetch(
        `/api/game-state/${upperCode}?studentId=${currentSession.studentId}`
      );
      if (!res.ok) return;
      const data: GameStateResponse = await res.json();
      setGameState(data);

      // Build map of already-submitted answers from server
      if (data.studentAnswers) {
        const map: Record<number, string> = {};
        for (const a of data.studentAnswers) {
          map[a.question_id] = a.answer_text;
        }
        setSubmittedAnswers(map);
      }

      // Determine UI state
      if (data.game.status === 'finished') {
        setStudentState('game_over');
      } else if (data.game.current_round === 0) {
        setStudentState('lobby');
      } else if (data.game.status === 'active' && data.currentRoundQuestions.length > 0) {
        // Check if student has answered all current round questions
        const allAnswered = data.currentRoundQuestions.every(
          (q) => data.studentAnswers?.some((a) => a.question_id === q.id)
        );
        setStudentState(allAnswered ? 'waiting' : 'answering');
      } else if (data.game.status === 'scoring') {
        setStudentState('waiting');
      } else {
        setStudentState('lobby');
      }
    } catch {
      // ignore poll errors
    }
  }, [upperCode]);

  // Start polling once session is set
  useEffect(() => {
    if (!session) return;
    setStudentState('lobby'); // will be updated by first poll

    pollGameState(session);
    const interval = setInterval(() => pollGameState(session), 2000);
    return () => clearInterval(interval);
  }, [session, pollGameState]);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) return;

    setJoining(true);
    setJoinError('');

    try {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: upperCode, username: trimmed }),
      });

      const data = await res.json();

      if (res.ok) {
        const newSession: StudentSession = {
          studentId: data.student.id,
          gameId: data.student.game_id,
          gameCode: upperCode,
          username: trimmed,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
        setSession(newSession);
      } else {
        setJoinError(data.error || 'Failed to join game');
      }
    } catch {
      setJoinError('Network error — please try again');
    } finally {
      setJoining(false);
    }
  }

  async function submitMCAnswer(questionId: number, choice: string) {
    if (!session || submittedAnswers[questionId]) return;
    setSubmitting((prev) => ({ ...prev, [questionId]: true }));

    // Optimistic update
    setSubmittedAnswers((prev) => ({ ...prev, [questionId]: choice }));

    try {
      await fetch('/api/answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: session.studentId,
          questionId,
          gameId: session.gameId,
          answerText: choice,
        }),
      });
    } catch {
      // ignore
    } finally {
      setSubmitting((prev) => ({ ...prev, [questionId]: false }));
    }
  }

  async function submitTextAnswer(questionId: number) {
    if (!session || submittedAnswers[questionId]) return;
    const text = textAnswers[questionId]?.trim();
    if (!text) return;

    setSubmitting((prev) => ({ ...prev, [questionId]: true }));
    setSubmittedAnswers((prev) => ({ ...prev, [questionId]: text }));

    try {
      await fetch('/api/answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: session.studentId,
          questionId,
          gameId: session.gameId,
          answerText: text,
        }),
      });
    } catch {
      // ignore
    } finally {
      setSubmitting((prev) => ({ ...prev, [questionId]: false }));
    }
  }

  // ---- Render States ----

  if (studentState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        Loading...
      </div>
    );
  }

  if (studentState === 'enter_username') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-indigo-50">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="text-indigo-600 font-mono text-2xl font-bold tracking-widest mb-1">
              {upperCode}
            </div>
            <h1 className="text-3xl font-extrabold text-indigo-800">Join the Game!</h1>
            <p className="text-gray-500 mt-1">Enter your name to participate</p>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-8">
            <form onSubmit={handleJoin} className="space-y-4">
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
                  Your Name
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setJoinError(''); }}
                  placeholder="Enter your name"
                  maxLength={50}
                  className="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-xl focus:border-indigo-500 focus:outline-none"
                  autoFocus
                  required
                />
              </div>
              {joinError && <p className="text-red-600 text-sm text-center">{joinError}</p>}
              <button
                type="submit"
                disabled={joining}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl text-lg transition-colors"
              >
                {joining ? 'Joining...' : 'Join Game'}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (studentState === 'lobby') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-indigo-50 px-4">
        <div className="text-center">
          <div className="text-5xl mb-4">⏳</div>
          <h1 className="text-2xl font-bold text-indigo-800 mb-2">You're in!</h1>
          <p className="text-gray-600 text-lg mb-1">Welcome, <strong>{session?.username}</strong>!</p>
          <p className="text-gray-400">Waiting for the teacher to start the game...</p>
          <div className="mt-6 flex gap-1 justify-center">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-3 h-3 bg-indigo-400 rounded-full animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (studentState === 'waiting') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-indigo-50 px-4">
        <div className="text-center">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-2xl font-bold text-indigo-800 mb-2">Round complete!</h1>
          <p className="text-gray-500">Waiting for the next round to begin...</p>
          <div className="mt-6 flex gap-1 justify-center">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-3 h-3 bg-indigo-400 rounded-full animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (studentState === 'game_over') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-indigo-50 px-4">
        <div className="text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-3xl font-extrabold text-indigo-800 mb-2">Game Over!</h1>
          <p className="text-gray-600 text-lg">Thanks for playing, <strong>{session?.username}</strong>!</p>
          <p className="text-gray-400 mt-2">The teacher will share the final results.</p>
        </div>
      </div>
    );
  }

  // ANSWERING state
  const roundQuestions = gameState?.currentRoundQuestions ?? [];
  const currentRound = gameState?.game.current_round ?? 1;

  const roundTitles: Record<number, string> = {
    1: 'Round 1 — Vibe Coding',
    2: 'Round 2 — Scratch',
    3: 'Round 3 — Prompt Writing',
    4: 'Round 4 — Coding',
  };

  return (
    <div className="min-h-screen bg-indigo-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-indigo-500 text-sm font-medium uppercase tracking-wide">
            {session?.username}
          </p>
          <h1 className="text-2xl font-extrabold text-indigo-800">
            {roundTitles[currentRound] ?? `Round ${currentRound}`}
          </h1>
        </div>

        {/* Questions */}
        <div className="space-y-6">
          {roundQuestions.map((q: StudentQuestion, idx: number) => {
            const answered = submittedAnswers[q.id];
            const isSubmitting = submitting[q.id];

            return (
              <div key={q.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Question {idx + 1}
                </p>
                <p className="text-lg font-semibold text-gray-900 mb-5 leading-snug">
                  {q.question_text}
                </p>

                {/* Multiple Choice */}
                {q.question_type === 'multiple_choice' && (
                  <div className="grid grid-cols-1 gap-3">
                    {OPTION_KEYS.map((key) => {
                      const optText = getOptionText(q, key);
                      if (!optText) return null;
                      const isSelected = answered === key;
                      return (
                        <button
                          key={key}
                          onClick={() => submitMCAnswer(q.id, key)}
                          disabled={!!answered || isSubmitting}
                          className={`w-full text-left px-4 py-3 rounded-xl border-2 font-medium transition-all flex items-center gap-3
                            ${isSelected
                              ? 'border-indigo-600 bg-indigo-600 text-white'
                              : answered
                              ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                              : 'border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 text-gray-800 cursor-pointer'
                            }`}
                        >
                          <span className={`text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0
                            ${isSelected ? 'bg-white text-indigo-600' : 'bg-gray-100 text-gray-500'}`}>
                            {key}
                          </span>
                          <span>{optText}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Prompt Writing */}
                {q.question_type === 'prompt_writing' && (
                  <div className="space-y-3">
                    {answered ? (
                      <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-green-800 text-sm">
                        <p className="font-semibold mb-1">Submitted!</p>
                        <p className="text-gray-600 whitespace-pre-wrap">{answered}</p>
                      </div>
                    ) : (
                      <>
                        <textarea
                          rows={6}
                          value={textAnswers[q.id] ?? ''}
                          onChange={(e) =>
                            setTextAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                          }
                          placeholder="Write your prompt here..."
                          className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-indigo-500 focus:outline-none resize-none text-base"
                        />
                        <button
                          onClick={() => submitTextAnswer(q.id)}
                          disabled={isSubmitting || !textAnswers[q.id]?.trim()}
                          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-2 px-6 rounded-xl transition-colors"
                        >
                          {isSubmitting ? 'Submitting...' : 'Submit Prompt'}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Coding */}
                {q.question_type === 'coding' && (
                  <div className="space-y-3">
                    {answered ? (
                      <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-green-800 text-sm">
                        <p className="font-semibold mb-1">Submitted!</p>
                        <p className="font-mono text-gray-700">{answered}</p>
                      </div>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={textAnswers[q.id] ?? ''}
                          onChange={(e) =>
                            setTextAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                          }
                          placeholder="Enter your answer..."
                          className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-indigo-500 focus:outline-none text-base font-mono"
                        />
                        <button
                          onClick={() => submitTextAnswer(q.id)}
                          disabled={isSubmitting || !textAnswers[q.id]?.trim()}
                          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-2 px-6 rounded-xl transition-colors"
                        >
                          {isSubmitting ? 'Submitting...' : 'Submit Answer'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* All answered prompt */}
        {roundQuestions.length > 0 && roundQuestions.every((q) => submittedAnswers[q.id]) && (
          <div className="mt-8 text-center text-gray-500">
            <p className="text-lg">All answers submitted! Waiting for the next round...</p>
          </div>
        )}
      </div>
    </div>
  );
}
