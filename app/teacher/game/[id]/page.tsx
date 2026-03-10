'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Game, Question, Student, Answer, StudentScore } from '@/lib/types';

const ROUND_LABELS: Record<number, string> = {
  1: 'Round 1 — Vibe Coding',
  2: 'Round 2 — Scratch',
  3: 'Round 3 — Prompt Writing',
  4: 'Round 4 — Coding',
};

function AnswerCell({ answer, question }: { answer: Answer | undefined; question: Question }) {
  if (!answer) return <td className="px-3 py-2 text-gray-300 text-center">—</td>;

  if (question.question_type === 'multiple_choice') {
    const isCorrect = answer.is_correct;
    return (
      <td className="px-3 py-2 text-center">
        <span className={`inline-flex items-center gap-1 font-bold ${isCorrect ? 'text-green-600' : 'text-red-500'}`}>
          {answer.answer_text.toUpperCase()}
          {isCorrect ? ' ✓' : ' ✗'}
        </span>
      </td>
    );
  }

  if (question.question_type === 'coding') {
    const isCorrect = answer.is_correct;
    return (
      <td className="px-3 py-2 text-center">
        <span className={`text-sm font-medium ${isCorrect ? 'text-green-600' : answer.score !== null ? 'text-red-500' : 'text-gray-500'}`}>
          {answer.answer_text.slice(0, 20)}{answer.answer_text.length > 20 ? '…' : ''}
          {answer.score !== null && (isCorrect ? ' ✓' : ' ✗')}
        </span>
      </td>
    );
  }

  // Prompt writing
  return (
    <td className="px-3 py-2 text-center">
      <span className="text-sm text-gray-600">
        {answer.score !== null
          ? `${answer.score}/20`
          : <span className="italic text-gray-400">Submitted</span>}
      </span>
    </td>
  );
}

export default function TeacherGamePage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();

  const [game, setGame] = useState<Game | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [scores, setScores] = useState<StudentScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [showFinalScores, setShowFinalScores] = useState(false);

  const fetchGameState = useCallback(async () => {
    try {
      const t = Date.now();
      const [gameRes, scoresRes] = await Promise.all([
        fetch(`/api/games/${id}?_t=${t}`, { cache: 'no-store' }),
        fetch(`/api/games/${id}/scores?_t=${t}`, { cache: 'no-store' }),
      ]);

      if (gameRes.status === 401) {
        router.push('/teacher/login');
        return;
      }

      if (gameRes.ok) {
        const data = await gameRes.json();
        setGame(data.game);
        setQuestions(data.questions);
        setStudents(data.students);
        setAnswers(data.answers);
      }

      if (scoresRes.ok) {
        const scoresData = await scoresRes.json();
        setScores(scoresData.scores);
      }
    } catch {
      // ignore poll errors
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    fetchGameState();
    const interval = setInterval(fetchGameState, 2000);
    return () => clearInterval(interval);
  }, [fetchGameState]);

  async function advanceRound() {
    if (!game) return;
    setActionLoading(true);
    setError('');

    try {
      const isLastRound = game.current_round === 4;
      const res = await fetch(`/api/games/${id}/round`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: isLastRound ? 'finish' : 'next' }),
      });

      const data = await res.json();

      if (res.ok) {
        setGame(data.game);
        if (data.game.status === 'finished') {
          setShowFinalScores(true);
        }
        // Surface LLM scoring failures so the teacher knows to check their API key / Vercel logs
        if (data.scoringResult?.failed > 0) {
          setError(
            `LLM scoring failed for ${data.scoringResult.failed} student(s) — scores set to 0. ` +
            `Check ANTHROPIC_API_KEY in Vercel env vars. Error: ${data.scoringResult.firstError ?? 'unknown'}`
          );
        }
        fetchGameState();
      } else {
        setError(data.error || 'Action failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setError(msg);
    } finally {
      setActionLoading(false);
    }
  }

  function getRoundButton() {
    if (!game) return null;

    if (game.status === 'scoring') {
      return (
        <button disabled className="bg-yellow-500 text-white font-bold py-3 px-6 rounded-xl opacity-75 cursor-not-allowed flex items-center gap-2">
          <span className="animate-spin">⟳</span> Scoring with AI...
        </button>
      );
    }

    if (game.status === 'finished') {
      return (
        <button
          onClick={() => setShowFinalScores(true)}
          className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-xl transition-colors"
        >
          Show Final Scores
        </button>
      );
    }

    if (game.current_round === 0) {
      return (
        <button
          onClick={advanceRound}
          disabled={actionLoading}
          className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl transition-colors"
        >
          {actionLoading ? 'Starting...' : 'Start Round 1'}
        </button>
      );
    }

    if (game.current_round < 4) {
      return (
        <button
          onClick={advanceRound}
          disabled={actionLoading}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl transition-colors"
        >
          {actionLoading
            ? game.current_round === 3 ? 'Scoring prompts...' : 'Advancing...'
            : `End Round ${game.current_round} / Start Round ${game.current_round + 1}`}
        </button>
      );
    }

    return (
      <button
        onClick={advanceRound}
        disabled={actionLoading}
        className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl transition-colors"
      >
        {actionLoading ? 'Ending...' : 'End Game'}
      </button>
    );
  }

  const currentRoundQuestions = questions.filter(
    (q) => game && q.round_number === game.current_round
  );

  const answersMap = new Map<string, Answer>();
  for (const a of answers) {
    answersMap.set(`${a.student_id}-${a.question_id}`, a);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        Loading...
      </div>
    );
  }

  if (!game) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Game not found</p>
          <Link href="/teacher/dashboard" className="text-indigo-600 hover:underline">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-indigo-700 text-white px-6 py-4 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/teacher/dashboard" className="text-indigo-200 hover:text-white text-sm transition-colors">
              ← Dashboard
            </Link>
            <div>
              <span className="text-xs text-indigo-300 uppercase tracking-wide">Join Code</span>
              <p className="text-3xl font-mono font-black tracking-widest">{game.join_code}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-indigo-200 text-sm">{students.length} student{students.length !== 1 ? 's' : ''} joined</p>
            <p className="text-indigo-200 text-sm">
              {game.current_round === 0 ? 'Lobby' :
               game.current_round > 4 ? 'Game Over' :
               ROUND_LABELS[game.current_round] ?? `Round ${game.current_round}`}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* Round Control */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">
                {game.status === 'finished'
                  ? 'Game Finished'
                  : game.current_round === 0
                  ? 'Waiting to start...'
                  : game.status === 'scoring'
                  ? 'Scoring Round 3 Prompts...'
                  : `${ROUND_LABELS[game.current_round]} — Active`}
              </h2>
              {error && (
                <p className="text-red-600 font-semibold mt-2 text-sm bg-red-50 border border-red-200 rounded px-3 py-2">
                  ⚠️ Error: {error}
                </p>
              )}
            </div>
            {getRoundButton()}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Student Answers Table */}
          {game.current_round > 0 && currentRoundQuestions.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 overflow-x-auto">
              <h3 className="font-bold text-lg mb-4">
                {ROUND_LABELS[game.current_round]} — Live Answers
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left px-3 py-2 font-semibold">Student</th>
                    {currentRoundQuestions.map((q, i) => (
                      <th key={q.id} className="px-3 py-2 font-semibold text-center">
                        Q{i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{student.username}</td>
                      {currentRoundQuestions.map((q) => (
                        <AnswerCell
                          key={q.id}
                          answer={answersMap.get(`${student.id}-${q.id}`)}
                          question={q}
                        />
                      ))}
                    </tr>
                  ))}
                  {students.length === 0 && (
                    <tr>
                      <td colSpan={currentRoundQuestions.length + 1} className="text-center text-gray-400 py-6">
                        No students joined yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Scoreboard */}
          {scores.length > 0 && game.current_round > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <h3 className="font-bold text-lg mb-4">Scoreboard</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-gray-200">
                      <th className="text-left px-3 py-2 font-semibold">#</th>
                      <th className="text-left px-3 py-2 font-semibold">Student</th>
                      {[1, 2, 3, 4].map((r) => (
                        <th key={r} className={`px-3 py-2 text-center font-semibold ${r > game.current_round ? 'text-gray-300' : ''}`}>
                          R{r}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-center font-bold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scores.map((score, idx) => (
                      <tr key={score.student_id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-400 font-mono">{idx + 1}</td>
                        <td className="px-3 py-2 font-medium">{score.username}</td>
                        <td className="px-3 py-2 text-center">{game.current_round > 1 || game.status === 'finished' ? score.round_1_score : '—'}</td>
                        <td className="px-3 py-2 text-center">{game.current_round > 2 || game.status === 'finished' ? score.round_2_score : '—'}</td>
                        <td className="px-3 py-2 text-center">{game.current_round > 3 || game.status === 'finished' ? score.round_3_score : '—'}</td>
                        <td className="px-3 py-2 text-center">{game.current_round > 4 || game.status === 'finished' ? score.round_4_score : '—'}</td>
                        <td className="px-3 py-2 text-center font-bold text-indigo-700">{score.total_score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Lobby state — student list */}
          {game.current_round === 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <h3 className="font-bold text-lg mb-4">Students Joined ({students.length})</h3>
              {students.length === 0 ? (
                <p className="text-gray-400 italic">Waiting for students to join...</p>
              ) : (
                <div className="space-y-2">
                  {students.map((s) => (
                    <div key={s.id} className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full" />
                      <span className="font-medium">{s.username}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Correct Answers Reference (for teacher) */}
        {game.current_round > 0 && game.current_round <= 4 && currentRoundQuestions.length > 0 && (
          <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-2xl p-5">
            <h3 className="font-bold text-yellow-800 mb-3">Answer Key — Round {game.current_round}</h3>
            <div className="space-y-2">
              {currentRoundQuestions.map((q, i) => (
                <div key={q.id} className="text-sm">
                  <span className="font-semibold text-yellow-900">Q{i + 1}:</span>{' '}
                  <span className="text-yellow-800 truncate">{q.question_text.slice(0, 80)}{q.question_text.length > 80 ? '...' : ''}</span>
                  {q.correct_answer && (
                    <span className="ml-2 font-bold text-green-700">→ {q.correct_answer}</span>
                  )}
                  {q.correct_value && (
                    <span className="ml-2 font-bold text-green-700">→ {q.correct_value}</span>
                  )}
                  {q.question_type === 'prompt_writing' && (
                    <span className="ml-2 text-yellow-600 italic">(LLM-scored)</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Final Scores Modal */}
      {showFinalScores && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8 max-h-screen overflow-y-auto">
            <div className="text-center mb-6">
              <h2 className="text-3xl font-extrabold text-indigo-700">Final Results</h2>
              <p className="text-gray-500 mt-1">T581 Trivia — {game.join_code}</p>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-3 px-2 font-semibold text-gray-600">Rank</th>
                  <th className="text-left py-3 px-2 font-semibold text-gray-600">Student</th>
                  <th className="text-center py-3 px-2 font-semibold text-gray-600">R1</th>
                  <th className="text-center py-3 px-2 font-semibold text-gray-600">R2</th>
                  <th className="text-center py-3 px-2 font-semibold text-gray-600">R3</th>
                  <th className="text-center py-3 px-2 font-semibold text-gray-600">R4</th>
                  <th className="text-center py-3 px-2 font-bold text-gray-900">Total</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((score, idx) => (
                  <tr
                    key={score.student_id}
                    className={`border-b ${idx === 0 ? 'bg-yellow-50' : idx === 1 ? 'bg-gray-50' : ''}`}
                  >
                    <td className="py-3 px-2 font-bold text-2xl">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                    </td>
                    <td className="py-3 px-2 font-bold text-lg">{score.username}</td>
                    <td className="py-3 px-2 text-center">{score.round_1_score}</td>
                    <td className="py-3 px-2 text-center">{score.round_2_score}</td>
                    <td className="py-3 px-2 text-center">{score.round_3_score}</td>
                    <td className="py-3 px-2 text-center">{score.round_4_score}</td>
                    <td className="py-3 px-2 text-center font-extrabold text-2xl text-indigo-700">
                      {score.total_score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-center mt-6">
              <button
                onClick={() => setShowFinalScores(false)}
                className="text-gray-500 hover:text-gray-700 text-sm transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
