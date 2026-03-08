import { NextRequest, NextResponse } from 'next/server';
import { getGameById, getStudentById, sql } from '@/lib/db';
import { scoreAnswer } from '@/lib/scoring';
import type { Question } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const { studentId, questionId, gameId, answerText } = await request.json();

    if (!studentId || !questionId || !gameId || answerText === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const trimmedAnswer = String(answerText).trim();
    if (!trimmedAnswer) {
      return NextResponse.json({ error: 'Answer cannot be empty' }, { status: 400 });
    }

    // Validate student belongs to this game
    const student = await getStudentById(parseInt(studentId, 10));
    if (!student || student.game_id !== parseInt(gameId, 10)) {
      return NextResponse.json({ error: 'Student not found in this game' }, { status: 403 });
    }

    // Get the game and validate round
    const game = await getGameById(parseInt(gameId, 10));
    if (!game || game.status === 'finished' || game.status === 'lobby') {
      return NextResponse.json({ error: 'Game is not currently accepting answers' }, { status: 409 });
    }

    // Get the question
    const questionResult = await sql<Question>`
      SELECT * FROM questions WHERE id = ${parseInt(questionId, 10)} LIMIT 1
    `;
    const question = questionResult.rows[0];
    if (!question) {
      return NextResponse.json({ error: 'Question not found' }, { status: 404 });
    }

    // Validate the question belongs to the current round
    if (question.round_number !== game.current_round) {
      return NextResponse.json(
        { error: 'This question is not part of the current round' },
        { status: 409 }
      );
    }

    // Get count of questions in this round for scoring
    const countResult = await sql<{ count: number }>`
      SELECT COUNT(*)::int as count FROM questions WHERE round_number = ${question.round_number}
    `;
    const numQuestionsInRound = countResult.rows[0]?.count ?? 1;

    // Score immediately for MC and coding; null for prompt writing
    const scored = scoreAnswer(question, trimmedAnswer, numQuestionsInRound);

    const result = await sql`
      INSERT INTO answers (student_id, game_id, question_id, round_number, answer_text, score, is_correct, scored_at)
      VALUES (
        ${student.id},
        ${game.id},
        ${question.id},
        ${question.round_number},
        ${trimmedAnswer},
        ${scored?.score ?? null},
        ${scored?.is_correct ?? null},
        ${scored ? 'NOW()' : null}
      )
      ON CONFLICT (student_id, question_id)
      DO UPDATE SET
        answer_text = EXCLUDED.answer_text,
        score = EXCLUDED.score,
        is_correct = EXCLUDED.is_correct,
        scored_at = EXCLUDED.scored_at,
        submitted_at = NOW()
      RETURNING *
    `;

    return NextResponse.json({ answer: result.rows[0] });
  } catch (err) {
    console.error('POST /api/answers error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
