import { NextRequest, NextResponse } from 'next/server';
import { getGameByCode, getQuestionsForRound, getStudentAnswers, countStudents } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const game = await getGameByCode(code);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

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
    });
  } catch (err) {
    console.error('GET /api/game-state/[code] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
