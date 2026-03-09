import { NextRequest, NextResponse } from 'next/server';
import { getGameByCode, getGameById, getQuestionsForRound, getStudentAnswers, countStudents, getNeonUrl, sql } from '@/lib/db';

// Always respond fresh — never cache game state
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    const { code } = params;

    // Query by join code (primary)
    const game = await getGameByCode(code);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Debug: also query by ID to detect any inconsistency in Neon query results
    const gameById = await getGameById(game.id);

    // Debug: query DB clock to verify we're getting a live (non-cached) response.
    // If dbTime is stale (old timestamp), the HTTP response itself is being cached.
    const dbTimeResult = await sql<{ db_time: string; db_round: number; db_status: string }>`
      SELECT NOW() as db_time, current_round as db_round, status as db_status
      FROM games WHERE id = ${game.id} LIMIT 1
    `;

    const [studentCount, currentRoundQuestions] = await Promise.all([
      countStudents(game.id),
      game.current_round > 0 && game.current_round <= 4
        ? getQuestionsForRound(game.current_round, false)
        : Promise.resolve([]),
    ]);

    // Optionally fetch this student's answers
    const studentIdParam = request.nextUrl.searchParams.get('studentId');
    let studentAnswers = undefined;
    if (studentIdParam) {
      const studentId = parseInt(studentIdParam, 10);
      if (!isNaN(studentId)) {
        studentAnswers = await getStudentAnswers(studentId, game.id);
      }
    }

    return NextResponse.json({
      game: {
        id: game.id,
        join_code: game.join_code,
        current_round: game.current_round,
        status: game.status,
      },
      currentRoundQuestions,
      studentAnswers,
      studentCount,
      // Temporary debug fields — remove after diagnosis
      _debug: {
        serverTime: new Date().toISOString(),
        byCode: { current_round: game.current_round, status: game.status },
        byId: { current_round: gameById?.current_round, status: gameById?.status },
        // Direct re-query with DB clock — if db_time is stale, the HTTP layer is caching
        directQuery: dbTimeResult.rows[0] ?? null,
        gameId: game.id,
        codeQueried: code,
        questionsCount: currentRoundQuestions.length,
        // Show the ACTUAL URL neon() uses (after -pooler stripping), not the raw env var
        pgHost: getNeonUrl().replace(/^[^@]+@/, '').replace(/\/.*$/, ''),
        pgHostRaw: (process.env.POSTGRES_URL ?? '').replace(/^[^@]+@/, '').replace(/\/.*$/, ''),
      },
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (err) {
    console.error('GET /api/game-state/[code] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
