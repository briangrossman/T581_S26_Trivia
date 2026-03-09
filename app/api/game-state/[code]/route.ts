import { NextRequest, NextResponse } from 'next/server';
import { getGameByCode, getGameById, getQuestionsForRound, getStudentAnswers, countStudents } from '@/lib/db';

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
        gameId: game.id,
        codeQueried: code,
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
