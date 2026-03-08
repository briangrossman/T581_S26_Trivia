import { NextRequest, NextResponse } from 'next/server';
import { getTeacherFromCookies } from '@/lib/auth';
import { getGameById, getStudentsByGame, getAllQuestions, getAnswersByGame } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await getTeacherFromCookies();
  if (!teacher) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const gameId = parseInt(id, 10);
    const game = await getGameById(gameId);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    if (game.teacher_id !== teacher.teacherId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [questions, students, answers] = await Promise.all([
      getAllQuestions(),
      getStudentsByGame(gameId),
      getAnswersByGame(gameId),
    ]);

    return NextResponse.json({ game, questions, students, answers });
  } catch (err) {
    console.error('GET /api/games/[id] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
